import { useEditorStore } from "@/store/editor-store";
import { deleteNetworkLog, deleteConsoleLog, deleteActionLog } from "@/store/blob-db";
import {
  activateNetworkRecorder,
  activateConsoleRecorder,
  activateActionRecorder,
} from "./picker-control";
import { clearNetworkRecorder, clearConsoleRecorder, clearActionRecorder } from "./recorder-control";
import * as videoRecorder from "./video-recorder";

// pending IDB 정리 → 3개 레코더 activate → clear 순. 탭/화면 녹화 진입 공통 전처리.
async function prepareRecorders(tabId: number): Promise<void> {
  // pending IndexedDB는 startRecording의 ...initial 리셋과 무관하게 정리 필요.
  deleteNetworkLog(`pending:${tabId}`).catch(() => {});
  deleteConsoleLog(`pending:${tabId}`).catch(() => {});
  deleteActionLog(`pending:${tabId}`).catch(() => {});

  await Promise.all([
    activateNetworkRecorder(tabId).catch((err) => console.warn("[bugshot] network recorder activate failed", err)),
    activateConsoleRecorder(tabId).catch((err) => console.warn("[bugshot] console recorder activate failed", err)),
    activateActionRecorder(tabId).catch((err) => console.warn("[bugshot] action recorder activate failed", err)),
  ]);
  await Promise.all([
    clearNetworkRecorder(tabId).catch((err) => console.warn("[bugshot] network recorder clear failed", err)),
    clearConsoleRecorder(tabId).catch((err) => console.warn("[bugshot] console recorder clear failed", err)),
    clearActionRecorder(tabId).catch((err) => console.warn("[bugshot] action recorder clear failed", err)),
  ]);
}

export async function startVideoCapture(tabId: number): Promise<void> {
  // 탭 스트림을 첫 await로 획득해 activeTab을 시험한다. cross-origin 이동 등으로 막히면
  // (사이드패널은 activeTab 재획득 불가 — Chrome 정책) user activation이 살아있는 동안
  // 화면 공유(getDisplayMedia)로 자동 폴백한다. getMediaStreamId 실패는 미디어 캡처 API가
  // 아니라 activation을 소비하지 않으므로 폴백 picker가 정상적으로 뜬다.
  let stream: MediaStream;
  try {
    stream = await videoRecorder.startTabStream(tabId);
  } catch (err) {
    if (isTabCaptureUnavailable(err)) {
      await startScreenCapture(tabId, { preferTab: true });
    } else {
      console.warn("[bugshot] video recording failed to start", err);
    }
    return;
  }

  await prepareRecorders(tabId);

  const tab = await chrome.tabs.get(tabId);
  useEditorStore.getState().startRecording(
    {
      tabId,
      url: tab.url ?? "",
      title: tab.title ?? "",
    },
    "tab",
  );
  try {
    videoRecorder.beginTabRecording(stream, tabId);
  } catch (err) {
    useEditorStore.getState().cancelRecording();
    stream.getTracks().forEach((t) => t.stop());
    console.warn("[bugshot] video recording failed to start", err);
  }
}

// 화면 전체 녹화 — getDisplayMedia를 첫 await로 호출(transient user activation 보존:
// 그 전에 다른 await를 두면 picker가 안 뜬다). 취소(NotAllowedError)는 조용히 no-op.
// preferTab: 탭 녹화 폴백 경로 — picker가 "Chrome 탭"을 먼저 보이게 유도(displaySurface "browser").
export async function startScreenCapture(tabId: number, opts?: { preferTab?: boolean }): Promise<void> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      // displaySurface — 일반 화면 녹화는 "monitor"(전체 화면 먼저), 탭 녹화 폴백은 "browser"(탭 먼저).
      // advisory 힌트라 강제는 아님. 1080p 상한 — 4K 전체화면 60초의 과압축·대용량(IndexedDB)을 방지. frameRate 12.
      video: { displaySurface: opts?.preferTab ? "browser" : "monitor", width: { max: 1920 }, height: { max: 1080 }, frameRate: 12 },
      audio: false,
    });
  } catch (err) {
    if (!(err instanceof DOMException && err.name === "NotAllowedError")) {
      console.warn("[bugshot] screen capture failed to start", err);
    }
    return;
  }

  await prepareRecorders(tabId);

  const tab = await chrome.tabs.get(tabId);
  useEditorStore.getState().startRecording(
    {
      tabId,
      url: tab.url ?? "",
      title: tab.title ?? "",
    },
    "screen",
  );
  try {
    videoRecorder.startScreenRecording(stream, tabId);
  } catch (err) {
    useEditorStore.getState().cancelRecording();
    stream.getTracks().forEach((t) => t.stop());
    console.warn("[bugshot] screen recording failed to start", err);
  }
}

function isTabCaptureUnavailable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("extension has not been invoked") ||
    msg.includes("chrome pages cannot be captured") ||
    msg.includes("activetab")
  );
}
