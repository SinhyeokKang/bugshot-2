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
import {
  secondsToFrameRange,
  isFullRange,
  replayLogTrimBounds,
  recordingLogTrimBounds,
  pickTrimBitrate,
  type ReplayLogBounds,
} from "./trim-math";
import { encodeVideoRange } from "./encode-range";
import { generateThumbnail } from "@/sidepanel/lib/video-thumbnail";
import { pendingKey } from "@/lib/session-keys";

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
  const bounds = replayLogTrimBounds(frames, inIndex, outIndex);

  const saves = trimStoredLogs(tabId, bounds);
  // 영상 메타도 store에서 trim본으로 교체 — 로그 set과 함께 인메모리 상태를 원자적으로 맞춘다.
  // 이 호출과 위 로그 set 사이에 await을 넣지 말 것(그 사이 렌더가 "로그만 잘린" 상태를 노출).
  useEditorStore.getState().replaceVideo(blob, thumbnail, videoStartedAt, videoEndedAt, "frames");
  // discard()는 in-flight IDB write를 못 막으므로 save 정착을 await(경계 밖 로그 부활 방지).
  // allSettled로 best-effort 저장(capture의 fire-and-forget과 동일) — 일부 save 실패가
  // 이미 맞춰둔 인메모리 영상·로그 일관성을 깨지 않게 한다.
  await Promise.allSettled(saves);
}

// 트림본 로그를 IDB에 못 남긴 경우. 이 시점엔 replaceVideo가 이미 끝나 잘린 영상이 붙어 있고,
// 원본 로그가 pending에 남아 재오픈 시 되살아난다 — 인코딩 실패와 안내가 달라야 한다.
export class TrimLogsPersistError extends Error {
  constructor() {
    super("trimmed logs failed to persist");
    this.name = "TrimLogsPersistError";
  }
}

// 로그 3종을 경계로 좁혀 store·IDB에 반영. **동기**이고 save Promise 배열을 반환한다 —
// await은 호출자가 replaceVideo 뒤에 해야 로그 set ↔ 영상 메타 원자성이 유지된다.
export function trimStoredLogs(tabId: number, bounds: ReplayLogBounds): Promise<boolean>[] {
  const { lower, upper } = bounds;
  // capture()와 동일하게 대기 중 버퍼 write를 폐기 후 trim본으로 덮어쓴다.
  networkLogPersist.discard();
  consoleLogPersist.discard();
  actionLogPersist.discard();

  const { networkLog, consoleLog, actionLog } = useEditorStore.getState();
  const saves: Promise<boolean>[] = [];
  if (networkLog) {
    const requests = trimByTime(networkLog.requests, (r) => r.startTime, lower, upper);
    const trimmed = { ...networkLog, requests, captured: requests.length };
    useEditorStore.getState().setNetworkLog(trimmed);
    saves.push(saveNetworkLog(pendingKey(tabId), trimmed));
  }
  if (consoleLog) {
    const entries = trimByTime(consoleLog.entries, (e) => e.timestamp, lower, upper);
    const trimmed = { ...consoleLog, entries, captured: entries.length };
    useEditorStore.getState().setConsoleLog(trimmed);
    saves.push(saveConsoleLog(pendingKey(tabId), trimmed));
  }
  if (actionLog) {
    const entries = trimByTime(actionLog.entries, (e) => e.timestamp, lower, upper);
    const trimmed = { ...actionLog, entries, captured: entries.length };
    useEditorStore.getState().setActionLog(trimmed);
    saves.push(saveActionLog(pendingKey(tabId), trimmed));
  }
  return saves;
}

// 녹화(탭/화면) 트리밍 적용: 선택 구간 재인코딩 → 영상 메타 교체 + 로그 재trim.
// 전체 구간이면 아무것도 하지 않는다(재인코딩 skip · videoTrimmed는 false 유지).
// 인코딩·썸네일 단계에서 throw되면 replaceVideo 전이라 store는 원본 그대로 남는다 — 순서 유지.
export async function applyRecordingTrim(opts: {
  videoBlob: Blob;
  tabId: number;
  startedAt: number;
  // 벽시계 초. 미디어 타임 환산은 mediaScale로 encodeVideoRange에만 적용한다.
  startSec: number;
  endSec: number;
  durationSec: number;
  // 미디어 길이 / 벽시계 길이. 실사용에선 ~1이다 — MediaRecorder는 프레임을 캡처 시각으로
  // 스탬프해 컨테이너 duration이 벽시계 경과를 따라간다. 1에서 크게 벗어나면(꼬리 절단 등)
  // 인코딩 창은 비례 축소하고 로그·영상 메타 경계는 벽시계를 그대로 쓴다 — 두 전제가 동시에
  // 참일 수 없는 구간이라, 어긋나는 소스가 실제로 나오면 수동 검증으로 갈라야 한다.
  mediaScale: number;
  onProgress?: (ratio: number) => void;
}): Promise<void> {
  const { videoBlob, tabId, startedAt, startSec, endSec, durationSec, mediaScale, onProgress } = opts;
  const bounds = recordingLogTrimBounds(startedAt, startSec, endSec, durationSec);
  if (!bounds) return;

  const blob = await encodeVideoRange({
    blob: videoBlob,
    startSec: startSec * mediaScale,
    endSec: endSec * mediaScale,
    // 실측 비트레이트의 분모는 **미디어** 길이다 — blob 크기가 대응하는 게 그쪽이라,
    // 벽시계로 나누면 mediaScale<1(정지 화면 많은 녹화)에서 그만큼 과소평가된다.
    bitrate: pickTrimBitrate(videoBlob.size, durationSec * mediaScale),
    onProgress,
  });
  const thumbnail = await generateThumbnail(blob);

  const saves = trimStoredLogs(tabId, bounds);
  useEditorStore
    .getState()
    .replaceVideo(blob, thumbnail, startedAt + startSec * 1000, startedAt + endSec * 1000, "recording");
  const settled = await Promise.allSettled(saves);
  // 녹화는 drafting 전이 flushNow()로 원본 로그가 이미 pending에 박혀 있다. trim본 save가 실패하면
  // 패널 재오픈 시 hydrate가 원본을 되살려 "잘린 영상 + 안 잘린 로그"가 된다 — 호출자가 알려야 한다.
  // save 헬퍼는 내부에서 catch하고 false를 resolve한다(reject가 아니다) — 값으로 판정해야 한다.
  const failed = settled.some((r) => r.status === "rejected" || r.value === false);
  if (failed) throw new TrimLogsPersistError();
}
