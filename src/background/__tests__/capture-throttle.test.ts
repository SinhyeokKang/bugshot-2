import { describe, expect, it, vi } from "vitest";
import {
  CAPTURE_MIN_GAP_MS,
  CAPTURE_RETRY_DELAYS_MS,
  createCaptureThrottle,
  isCaptureRateLimitError,
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
