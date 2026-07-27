import { describe, it, expect } from "vitest";
import {
  frameOffsetsMs,
  secondsToFrameRange,
  isFullRange,
  replayLogTrimBounds,
  previewTrimBounds,
  isTrimmedOut,
  isFullRangeSec,
  recordingLogTrimBounds,
  previewBoundsFor,
  pickTrimBitrate,
} from "../trim-math";
import { computeFrameDurationsUs } from "../mp4-encoder";
import { REPLAY_LOG_GUARD_MS } from "@/sidepanel/lib/log-merge";
import type { CapturedFrame } from "../frame-buffer";
import type { TrimSource } from "../trim-source";

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

// ─────────────────────────────────────────────────────────────────────────────
// 녹화(recording) 소스 — 벽시계 선형 축. 프레임 인덱스가 아니라 초 단위로 판정한다.
// ─────────────────────────────────────────────────────────────────────────────

describe("isFullRangeSec", () => {
  it("전체 구간이면 true", () => {
    expect(isFullRangeSec(0, 10, 10)).toBe(true);
  });

  it("앞만 자르면 false", () => {
    expect(isFullRangeSec(1, 10, 10)).toBe(false);
  });

  it("뒤만 자르면 false", () => {
    expect(isFullRangeSec(0, 9, 10)).toBe(false);
  });

  it("eps 안쪽 미세 오차(핸들 스냅)는 전체 구간으로 본다", () => {
    expect(isFullRangeSec(0.03, 9.97, 10)).toBe(true);
  });

  it("eps 밖이면 전체 구간이 아니다", () => {
    expect(isFullRangeSec(0.2, 10, 10)).toBe(false);
    expect(isFullRangeSec(0, 9.8, 10)).toBe(false);
  });
});

describe("recordingLogTrimBounds", () => {
  // 벽시계 base=10000ms, 길이 10초 → [10000, 20000].
  const BASE = 10000;
  const DUR = 10;

  it("전체 구간이면 null(잘림 없음)", () => {
    expect(recordingLogTrimBounds(BASE, 0, DUR, DUR)).toBeNull();
  });

  it("앞만 자르면 lower=startedAt+startSec*1000, 상한 없음", () => {
    expect(recordingLogTrimBounds(BASE, 2, DUR, DUR)).toEqual({
      lower: 12000,
      upper: undefined,
    });
  });

  it("뒤만 자르면 하한 없음(-Infinity), upper=startedAt+endSec*1000", () => {
    expect(recordingLogTrimBounds(BASE, 0, 8, DUR)).toEqual({
      lower: Number.NEGATIVE_INFINITY,
      upper: 18000,
    });
  });

  it("양쪽 자르면 lower/upper 둘 다 유한값", () => {
    const b = recordingLogTrimBounds(BASE, 2, 8, DUR);
    expect(b).toEqual({ lower: 12000, upper: 18000 });
    expect(Number.isFinite(b!.lower)).toBe(true);
    expect(Number.isFinite(b!.upper!)).toBe(true);
  });

  // 리플레이는 프레임 timestamp 양자화를 흡수하려고 가드밴드를 두지만,
  // 녹화는 벽시계 연속축이라 양자화가 없어 가드밴드를 적용하지 않는다.
  it("가드밴드를 적용하지 않는다 (REPLAY_LOG_GUARD_MS 미반영)", () => {
    const b = recordingLogTrimBounds(BASE, 0, 8, DUR)!;
    expect(b.lower).not.toBe(BASE - REPLAY_LOG_GUARD_MS);
    expect(recordingLogTrimBounds(BASE, 2, 8, DUR)!.lower).toBe(12000);
  });

  it("경계값은 잘리지 않는다 (isTrimmedOut inclusive — trimByTime과 동일)", () => {
    const b = recordingLogTrimBounds(BASE, 2, 8, DUR)!;
    expect(isTrimmedOut(12000, b)).toBe(false);
    expect(isTrimmedOut(18000, b)).toBe(false);
    expect(isTrimmedOut(11999, b)).toBe(true);
    expect(isTrimmedOut(18001, b)).toBe(true);
  });

  it("lower=-Infinity면 아무리 이른 timestamp도 자르지 않는다", () => {
    const b = recordingLogTrimBounds(BASE, 0, 8, DUR)!;
    expect(isTrimmedOut(0, b)).toBe(false);
    expect(isTrimmedOut(-99999, b)).toBe(false);
  });
});

describe("previewBoundsFor", () => {
  const f = frames(10000, 10600, 11200, 11800, 12400); // 오프셋 [0,600,1200,1800,2400]ms
  const framesSource: TrimSource = { kind: "frames", frames: f };
  const recordingSource: TrimSource = { kind: "recording", startedAt: 10000, endedAt: 20000 };

  it("frames 소스는 previewTrimBounds와 동일 결과", () => {
    expect(
      previewBoundsFor(
        framesSource,
        { startSec: 0.6, endSec: 1.2 },
        { durationSec: 3, maxFrameDurationMs: MAX },
      ),
    ).toEqual(previewTrimBounds(f, 0.6, 1.2, MAX));
  });

  it("frames 소스의 전체 구간은 null", () => {
    expect(
      previewBoundsFor(
        framesSource,
        { startSec: 0, endSec: 99 },
        { durationSec: 3, maxFrameDurationMs: MAX },
      ),
    ).toBeNull();
  });

  it("recording 소스는 recordingLogTrimBounds와 동일 결과", () => {
    expect(
      previewBoundsFor(
        recordingSource,
        { startSec: 2, endSec: 8 },
        { durationSec: 10, maxFrameDurationMs: MAX },
      ),
    ).toEqual(recordingLogTrimBounds(10000, 2, 8, 10));
  });

  it("recording 소스의 전체 구간은 null", () => {
    expect(
      previewBoundsFor(
        recordingSource,
        { startSec: 0, endSec: 10 },
        { durationSec: 10, maxFrameDurationMs: MAX },
      ),
    ).toBeNull();
  });
});

describe("pickTrimBitrate", () => {
  // clamp(byteSize * 8 / durationSec * 1.5, 800_000, 4_000_000)
  it("저모션(3MB/60s)은 하한 800kbps로 clamp", () => {
    // 3e6*8/60 = 400_000 → ×1.5 = 600_000 → 하한
    expect(pickTrimBitrate(3_000_000, 60)).toBe(800_000);
  });

  it("고모션(15MB/60s)은 실측의 1.5배", () => {
    // 15e6*8/60 = 2_000_000 → ×1.5 = 3_000_000
    expect(pickTrimBitrate(15_000_000, 60)).toBe(3_000_000);
  });

  it("상한 초과는 4Mbps로 clamp", () => {
    // 60e6*8/60 = 8_000_000 → ×1.5 = 12_000_000 → 상한
    expect(pickTrimBitrate(60_000_000, 60)).toBe(4_000_000);
  });

  it("빈 블롭은 하한", () => {
    expect(pickTrimBitrate(0, 60)).toBe(800_000);
  });

  // durationSec=0이면 실측이 불가능(0 나눗셈) — NaN/Infinity를 흘리지 말고 상한으로 떨어뜨린다.
  it("durationSec=0이어도 NaN/Infinity를 반환하지 않는다", () => {
    expect(pickTrimBitrate(1_000_000, 0)).toBe(4_000_000);
    expect(pickTrimBitrate(0, 0)).toBe(4_000_000);
    expect(Number.isFinite(pickTrimBitrate(1_000_000, 0))).toBe(true);
  });
});
