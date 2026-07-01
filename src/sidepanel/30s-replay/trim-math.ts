import type { CapturedFrame } from "./frame-buffer";
import { computeFrameDurationsUs } from "./mp4-encoder";
import { REPLAY_LOG_GUARD_MS } from "@/sidepanel/lib/log-merge";

// 각 프레임의 영상 내 표시 시작 오프셋(ms) 누적 배열. encodeToMp4와 동일한
// computeFrameDurationsUs/maxFrameDurationMs를 써 <video> 시각과 프레임 인덱스 매핑이 드리프트하지 않게 한다.
export function frameOffsetsMs(
  frames: CapturedFrame[],
  maxFrameDurationMs: number,
): number[] {
  if (frames.length === 0) return [];
  const durUs = computeFrameDurationsUs(frames, { maxFrameDurationMs });
  const offsets: number[] = [];
  let accUs = 0;
  for (let i = 0; i < frames.length; i++) {
    offsets.push(accUs / 1000);
    accUs += durUs[i];
  }
  return offsets;
}

// 다이얼로그가 돌려준 초 구간을 프레임 인덱스 구간으로 환산(가장 가까운 프레임 스냅, clamp, 최소 2프레임).
export function secondsToFrameRange(
  frames: CapturedFrame[],
  startSec: number,
  endSec: number,
  maxFrameDurationMs: number,
): { inIndex: number; outIndex: number } {
  const offsets = frameOffsetsMs(frames, maxFrameDurationMs);
  const last = frames.length - 1;
  const snap = (sec: number): number => {
    const ms = sec * 1000;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < offsets.length; i++) {
      const dist = Math.abs(offsets[i] - ms);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  };
  let inIndex = Math.max(0, snap(startSec));
  let outIndex = Math.min(last, snap(endSec));
  if (outIndex <= inIndex) {
    if (inIndex < last) outIndex = inIndex + 1;
    else inIndex = Math.max(0, outIndex - 1);
  }
  return { inIndex, outIndex };
}

// 전체 구간(첫~끝 프레임) 선택 판정 — 재인코딩 생략용.
export function isFullRange(
  frames: CapturedFrame[],
  inIndex: number,
  outIndex: number,
): boolean {
  return inIndex === 0 && outIndex === frames.length - 1;
}

// 로그 trim 경계(wall-clock ms). apply-trim과 muted 미리보기가 공유한다.
export interface ReplayLogBounds {
  lower: number;
  upper: number | undefined;
}

// 프레임 인덱스 구간 → 로그 trim 경계. 비어있지 않은 frames 가정(호출자 책임).
// 안 자른 쪽은 capture 동작 보존: 앞(inIndex===0)은 가드밴드 유지, 끝(outIndex===last)은 상한 없음.
// 자른 쪽은 interior 프레임의 정확한 wall-clock 사용.
export function replayLogTrimBounds(
  frames: CapturedFrame[],
  inIndex: number,
  outIndex: number,
): ReplayLogBounds {
  const lower = inIndex === 0 ? frames[inIndex].timestamp - REPLAY_LOG_GUARD_MS : frames[inIndex].timestamp;
  const upper = outIndex === frames.length - 1 ? undefined : frames[outIndex].timestamp;
  return { lower, upper };
}

// 초 구간 → 로그 trim 경계. 전체 구간(잘림 없음)이면 null. apply-trim과 동일 경로
// (secondsToFrameRange → isFullRange → replayLogTrimBounds)를 타서 "흐림 = 실제 잘림"을 보장.
export function previewTrimBounds(
  frames: CapturedFrame[],
  startSec: number,
  endSec: number,
  maxFrameDurationMs: number,
): ReplayLogBounds | null {
  const { inIndex, outIndex } = secondsToFrameRange(frames, startSec, endSec, maxFrameDurationMs);
  if (isFullRange(frames, inIndex, outIndex)) return null;
  return replayLogTrimBounds(frames, inIndex, outIndex);
}

// 로그 timestamp가 trim 경계 밖이면 true(잘려나갈 후보). trimByTime과 동일 inclusive 경계.
export function isTrimmedOut(absTs: number, bounds: ReplayLogBounds): boolean {
  if (absTs < bounds.lower) return true;
  if (bounds.upper !== undefined && absTs > bounds.upper) return true;
  return false;
}
