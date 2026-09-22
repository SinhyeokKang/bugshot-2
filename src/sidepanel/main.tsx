import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { useSettingsStore } from "@/store/settings-store";
import {
  rehydrateIssuesFromExternalWrite,
  shouldSyncIssuesChange,
} from "@/store/issues-store";
import { SETTINGS_STORAGE_KEY } from "@/lib/settings-storage";
import { ISSUES_PERSIST_KEY } from "@/lib/session-keys";
import { createTrailingThrottle } from "./lib/trailing-throttle";
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

// SW가 persistOAuthTokens로 storage에 직접 쓴 토큰 변경을 메모리 store에도 반영.
// rehydrate가 같은 값을 다시 write해 onChanged가 재발화하므로 oldValue/newValue가
// 동일한 케이스는 스킵해 1회 추가 사이클을 끊는다.
// 에코 가드는 자기 write를 못 거른다 — 모든 뮤테이터가 updatedAt을 올려 직렬화 값이 매번
// 달라지기 때문이다. 제출 이슈 N건 목록을 열면 status 배지 N개가 각각 patchIssue → write를
// 내므로, throttle이 없으면 그 버스트가 전체 blob의 get+parse+merge를 N번 태운다(정합성이
// 아니라 순수 비용이고, 매 hydrate가 zustand hydrationVersion을 올려 마운트 prune까지 밀어낸다).
const issuesSync = createTrailingThrottle(() => {
  void rehydrateIssuesFromExternalWrite();
}, 300);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const settings = changes[SETTINGS_STORAGE_KEY];
  if (settings && settings.oldValue !== settings.newValue) {
    void useSettingsStore.persist.rehydrate();
  }
  // 사이드패널 인스턴스가 둘 이상이면(두 창의 패널, 패널 URL을 탭으로 연 경우) 각자 마운트
  // 시점 스냅샷을 계속 재직렬화해 마지막 write가 issues 배열을 통째로 덮는다 — 제출된 이슈가
  // Draft로 되돌아가 중복 제출을 부른다(#240). 다른 인스턴스의 write를 읽어 갱신한다.
  if (shouldSyncIssuesChange(changes[ISSUES_PERSIST_KEY])) {
    issuesSync.schedule();
  }
});

void resolveOsInfo();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
