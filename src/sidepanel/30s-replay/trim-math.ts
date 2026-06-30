import type { CapturedFrame } from "./frame-buffer";
import { computeFrameDurationsUs } from "./mp4-encoder";

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
