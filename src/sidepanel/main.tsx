import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installSettingsSync } from "./lib/settings-sync";
import { installIssuesSync } from "./lib/issues-sync";
import { resolveOsInfo } from "./lib/osInfo";
import "@/styles/globals.css";

window.addEventListener("error", (e) => {
  if (e.message?.includes("ResizeObserver")) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
});

// Konva hit-detection canvas가 getImageData로 픽셀을 빈번히 readback하므로 모든 2d 컨텍스트에
// willReadFrequently 힌트를 주입해 Canvas2D readback 경고를 원천 차단 + hit readback 최적화.
// 렌더 canvas는 readback이 없어 이 힌트가 미세하게 비최적(GPU 경로 회피 신호)이나 사이드패널
// 소형 캔버스라 무시 가능. (패치 제거 시 경고 회귀 — 로직 유지, 주석만 사실에 맞게 갱신.)
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

installSettingsSync();

// 크로스 인스턴스 issue 목록 동기화(#240). 규칙·불변식은 issues-sync.ts / issues-store.ts.
installIssuesSync();

void resolveOsInfo();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
