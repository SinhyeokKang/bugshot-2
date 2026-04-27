import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { useSettingsStore } from "@/store/settings-store";
import { SETTINGS_STORAGE_KEY } from "@/lib/settings-storage";
import "@/styles/globals.css";

window.addEventListener("error", (e) => {
  if (e.message?.includes("ResizeObserver")) e.stopImmediatePropagation();
});

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
