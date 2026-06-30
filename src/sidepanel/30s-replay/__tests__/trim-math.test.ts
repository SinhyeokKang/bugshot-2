import { describe, it, expect } from "vitest";
import {
  frameOffsetsMs,
  secondsToFrameRange,
  isFullRange,
  replayLogTrimBounds,
  previewTrimBounds,
  isTrimmedOut,
} from "../trim-math";
import { computeFrameDurationsUs } from "../mp4-encoder";
import { REPLAY_LOG_GUARD_MS } from "@/sidepanel/lib/log-merge";
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

describe("replayLogTrimBounds", () => {
  // 절대 wall-clock timestamp 기준. base=10000, 600ms 등간격 5프레임.
  const f = frames(10000, 10600, 11200, 11800, 12400);

  it("inIndex=0이면 lower에 가드밴드 적용(frames[0] - GUARD)", () => {
    // 끝만 트림: in=0, out=2(<last)
    expect(replayLogTrimBounds(f, 0, 2)).toEqual({
      lower: 10000 - REPLAY_LOG_GUARD_MS,
      upper: 11200,
    });
  });

  it("inIndex>0이면 lower=frames[inIndex].timestamp(가드밴드 없음)", () => {
    // 시작만 트림: in=1, out=last
    expect(replayLogTrimBounds(f, 1, f.length - 1)).toEqual({
      lower: 10600,
      upper: undefined,
    });
  });

  it("양쪽 트림이면 lower/upper 둘 다 내부 프레임 timestamp", () => {
    expect(replayLogTrimBounds(f, 1, 3)).toEqual({ lower: 10600, upper: 11800 });
  });
});

describe("previewTrimBounds", () => {
  const f = frames(10000, 10600, 11200, 11800, 12400); // 오프셋 [0,600,1200,1800,2400]ms

  it("전체 구간이면 null(잘림 없음)", () => {
    expect(previewTrimBounds(f, 0, 3, MAX)).toBeNull();
    expect(previewTrimBounds(f, 0, 99, MAX)).toBeNull();
  });

  it("시작만 트림 → lower=frames[inIndex], upper=undefined", () => {
    // startSec=0.6 → index1, endSec=99 → last
    expect(previewTrimBounds(f, 0.6, 99, MAX)).toEqual({ lower: 10600, upper: undefined });
  });

  it("끝만 트림 → lower=frames[0]-GUARD, upper=frames[outIndex]", () => {
    // startSec=0 → index0, endSec=1.2 → index2
    expect(previewTrimBounds(f, 0, 1.2, MAX)).toEqual({
      lower: 10000 - REPLAY_LOG_GUARD_MS,
      upper: 11200,
    });
  });

  it("양쪽 트림 → 내부 프레임 timestamp 경계", () => {
    // startSec=0.6 → index1, endSec=1.8 → index3
    expect(previewTrimBounds(f, 0.6, 1.8, MAX)).toEqual({ lower: 10600, upper: 11800 });
  });

  it("빈 배열이면 null(크래시 없음)", () => {
    expect(previewTrimBounds([], 0, 3, MAX)).toBeNull();
  });

  it("단일 프레임이면 null", () => {
    expect(previewTrimBounds(frames(10000), 0, 3, MAX)).toBeNull();
  });

  // parity(최우선): 미리보기 경계 == apply-trim이 같은 구간에 쓰는 경계.
  // apply-trim 경로 = secondsToFrameRange → (full이면 null) replayLogTrimBounds.
  it("apply-trim 경로와 동일한 lower/upper를 낸다 (흐림=실제잘림 보증)", () => {
    const startSec = 0.6;
    const endSec = 1.2;
    const { inIndex, outIndex } = secondsToFrameRange(f, startSec, endSec, MAX);
    const expected = isFullRange(f, inIndex, outIndex)
      ? null
      : replayLogTrimBounds(f, inIndex, outIndex);
    expect(previewTrimBounds(f, startSec, endSec, MAX)).toEqual(expected);
  });
});

describe("isTrimmedOut", () => {
  it("lower 미만이면 잘림(true)", () => {
    expect(isTrimmedOut(10000, { lower: 10600, upper: 11800 })).toBe(true);
  });

  it("구간 안이면 유지(false)", () => {
    expect(isTrimmedOut(11000, { lower: 10600, upper: 11800 })).toBe(false);
  });

  it("upper 초과면 잘림(true)", () => {
    expect(isTrimmedOut(12000, { lower: 10600, upper: 11800 })).toBe(true);
  });

  it("경계값은 포함(inclusive, false)", () => {
    expect(isTrimmedOut(10600, { lower: 10600, upper: 11800 })).toBe(false);
    expect(isTrimmedOut(11800, { lower: 10600, upper: 11800 })).toBe(false);
  });

  it("upper=undefined면 상한 없음 — lower 이상은 전부 유지", () => {
    expect(isTrimmedOut(99999, { lower: 10600, upper: undefined })).toBe(false);
    expect(isTrimmedOut(10000, { lower: 10600, upper: undefined })).toBe(true);
  });
});
