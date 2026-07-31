import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { afterPaint } from "../after-paint";

let rafQueue: FrameRequestCallback[] = [];

function stubRaf(): void {
  rafQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
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

  it("timeoutMs 기본값은 500ms다", async () => {
    let settled = false;
    const p = afterPaint().then(() => {
      settled = true;
    });

    vi.advanceTimersByTime(499);
    await Promise.resolve();
    expect(settled).toBe(false);

    vi.advanceTimersByTime(1);
    await p;
    expect(settled).toBe(true);
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
