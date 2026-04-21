import { useEffect } from "react";
import { useEditorStore } from "@/store/editor-store";
import type { PickerMessage } from "@/types/picker";
import { captureElementSnapshot } from "../capture";
import { collectTokens } from "../picker-control";

export function usePickerMessages(): void {
  useEffect(() => {
    function handler(message: PickerMessage) {
      if (!message || typeof message !== "object" || !("type" in message)) {
        return;
      }

      if (message.type === "picker.selected") {
        useEditorStore.getState().onElementSelected({
          selector: message.payload.selector,
          tagName: message.payload.tagName,
          classList: message.payload.classList,
          computedStyles: message.payload.computedStyles,
          specifiedStyles: message.payload.specifiedStyles,
          hasParent: message.payload.hasParent,
          hasChild: message.payload.hasChild,
          text: message.payload.text,
          viewport: message.payload.viewport,
          capturedAt: Date.now(),
        });
        const tabId = useEditorStore.getState().target?.tabId;
        if (tabId) {
          void collectTokens(tabId).then((tokens) => {
            useEditorStore.getState().setTokens(tokens);
          });
          void captureElementSnapshot(tabId).then((img) => {
            if (img) useEditorStore.getState().setBeforeImage(img);
          });
        }
      } else if (message.type === "picker.cancelled") {
        useEditorStore.getState().cancelPicking();
      }
    }

    chrome.runtime.onMessage.addListener(handler);
    return () => {
      chrome.runtime.onMessage.removeListener(handler);
    };
  }, []);
}
