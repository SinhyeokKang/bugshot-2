import type { CapturedFrame } from "./frame-buffer";
import type { TrimSource } from "./trim-source";
import { computeFrameDurationsUs } from "./mp4-encoder";
import { REPLAY_LOG_GUARD_MS } from "@/sidepanel/lib/log-merge";

// 2세대 인코딩 비트레이트 범위. 하한은 저모션 원본이 과하게 뭉개지지 않을 바닥,
// 상한은 자르기만 했는데 파일이 폭증하지 않게 막는 천장.
const TRIM_BITRATE_MIN = 800_000;
const TRIM_BITRATE_MAX = 4_000_000;

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

// 초 단위 전체 구간 판정 — isFullRange(프레임 인덱스)의 카운터파트. eps는 핸들 스냅 오차 흡수.
export function isFullRangeSec(
  startSec: number,
  endSec: number,
  durationSec: number,
  eps = 0.05,
): boolean {
  return startSec <= eps && endSec >= durationSec - eps;
}

// 녹화용 로그 trim 경계(벽시계 ms). 전체 구간이면 null.
// 가드밴드를 두지 않는다 — replayLogTrimBounds의 REPLAY_LOG_GUARD_MS는 프레임 timestamp 양자화
// (프레임 간격)를 흡수하려는 것이고, 녹화는 벽시계 연속축이라 흡수할 양자화가 없다.
// lower는 필수 number라 "하한 없음"을 -Infinity로 표현한다(isTrimmedOut·trimByTime과 호환).
export function recordingLogTrimBounds(
  startedAt: number,
  startSec: number,
  endSec: number,
  durationSec: number,
): ReplayLogBounds | null {
  if (isFullRangeSec(startSec, endSec, durationSec)) return null;
  return {
    lower: startSec > 0 ? startedAt + startSec * 1000 : Number.NEGATIVE_INFINITY,
    upper: endSec < durationSec ? startedAt + endSec * 1000 : undefined,
  };
}

// 소스 판별 후 위임 — 흐림 미리보기와 apply가 같은 경계를 보게 하는 단일 출처.
// range/opts를 객체로 받는다: 위치 인자 4개가 전부 number면 frames의 maxFrameDurationMs와
// recording의 durationSec이 뒤바뀌어도 컴파일이 통과한다.
export function previewBoundsFor(
  source: TrimSource,
  range: { startSec: number; endSec: number },
  opts: { durationSec: number; maxFrameDurationMs: number },
): ReplayLogBounds | null {
  if (source.kind === "frames") {
    return previewTrimBounds(source.frames, range.startSec, range.endSec, opts.maxFrameDurationMs);
  }
  return recordingLogTrimBounds(source.startedAt, range.startSec, range.endSec, opts.durationSec);
}

// 재인코딩 비트레이트 — 원본 실측 기반 적응. 녹화 상한은 2Mbps지만 저모션은 quality-bound라
// 실측이 훨씬 낮다(video-recorder.ts 참조). 고정값을 쓰면 자르기만 했는데 파일이 몇 배로 커진다.
export function pickTrimBitrate(byteSize: number, durationSec: number): number {
  if (!(durationSec > 0)) return TRIM_BITRATE_MAX;
  const observed = (byteSize * 8) / durationSec;
  return Math.min(TRIM_BITRATE_MAX, Math.max(TRIM_BITRATE_MIN, observed * 1.5));
}

// 로그 timestamp가 trim 경계 밖이면 true(잘려나갈 후보). trimByTime과 동일 inclusive 경계.
export function isTrimmedOut(absTs: number, bounds: ReplayLogBounds): boolean {
  if (absTs < bounds.lower) return true;
  if (bounds.upper !== undefined && absTs > bounds.upper) return true;
  return false;
}
