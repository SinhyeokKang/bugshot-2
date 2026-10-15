import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { afterPaint, PAINT_WAIT_CAP_MS } from "../after-paint";

let rafQueue: FrameRequestCallback[] = [];

function stubRaf(): void {
  rafQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
}

type FakeDocument = {
  visibilityState: DocumentVisibilityState;
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
  listenerCount: () => number;
  hide: () => void;
};

function makeFakeDocument(visibilityState: DocumentVisibilityState = "visible"): FakeDocument {
  const listeners = new Set<() => void>();
  const doc: FakeDocument = {
    visibilityState,
    addEventListener: (type, fn) => {
      if (type === "visibilitychange") listeners.add(fn);
    },
    removeEventListener: (type, fn) => {
      if (type === "visibilitychange") listeners.delete(fn);
    },
    listenerCount: () => listeners.size,
    hide: () => {
      doc.visibilityState = "hidden";
      for (const fn of [...listeners]) fn();
    },
  };
  return doc;
}

// 브라우저가 프레임을 커밋한 것과 같은 효과 — 큐에 쌓인 콜백만 비우고 새로 등록된 건 남긴다.
function paintFrame(): void {
  const queued = rafQueue;
  rafQueue = [];
  for (const cb of queued) cb(0);
}

describe("afterPaint", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubRaf();
    vi.stubGlobal("document", makeFakeDocument());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("프레임이 두 번 커밋되면 resolve한다", async () => {
    let settled = false;
    const p = afterPaint().then(() => {
      settled = true;
    });

    paintFrame();
    await Promise.resolve();
    expect(settled).toBe(false);

    paintFrame();
    await p;
    expect(settled).toBe(true);
  });

  it("프레임이 한 번만 커밋되면 아직 resolve하지 않는다", async () => {
    let settled = false;
    void afterPaint().then(() => {
      settled = true;
    });

    paintFrame();
    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toBe(false);
  });

  // hidden 탭에서는 rAF가 영영 발화하지 않는다 — 캡처를 실패로 떨구지 않고 그냥 진행한다.
  it("rAF가 발화하지 않으면 timeoutMs 경과 후 resolve한다", async () => {
    let settled = false;
    const p = afterPaint(500).then(() => {
      settled = true;
    });

    vi.advanceTimersByTime(499);
    await Promise.resolve();
    expect(settled).toBe(false);

    vi.advanceTimersByTime(1);
    await p;
    expect(settled).toBe(true);
  });

  // #263: 오버레이를 숨긴 뒤 첫 프레임이 +228ms에 왔는데 150ms 폴백이 먼저 끝나 오버레이가
  // 남은 직전 프레임이 before 스냅샷에 찍혔다. 화면에 있는 문서는 늦더라도 프레임을 기다린다.
  it("visible 문서는 150ms가 지나도 프레임이 커밋되기 전엔 resolve하지 않는다", async () => {
    let settled = false;
    const p = afterPaint().then(() => {
      settled = true;
    });

    vi.advanceTimersByTime(228);
    await Promise.resolve();
    expect(settled).toBe(false);

    paintFrame();
    paintFrame();
    await p;
    expect(settled).toBe(true);
  });

  it("기본 상한은 PAINT_WAIT_CAP_MS다 — 프레임이 끝내 안 와도 캡처를 묶어두지 않는다", async () => {
    let settled = false;
    const p = afterPaint().then(() => {
      settled = true;
    });

    vi.advanceTimersByTime(PAINT_WAIT_CAP_MS - 1);
    await Promise.resolve();
    expect(settled).toBe(false);

    vi.advanceTimersByTime(1);
    await p;
    expect(settled).toBe(true);
  });

  // 대기 중 탭이 숨으면 프레임은 더 오지 않는다 — 상한까지 버티지 않고 바로 진행한다(관문이 판정).
  it("대기 중 문서가 hidden으로 바뀌면 즉시 resolve한다", async () => {
    const doc = makeFakeDocument();
    vi.stubGlobal("document", doc);
    let settled = false;
    const p = afterPaint().then(() => {
      settled = true;
    });

    doc.hide();
    await p;
    expect(settled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolve하면 visibilitychange 리스너를 남기지 않는다", async () => {
    const doc = makeFakeDocument();
    vi.stubGlobal("document", doc);
    const p = afterPaint();

    paintFrame();
    paintFrame();
    await p;

    expect(doc.listenerCount()).toBe(0);
  });

  it("프레임으로 resolve하면 폴백 타이머를 남기지 않는다", async () => {
    const p = afterPaint(500);

    paintFrame();
    paintFrame();
    await p;

    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolve 이후 폴백 타이머가 발화해도 오류 없이 흘린다", async () => {
    const p = afterPaint(500);

    paintFrame();
    paintFrame();
    await p;

    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
  });

  // 화면에 없는 문서는 프레임을 커밋하지 않는다 — 기다리면 그 지연이 캡처마다 얹힌다.
  it("문서가 hidden이면 기다리지 않는다", async () => {
    vi.stubGlobal("document", makeFakeDocument("hidden"));
    let settled = false;
    const p = afterPaint().then(() => {
      settled = true;
    });

    await p;
    expect(settled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("requestAnimationFrame이 없는 환경에서도 timeoutMs로 resolve한다", async () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    let settled = false;
    const p = afterPaint(200).then(() => {
      settled = true;
    });

    vi.advanceTimersByTime(200);
    await p;

    expect(settled).toBe(true);
  });
});
