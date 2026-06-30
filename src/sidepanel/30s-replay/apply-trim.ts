import { useEditorStore } from "@/store/editor-store";
import { trimByTime } from "@/sidepanel/lib/log-merge";
import { saveNetworkLog, saveConsoleLog, saveActionLog } from "@/store/blob-db";
import {
  networkLogPersist,
  consoleLogPersist,
  actionLogPersist,
} from "@/sidepanel/hooks/usePickerMessages";
import type { CapturedFrame } from "./frame-buffer";
import { encodeToMp4, computeFrameDurationsUs, MAX_FRAME_DURATION_MS } from "./mp4-encoder";
import { secondsToFrameRange, isFullRange, replayLogTrimBounds } from "./trim-math";

// 리플레이 트리밍 적용: 선택 구간 프레임만 재인코딩 → 영상 메타 교체 + 로그 재trim.
// 타임베이스 분리 — 영상 메타는 raw 프레임 timestamp, 로그 trim은 replayLogBounds(guard 적용).
export async function applyReplayTrim(opts: {
  frames: CapturedFrame[];
  tabId: number;
  startSec: number;
  endSec: number;
}): Promise<void> {
  const { frames, tabId, startSec, endSec } = opts;
  const { inIndex, outIndex } = secondsToFrameRange(frames, startSec, endSec, MAX_FRAME_DURATION_MS);
  if (isFullRange(frames, inIndex, outIndex)) return;

  const sliced = frames.slice(inIndex, outIndex + 1);
  const { blob, thumbnail } = await encodeToMp4({ frames: sliced });

  const durUs = computeFrameDurationsUs(sliced, { maxFrameDurationMs: MAX_FRAME_DURATION_MS });
  const lastFrameDurationMs = durUs[durUs.length - 1] / 1000;
  const videoStartedAt = sliced[0].timestamp;
  const videoEndedAt = sliced[sliced.length - 1].timestamp + lastFrameDurationMs;

  // 로그 trim 경계(영상 타임베이스와 분리) — muted 미리보기와 동일 헬퍼 공유로 "흐림 = 실제 잘림" 보장.
  const { lower, upper } = replayLogTrimBounds(frames, inIndex, outIndex);

  // capture()와 동일하게 대기 중 버퍼 write를 폐기 후 trim본으로 덮어쓴다.
  networkLogPersist.discard();
  consoleLogPersist.discard();
  actionLogPersist.discard();

  const { networkLog, consoleLog, actionLog } = useEditorStore.getState();
  const saves: Promise<unknown>[] = [];
  if (networkLog) {
    const requests = trimByTime(networkLog.requests, (r) => r.startTime, lower, upper);
    const trimmed = { ...networkLog, requests, captured: requests.length };
    useEditorStore.getState().setNetworkLog(trimmed);
    saves.push(saveNetworkLog(`pending:${tabId}`, trimmed));
  }
  if (consoleLog) {
    const entries = trimByTime(consoleLog.entries, (e) => e.timestamp, lower, upper);
    const trimmed = { ...consoleLog, entries, captured: entries.length };
    useEditorStore.getState().setConsoleLog(trimmed);
    saves.push(saveConsoleLog(`pending:${tabId}`, trimmed));
  }
  if (actionLog) {
    const entries = trimByTime(actionLog.entries, (e) => e.timestamp, lower, upper);
    const trimmed = { ...actionLog, entries, captured: entries.length };
    useEditorStore.getState().setActionLog(trimmed);
    saves.push(saveActionLog(`pending:${tabId}`, trimmed));
  }
  // 영상 메타도 store에서 trim본으로 교체 — 로그 set과 함께 인메모리 상태를 원자적으로 맞춘다.
  useEditorStore.getState().replaceVideo(blob, thumbnail, videoStartedAt, videoEndedAt);
  // discard()는 in-flight IDB write를 못 막으므로 save 정착을 await(경계 밖 로그 부활 방지).
  // allSettled로 best-effort 저장(capture의 fire-and-forget과 동일) — 일부 save 실패가
  // 이미 맞춰둔 인메모리 영상·로그 일관성을 깨지 않게 한다.
  await Promise.allSettled(saves);
}
