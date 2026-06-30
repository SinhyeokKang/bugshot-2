import { describe, it, expect } from "vitest";
import { frameOffsetsMs, secondsToFrameRange, isFullRange } from "../trim-math";
import { computeFrameDurationsUs } from "../mp4-encoder";
import type { CapturedFrame } from "../frame-buffer";

// mp4-encoder의 MAX_FRAME_DURATION_MS(export 승격 예정)와 동일 상수.
const MAX = 1000;

function frames(...ts: number[]): CapturedFrame[] {
  return ts.map((timestamp) => ({ blob: new Blob(), timestamp }));
}

describe("frameOffsetsMs", () => {
  it("빈 배열이면 빈 배열", () => {
    expect(frameOffsetsMs([], MAX)).toEqual([]);
  });

  it("단일 프레임이면 [0]", () => {
    expect(frameOffsetsMs(frames(1000), MAX)).toEqual([0]);
  });

  it("등간격(600ms) 프레임의 누적 시작 오프셋이 단조 증가", () => {
    const offs = frameOffsetsMs(frames(0, 600, 1200, 1800), MAX);
    expect(offs).toEqual([0, 600, 1200, 1800]);
    for (let i = 1; i < offs.length; i++) {
      expect(offs[i]).toBeGreaterThan(offs[i - 1]);
    }
  });

  it("마지막 오프셋 + 마지막 프레임 표시 duration == computeFrameDurationsUs 총합(영상 duration)", () => {
    const f = frames(0, 600, 1200);
    const offs = frameOffsetsMs(f, MAX);
    const durUs = computeFrameDurationsUs(f, { maxFrameDurationMs: MAX });
    const totalMs = durUs.reduce((a, b) => a + b, 0) / 1000;
    const lastDurMs = durUs[durUs.length - 1] / 1000;
    expect(offs[offs.length - 1] + lastDurMs).toBe(totalMs);
  });
});

describe("secondsToFrameRange", () => {
  // 5프레임 등간격 600ms → 시작 오프셋 [0,600,1200,1800,2400]ms, 총 3000ms=3s.
  const f = frames(0, 600, 1200, 1800, 2400);

  it("startSec=0이면 inIndex=0", () => {
    expect(secondsToFrameRange(f, 0, 3, MAX).inIndex).toBe(0);
  });

  it("endSec가 총 길이 이상이면 outIndex=last", () => {
    expect(secondsToFrameRange(f, 0, 99, MAX).outIndex).toBe(f.length - 1);
  });

  it("중간 초 값은 가장 가까운 프레임에 스냅", () => {
    const { inIndex, outIndex } = secondsToFrameRange(f, 0.6, 1.2, MAX);
    expect(inIndex).toBe(1);
    expect(outIndex).toBe(2);
  });

  it("in==out으로 좁혀지면 최소 2프레임 보장", () => {
    const { inIndex, outIndex } = secondsToFrameRange(f, 1.2, 1.2, MAX);
    expect(outIndex - inIndex).toBeGreaterThanOrEqual(1);
  });
});

describe("isFullRange", () => {
  const f = frames(0, 600, 1200, 1800);

  it("in=0 && out=last면 true", () => {
    expect(isFullRange(f, 0, f.length - 1)).toBe(true);
  });

  it("out이 last 미만이면 false", () => {
    expect(isFullRange(f, 0, f.length - 2)).toBe(false);
  });

  it("in이 0 초과면 false", () => {
    expect(isFullRange(f, 1, f.length - 1)).toBe(false);
  });
});
