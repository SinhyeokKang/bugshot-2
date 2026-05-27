import { useEditorStore } from "@/store/editor-store";
import { deleteNetworkLog, deleteConsoleLog, deleteActionLog } from "@/store/blob-db";
import { onPickerPermissionExpired } from "@/types/messages";
import {
  activateNetworkRecorder,
  activateConsoleRecorder,
  activateActionRecorder,
  clearNetworkRecorder,
  clearConsoleRecorder,
  clearActionRecorder,
} from "./picker-control";
import * as videoRecorder from "./video-recorder";

export async function startVideoCapture(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);

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

  useEditorStore.getState().startRecording({
    tabId,
    url: tab.url ?? "",
    title: tab.title ?? "",
  });
  try {
    await videoRecorder.startRecording(tabId);
  } catch (err) {
    useEditorStore.getState().cancelRecording();
    if (isTabCaptureUnavailable(err)) {
      onPickerPermissionExpired.fire();
    } else {
      console.warn("[bugshot] video recording failed to start", err);
    }
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
