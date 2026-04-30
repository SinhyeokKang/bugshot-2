import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { useSettingsStore } from "@/store/settings-store";
import { SETTINGS_STORAGE_KEY } from "@/lib/settings-storage";
import "@/styles/globals.css";

window.addEventListener("error", (e) => {
  if (e.message?.includes("ResizeObserver")) e.stopImmediatePropagation();
});

// markerjs2가 willReadFrequently 힌트 없이 2d 컨텍스트를 만들어 Canvas2D readback 경고가 뜸.
// 모든 2d 컨텍스트에 힌트를 주입해 경고를 원천 차단. 우리 canvas는 getImageData를 안 써서 부작용 없음.
const _origGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (
  this: HTMLCanvasElement,
  type: string,
  attrs?: CanvasRenderingContext2DSettings,
) {
  if (type === "2d") {
    return _origGetContext.call(this, type, { willReadFrequently: true, ...(attrs ?? {}) });
  }
  return _origGetContext.call(this, type as never, attrs as never);
} as typeof HTMLCanvasElement.prototype.getContext;

// SW가 persistOAuthTokens로 storage에 직접 쓴 토큰 변경을 메모리 store에도 반영.
// rehydrate가 같은 값을 다시 write해 onChanged가 재발화하므로 oldValue/newValue가
// 동일한 케이스는 스킵해 1회 추가 사이클을 끊는다.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const change = changes[SETTINGS_STORAGE_KEY];
  if (!change || change.oldValue === change.newValue) return;
  void useSettingsStore.persist.rehydrate();
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
