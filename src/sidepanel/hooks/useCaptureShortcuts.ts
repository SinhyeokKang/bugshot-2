import { useEffect } from "react";
import {
  CAPTURE_SHORTCUT_MSG,
  resolveCaptureShortcut,
  type CaptureShortcutMessage,
} from "@/lib/capture-commands";
import { useEditorStore } from "@/store/editor-store";
import { startPicker, startAreaCapture } from "../picker-control";
import { startVideoCapture } from "../video-capture";

/**
 * background가 브로드캐스트한 캡처 단축키 메시지를 수신·게이트·디스패치한다.
 * active && tabId != null일 때만 리스너를 등록한다.
 */
export function useCaptureShortcuts(opts: { active: boolean; tabId: number | null }): void {
  const { active, tabId } = opts;

  useEffect(() => {
    if (!active || tabId == null) return;

    const listener = (message: unknown) => {
      const msg = message as Partial<CaptureShortcutMessage> | null | undefined;
      if (!msg || msg.type !== CAPTURE_SHORTCUT_MSG || msg.tabId !== tabId) return;
      const action = resolveCaptureShortcut(msg.command ?? "", useEditorStore.getState());
      if (action === "element") void startPicker(tabId);
      else if (action === "screenshot") void startAreaCapture(tabId);
      else if (action === "video") void startVideoCapture(tabId);
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [active, tabId]);
}
