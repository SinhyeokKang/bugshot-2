import { useEffect } from "react";
import { useEditorStore } from "@/store/editor-store";
import type { PickerMessage, ViewportRect } from "@/types/picker";
import { captureElementSnapshot, loadImage } from "../capture";
import { collectTokens } from "../picker-control";

export function usePickerMessages(): void {
  useEffect(() => {
    function handler(message: PickerMessage | { type: string }) {
      if (!message || typeof message !== "object" || !("type" in message)) {
        return;
      }

      if (message.type === "picker.selected") {
        const msg = message as Extract<PickerMessage, { type: "picker.selected" }>;
        useEditorStore.getState().onElementSelected({
          selector: msg.payload.selector,
          tagName: msg.payload.tagName,
          classList: msg.payload.classList,
          computedStyles: msg.payload.computedStyles,
          specifiedStyles: msg.payload.specifiedStyles,
          hasParent: msg.payload.hasParent,
          hasChild: msg.payload.hasChild,
          text: msg.payload.text,
          viewport: msg.payload.viewport,
          capturedAt: Date.now(),
        });
        const tabId = useEditorStore.getState().target?.tabId;
        if (tabId) {
          void collectTokens(tabId)
            .then((tokens) => {
              useEditorStore.getState().setTokens(tokens);
            })
            .catch((err) => console.warn("[bugshot] collectTokens failed", err));
          void captureElementSnapshot(tabId)
            .then((img) => {
              if (img) useEditorStore.getState().setBeforeImage(img);
            })
            .catch((err) => console.warn("[bugshot] before-image capture failed", err));
        }
      } else if (message.type === "picker.areaSelected") {
        const msg = message as Extract<PickerMessage, { type: "picker.areaSelected" }>;
        void captureAndCrop(msg.rect, msg.viewport);
      } else if (message.type === "picker.cancelled") {
        const { phase } = useEditorStore.getState();
        if (phase === "capturing") {
          useEditorStore.getState().reset();
        } else {
          useEditorStore.getState().cancelPicking();
        }
      }
    }

    chrome.runtime.onMessage.addListener(handler);

    return () => {
      chrome.runtime.onMessage.removeListener(handler);
    };
  }, []);
}

async function captureAndCrop(rect: ViewportRect, viewport: { width: number; height: number }): Promise<void> {
  try {
    const tabId = useEditorStore.getState().target?.tabId;
    if (!tabId) return;
    const tab = await chrome.tabs.get(tabId);
    if (!tab.windowId) return;
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png",
    });
    const dpr = window.devicePixelRatio || 1;
    const cropped = await cropImage(dataUrl, {
      x: rect.x * dpr,
      y: rect.y * dpr,
      width: rect.width * dpr,
      height: rect.height * dpr,
    });
    useEditorStore.getState().onAreaCaptured(cropped, viewport);
  } catch (err) {
    console.error("[bugshot] capture and crop failed", err);
    useEditorStore.getState().reset();
  }
}

async function cropImage(
  dataUrl: string,
  rect: { x: number; y: number; width: number; height: number },
): Promise<string> {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = rect.width;
  canvas.height = rect.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas context failed");
  ctx.drawImage(
    img,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    rect.width,
    rect.height,
  );
  return canvas.toDataURL("image/jpeg", 0.92);
}
