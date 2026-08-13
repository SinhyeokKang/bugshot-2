import { describe, expect, it, vi } from "vitest";
import {
  CAPTURE_MIN_GAP_MS,
  CAPTURE_RETRY_DELAYS_MS,
  captureOwnedTab,
  createCaptureThrottle,
  isCaptureRateLimitError,
  type CaptureOwnerDeps,
} from "../capture-throttle";

function fakeClock(start = 1000) {
  let t = start;
  const sleep = vi.fn(async (ms: number) => {
    t += ms;
  });
  return { now: () => t, sleep };
}

const rateLimitErr = () =>
  new Error(
    "This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.",
  );

describe("isCaptureRateLimitError", () => {
  it("rate-limit 메시지 → true", () => {
    expect(isCaptureRateLimitError(rateLimitErr())).toBe(true);
  });
  it("다른 에러 → false", () => {
    expect(isCaptureRateLimitError(new Error("tab closed"))).toBe(false);
    expect(isCaptureRateLimitError("nope")).toBe(false);
  });
});

describe("createCaptureThrottle", () => {
  it("첫 캡처는 대기 없이 즉시 실행", async () => {
    const clock = fakeClock();
    const { run } = createCaptureThrottle(clock);
    const out = await run(async () => "shot");
    expect(out).toBe("shot");
    expect(clock.sleep).not.toHaveBeenCalled();
  });

  it("연속 캡처는 최소 간격만큼 대기", async () => {
    const clock = fakeClock();
    const { run } = createCaptureThrottle(clock);
    await run(async () => 1);
    await run(async () => 2);
    expect(clock.sleep).toHaveBeenCalledTimes(1);
    expect(clock.sleep).toHaveBeenCalledWith(CAPTURE_MIN_GAP_MS);
  });

  it("호출을 순서대로 직렬화", async () => {
    const clock = fakeClock();
    const { run } = createCaptureThrottle(clock);
    const order: number[] = [];
    const a = run(async () => {
      order.push(1);
    });
    const b = run(async () => {
      order.push(2);
    });
    await Promise.all([a, b]);
    expect(order).toEqual([1, 2]);
  });

  it("rate-limit 시 백오프 재시도 후 성공", async () => {
    const clock = fakeClock();
    const { run } = createCaptureThrottle(clock);
    const capture = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(rateLimitErr())
      .mockRejectedValueOnce(rateLimitErr())
      .mockResolvedValueOnce("ok");
    const out = await run(capture);
    expect(out).toBe("ok");
    expect(capture).toHaveBeenCalledTimes(3);
    expect(clock.sleep).toHaveBeenCalledWith(CAPTURE_RETRY_DELAYS_MS[0]);
    expect(clock.sleep).toHaveBeenCalledWith(CAPTURE_RETRY_DELAYS_MS[1]);
  });

  it("재시도 모두 실패하면 마지막 에러를 throw", async () => {
    const clock = fakeClock();
    const { run } = createCaptureThrottle(clock);
    const capture = vi.fn(async () => {
      throw rateLimitErr();
    });
    await expect(run(capture)).rejects.toThrow(/MAX_CAPTURE/);
    expect(capture).toHaveBeenCalledTimes(CAPTURE_RETRY_DELAYS_MS.length + 1);
  });

  it("rate-limit 외 에러는 재시도 없이 즉시 throw", async () => {
    const clock = fakeClock();
    const { run } = createCaptureThrottle(clock);
    const capture = vi.fn(async () => {
      throw new Error("tab closed");
    });
    await expect(run(capture)).rejects.toThrow("tab closed");
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("한 캡처 실패가 다음 캡처를 막지 않음", async () => {
    const clock = fakeClock();
    const { run } = createCaptureThrottle(clock);
    await expect(
      run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const out = await run(async () => "next");
    expect(out).toBe("next");
  });
});

describe("captureOwnedTab", () => {
  const opts: chrome.tabs.CaptureVisibleTabOptions = { format: "png" };

  function deps(
    tab: { active?: boolean; windowId?: number },
    captureVisibleTab = vi.fn(async () => "shot"),
  ): { deps: CaptureOwnerDeps; captureVisibleTab: typeof captureVisibleTab } {
    return {
      deps: { getTab: async () => tab, captureVisibleTab },
      captureVisibleTab,
    };
  }

  it("탭이 비활성이면 캡처하지 않고 실패", async () => {
    const d = deps({ active: false, windowId: 1 });
    await expect(captureOwnedTab(7, opts, d.deps)).rejects.toThrow(
      /no longer the active tab/,
    );
    expect(d.captureVisibleTab).not.toHaveBeenCalled();
  });

  it("탭이 active면 그 창을 캡처", async () => {
    const d = deps({ active: true, windowId: 42 });
    await expect(captureOwnedTab(7, opts, d.deps)).resolves.toBe("shot");
    expect(d.captureVisibleTab).toHaveBeenCalledWith(42, opts);
  });

  it("windowId가 없으면 캡처하지 않고 실패", async () => {
    const d = deps({ active: true, windowId: undefined });
    await expect(captureOwnedTab(7, opts, d.deps)).rejects.toThrow(
      "tab has no window",
    );
    expect(d.captureVisibleTab).not.toHaveBeenCalled();
  });

  it("탭 조회 실패는 그대로 전파", async () => {
    const captureVisibleTab = vi.fn(async () => "shot");
    await expect(
      captureOwnedTab(7, opts, {
        getTab: async () => {
          throw new Error("No tab with id: 7.");
        },
        captureVisibleTab,
      }),
    ).rejects.toThrow("No tab with id: 7.");
    expect(captureVisibleTab).not.toHaveBeenCalled();
  });

  it("소유권 재확인은 큐 대기가 끝난 뒤에 일어난다", async () => {
    const clock = fakeClock();
    const { run } = createCaptureThrottle(clock);
    // 앞선 캡처가 큐를 점유한 사이 사용자가 다른 탭으로 전환한 상황.
    let active = true;
    const captureVisibleTab = vi.fn(async () => "shot");
    const ownerDeps: CaptureOwnerDeps = {
      getTab: async () => ({ active, windowId: 1 }),
      captureVisibleTab,
    };

    const first = run(async () => {
      active = false;
      return "first";
    });
    const second = run(() => captureOwnedTab(7, opts, ownerDeps));

    await expect(first).resolves.toBe("first");
    await expect(second).rejects.toThrow(/no longer the active tab/);
    expect(captureVisibleTab).not.toHaveBeenCalled();
  });

  // 위 케이스는 전부 가짜 deps를 넣어 기본 배선을 건너뛴다. 기본 deps는 프로덕션에서만 도는
  // 유일한 경로인데, captureVisibleTab이 받는 건 tabId가 아니라 windowId라 인자를 바꿔 넣어도
  // 타입이 둘 다 number라 컴파일러가 안 잡는다.
  it("deps를 생략하면 chrome.tabs를 tabId가 아닌 windowId로 호출한다", async () => {
    const get = vi.fn(async () => ({ active: true, windowId: 42 }));
    const captureVisibleTab = vi.fn(async () => "shot");
    const prev = (globalThis as { chrome?: unknown }).chrome;
    (globalThis as { chrome?: unknown }).chrome = {
      tabs: { get, captureVisibleTab },
    };
    try {
      await expect(captureOwnedTab(7, opts)).resolves.toBe("shot");
      expect(get).toHaveBeenCalledWith(7);
      expect(captureVisibleTab).toHaveBeenCalledWith(42, opts);
    } finally {
      (globalThis as { chrome?: unknown }).chrome = prev;
    }
  });
});
