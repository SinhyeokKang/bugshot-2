import { useEditorStore } from "@/store/editor-store";
import { deleteNetworkLog, deleteConsoleLog, deleteActionLog, deleteVideoBlob } from "@/store/blob-db";
import {
  activateNetworkRecorder,
  activateConsoleRecorder,
  activateActionRecorder,
} from "./picker-control";
import { clearNetworkRecorder, clearConsoleRecorder, clearActionRecorder } from "./recorder-control";
import { showAnnotation } from "./annotation-control";
import * as videoRecorder from "./video-recorder";
import { pendingKey } from "@/lib/session-keys";
import { isSupportedUrl } from "@/lib/url-support";
import { onPickerUnavailable } from "@/lib/app-events";

// 영상 캡처만 다른 5종처럼 ensureSupportedTab 게이트가 없었다 — 패널이 미지원 페이지에서
// 살아나면서 렌더 게이트(mode-record 미노출)가 단일 방어선이 됐다. 방어선을 두 겹으로 둔다:
//  (1) 아래 각 진입부의 동기 사전 판정 — await가 없어야 첫 await(스트림 획득)의 user gesture가
//      살아있다(POSTMORTEM 2026-06-28: getMediaStreamId는 핸들러의 생 첫 await여야 한다).
//  (2) 스트림 획득 뒤 이미 존재하는 chrome.tabs.get 결과로 하는 재확인 — 패널 판정이 아직
//      갱신되지 않은 전이 창을 잡는다. chrome API 왕복을 새로 늘리지 않는다.
// 둘 다 url 없는 녹화가 트래커 이슈로 등록되는 것을 막는다(design.md 대안 E 기각 근거).
function rejectUnsupported(stream: MediaStream): void {
  useEditorStore.getState().cancelRecording();
  stream.getTracks().forEach((t) => t.stop());
  onPickerUnavailable.fire();
}

// pending IDB 정리 → 3개 레코더 activate → clear 순. 탭/화면 녹화 진입 공통 전처리.
async function prepareRecorders(tabId: number): Promise<void> {
  // pending IndexedDB는 startRecording의 ...initial 리셋과 무관하게 정리 필요.
  deleteNetworkLog(pendingKey(tabId)).catch(() => {});
  deleteConsoleLog(pendingKey(tabId)).catch(() => {});
  deleteActionLog(pendingKey(tabId)).catch(() => {});
  deleteVideoBlob(pendingKey(tabId)).catch(() => {});

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

export async function startVideoCapture(
  tabId: number,
  opts?: { unsupported?: boolean },
): Promise<void> {
  // 동기 사전 판정 — await 금지(아래 첫 await의 gesture를 소비하면 폴백 picker가 안 뜬다).
  if (opts?.unsupported) {
    onPickerUnavailable.fire();
    return;
  }
  // 탭 스트림을 첫 await로 획득해 activeTab을 시험한다. cross-origin 이동 등으로 막히면
  // (사이드패널은 activeTab 재획득 불가 — Chrome 정책) user activation이 살아있는 동안
  // 화면 공유(getDisplayMedia)로 자동 폴백한다. getMediaStreamId 실패는 미디어 캡처 API가
  // 아니라 activation을 소비하지 않으므로 폴백 picker가 정상적으로 뜬다.
  let stream: MediaStream;
  try {
    stream = await videoRecorder.startTabStream(tabId);
  } catch (err) {
    if (isTabCaptureUnavailable(err)) {
      await startScreenCapture(tabId, { preferTab: true, unsupported: opts?.unsupported });
    } else {
      console.warn("[bugshot] video recording failed to start", err);
    }
    return;
  }

  await prepareRecorders(tabId);

  // tabs.get이 try 밖에 있으면(대상 탭이 그 사이 닫히면) 이미 확보한 스트림이 stop 없이 새어
  // 나가 공유 표시줄이 남는다 — 스트림을 잡은 뒤의 모든 실패는 같은 정리 경로를 타야 한다.
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!isSupportedUrl(tab.url)) {
      rejectUnsupported(stream);
      return;
    }
    useEditorStore.getState().startRecording(
      {
        tabId,
        url: tab.url ?? "",
        title: tab.title ?? "",
      },
      "tab",
    );
    videoRecorder.beginTabRecording(stream, tabId);
    void showAnnotation(tabId);
  } catch (err) {
    useEditorStore.getState().cancelRecording();
    stream.getTracks().forEach((t) => t.stop());
    console.warn("[bugshot] video recording failed to start", err);
  }
}

// 화면 전체 녹화 — getDisplayMedia를 첫 await로 호출(transient user activation 보존:
// 그 전에 다른 await를 두면 picker가 안 뜬다). 취소(NotAllowedError)는 조용히 no-op.
// preferTab: 탭 녹화 폴백 경로 — picker가 "Chrome 탭"을 먼저 보이게 유도(displaySurface "browser").
export async function startScreenCapture(
  tabId: number,
  opts?: { preferTab?: boolean; unsupported?: boolean },
): Promise<void> {
  // 동기 사전 판정 — 미지원이면 시스템 화면 공유 picker조차 띄우지 않는다.
  if (opts?.unsupported) {
    onPickerUnavailable.fire();
    return;
  }
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

  // tabs.get이 try 밖에 있으면(대상 탭이 그 사이 닫히면) 이미 확보한 스트림이 stop 없이 새어
  // 나가 공유 표시줄이 남는다 — 스트림을 잡은 뒤의 모든 실패는 같은 정리 경로를 타야 한다.
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!isSupportedUrl(tab.url)) {
      rejectUnsupported(stream);
      return;
    }
    useEditorStore.getState().startRecording(
      {
        tabId,
        url: tab.url ?? "",
        title: tab.title ?? "",
      },
      "screen",
    );
    videoRecorder.startScreenRecording(stream, tabId);
    void showAnnotation(tabId);
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
