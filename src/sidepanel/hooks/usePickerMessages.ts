import { useEffect } from "react";
import { useEditorStore } from "@/store/editor-store";
import { originOf } from "@/lib/session-keys";
import type { PickerMessage, ViewportRect } from "@/types/picker";
import { type BgInternalMessage, onPickerIframeUnsupported, onPickerPermissionExpired, sendBg } from "@/types/messages";
import { captureElementSnapshot, loadImage } from "@/sidepanel/capture";
import { clearPicker, collectTokens, maybeSurfacePermissionExpired, rebroadcastSentinelsToFrame } from "@/sidepanel/picker-control";
import { saveNetworkLog, saveConsoleLog, saveActionLog, saveInlineImage, dataUrlToBlob } from "@/store/blob-db";
import { shouldCompact, compactImage } from "@/sidepanel/lib/compactImage";
import { shouldPreserveBackgroundLogs } from "@/sidepanel/hooks/useBackgroundRecorder";
import { createLogPersistGuard } from "@/sidepanel/lib/log-persist-guard";
import {
  mergeLogItems,
  rebuildNetworkLog,
  rebuildConsoleLog,
  rebuildActionLog,
  isLogFrozen,
  NETWORK_MAX_ENTRIES,
  CONSOLE_MAX_ENTRIES,
  ACTION_MAX_ENTRIES,
} from "@/sidepanel/lib/log-merge";

let deferredActiveTabExpiry = false;
let lastLogClearAt = 0;

// 레코더 자동 flush(~200ms)로 *.data 수신 빈도가 올라도 IndexedDB write는 ~1s로 묶는다.
// store set은 매번(메모리), save만 가드. 30s replay trim 경로(use-30s-replay)가 discard로 stale 쓰기를 비운다.
const LOG_PERSIST_INTERVAL_MS = 1000;
export const networkLogPersist = createLogPersistGuard(
  (key: string, log: Parameters<typeof saveNetworkLog>[1]) => { saveNetworkLog(key, log).catch(() => {}); },
  LOG_PERSIST_INTERVAL_MS,
);
export const consoleLogPersist = createLogPersistGuard(
  (key: string, log: Parameters<typeof saveConsoleLog>[1]) => { saveConsoleLog(key, log).catch(() => {}); },
  LOG_PERSIST_INTERVAL_MS,
);
export const actionLogPersist = createLogPersistGuard(
  (key: string, log: Parameters<typeof saveActionLog>[1]) => { saveActionLog(key, log).catch(() => {}); },
  LOG_PERSIST_INTERVAL_MS,
);

export function usePickerMessages(myTabId: number | null): void {
  useEffect(() => {
    const unsub = useEditorStore.subscribe((state, prev) => {
      if (state.phase === "idle" && deferredActiveTabExpiry) {
        deferredActiveTabExpiry = false;
        onPickerPermissionExpired.fire();
      }
      // freeze는 stop 메시지가 아니라 phase 전이로 일어난다. frozen 후엔 *.data가 가드로 drop되므로,
      // 전이 시점에 대기 중 save를 강제 flush해야 마지막 로그 상태가 IDB에 박힌다(세션 재진입 출처).
      if (!isLogFrozen(prev.phase) && isLogFrozen(state.phase)) {
        networkLogPersist.flushNow();
        consoleLogPersist.flushNow();
        actionLogPersist.flushNow();
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    function handler(
      message: PickerMessage | BgInternalMessage | { type: string },
      sender: chrome.runtime.MessageSender,
    ) {
      if (!message || typeof message !== "object" || !("type" in message)) {
        return;
      }

      // content script가 보낸 메시지는 chrome.runtime.sendMessage로 모든 extension contexts에
      // broadcast된다. 다른 탭의 side panel 인스턴스가 같이 받아서 내 store/IDB를 덮는 걸 차단.
      // sender.tab은 content script에서 온 경우만 존재 — 미존재 시(side panel/background 내부
      // 통신) 통과시킨다.
      if (
        myTabId != null &&
        sender.tab?.id != null &&
        sender.tab.id !== myTabId
      ) {
        return;
      }

      if (message.type === "picker.selected") {
        const msg = message as Extract<PickerMessage, { type: "picker.selected" }>;
        // 요소 캡처(screenshot 세부 모드): styling 대신 요소 크롭 → drafting.
        if (useEditorStore.getState().captureMode === "screenshot") {
          const tabId = useEditorStore.getState().target?.tabId;
          if (tabId) void captureElementShot(tabId, msg.payload);
          return;
        }
        useEditorStore.getState().onElementSelected({
          selector: msg.payload.selector,
          tagName: msg.payload.tagName,
          classList: msg.payload.classList,
          computedStyles: msg.payload.computedStyles,
          specifiedStyles: msg.payload.specifiedStyles,
          propSources: msg.payload.propSources ?? {},
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
      } else if (message.type === "picker.selectionUpdated") {
        const msg = message as Extract<PickerMessage, { type: "picker.selectionUpdated" }>;
        useEditorStore.getState().updateSelectionStyles({
          specifiedStyles: msg.payload.specifiedStyles,
          propSources: msg.payload.propSources,
          computedStyles: msg.payload.computedStyles,
        });
      } else if (message.type === "picker.areaSelected") {
        const msg = message as Extract<PickerMessage, { type: "picker.areaSelected" }>;
        const { inlineCaptureTarget } = useEditorStore.getState();
        if (inlineCaptureTarget) {
          void captureAndInsertInline(inlineCaptureTarget, msg.rect, msg.viewport);
        } else {
          void captureAndCrop(msg.rect, msg.viewport);
        }
      } else if (message.type === "picker.cancelled") {
        const { inlineCaptureTarget } = useEditorStore.getState();
        if (inlineCaptureTarget) {
          useEditorStore.getState().cancelInlineCapture();
        } else {
          const { phase } = useEditorStore.getState();
          if (phase === "capturing") {
            useEditorStore.getState().reset();
          } else {
            useEditorStore.getState().cancelPicking();
          }
        }
      } else if (message.type === "picker.iframeUnsupported") {
        useEditorStore.getState().cancelPicking();
        onPickerIframeUnsupported.fire();
      } else if (message.type === "activeTabExpiredDeferred") {
        const msg = message as Extract<BgInternalMessage, { type: "activeTabExpiredDeferred" }>;
        if (myTabId != null && msg.tabId !== myTabId) return;
        deferredActiveTabExpiry = true;
      } else if (message.type === "frameCommitted") {
        // 캡처 시작 이후 커밋된 iframe에 보유 sentinel 재발행 → dormant 레코더 활성화.
        const msg = message as Extract<BgInternalMessage, { type: "frameCommitted" }>;
        if (myTabId != null && msg.tabId !== myTabId) return;
        rebroadcastSentinelsToFrame(msg.tabId, msg.frameId);
      } else if (message.type === "logClear") {
        // 녹화 중(recording)엔 cross-origin/reload 이동도 한 버그 시나리오의 일부 —
        // background 레코더가 보존하는 phase 집합과 동일하게 버퍼를 비우지 않는다.
        // (단 *.data 머지는 isLogFrozen 기준이라 녹화 중 새 로그 유입은 계속된다.)
        if (shouldPreserveBackgroundLogs(useEditorStore.getState().phase)) return;
        const msg = message as Extract<BgInternalMessage, { type: "logClear" }>;
        if (myTabId != null && msg.tabId !== myTabId) return;
        lastLogClearAt = Date.now();
        // store clear가 IDB의 pending 로그를 delete하므로, 대기 중 throttle write를 먼저 폐기해
        // delete 이후 stale 버퍼가 IDB에 부활하는 걸 막는다(30s replay trim 경로와 대칭).
        networkLogPersist.discard();
        consoleLogPersist.discard();
        actionLogPersist.discard();
        const store = useEditorStore.getState();
        store.clearNetworkLog(myTabId);
        store.clearConsoleLog(myTabId);
        store.clearActionLog(myTabId);
      } else if (message.type === "networkRecorder.data") {
        if (isLogFrozen(useEditorStore.getState().phase)) return;
        const msg = message as Extract<PickerMessage, { type: "networkRecorder.data" }>;
        const requests = lastLogClearAt > 0
          ? msg.payload.requests.filter((r) => r.startTime >= lastLogClearAt)
          : msg.payload.requests;
        if (requests.length === 0) return;
        const existing = useEditorStore.getState().networkLog;
        const merged = mergeLogItems(
          existing?.requests ?? [],
          requests,
          (r) => r.startTime,
          NETWORK_MAX_ENTRIES,
          originOf(useEditorStore.getState().target?.url),
        );
        const log = rebuildNetworkLog(existing, merged, {
          totalSeen: msg.payload.totalSeen,
          warnings: msg.payload.warnings,
        });
        useEditorStore.getState().setNetworkLog(log);
        const tabId = useEditorStore.getState().target?.tabId;
        if (tabId) {
          networkLogPersist.push(`pending:${tabId}`, log);
        }
      } else if (message.type === "consoleRecorder.data") {
        if (isLogFrozen(useEditorStore.getState().phase)) return;
        const msg = message as Extract<PickerMessage, { type: "consoleRecorder.data" }>;
        const entries = lastLogClearAt > 0
          ? msg.payload.entries.filter((e) => e.timestamp >= lastLogClearAt)
          : msg.payload.entries;
        if (entries.length === 0) return;
        const existing = useEditorStore.getState().consoleLog;
        const merged = mergeLogItems(
          existing?.entries ?? [],
          entries,
          (e) => e.timestamp,
          CONSOLE_MAX_ENTRIES,
          originOf(useEditorStore.getState().target?.url),
        );
        const log = rebuildConsoleLog(existing, merged, {
          totalSeen: msg.payload.totalSeen,
        });
        useEditorStore.getState().setConsoleLog(log);
        const tabId = useEditorStore.getState().target?.tabId;
        if (tabId) {
          consoleLogPersist.push(`pending:${tabId}`, log);
        }
      } else if (message.type === "actionRecorder.data") {
        if (isLogFrozen(useEditorStore.getState().phase)) return;
        const msg = message as Extract<PickerMessage, { type: "actionRecorder.data" }>;
        const entries = lastLogClearAt > 0
          ? msg.payload.entries.filter((e) => e.timestamp >= lastLogClearAt)
          : msg.payload.entries;
        if (entries.length === 0) return;
        const existing = useEditorStore.getState().actionLog;
        const merged = mergeLogItems(
          existing?.entries ?? [],
          entries,
          (e) => e.timestamp,
          ACTION_MAX_ENTRIES,
        );
        const log = rebuildActionLog(existing, merged, {
          totalSeen: msg.payload.totalSeen,
        });
        useEditorStore.getState().setActionLog(log);
        const tabId = useEditorStore.getState().target?.tabId;
        if (tabId) {
          actionLogPersist.push(`pending:${tabId}`, log);
        }
      }
    }

    chrome.runtime.onMessage.addListener(handler);

    return () => {
      chrome.runtime.onMessage.removeListener(handler);
    };
  }, [myTabId]);
}

async function captureElementShot(
  tabId: number,
  payload: { selector: string; tagName: string; viewport: { width: number; height: number } },
): Promise<void> {
  // captureElementSnapshot은 권한 만료/캡처 실패 시 내부에서 안내 후 null 반환 → 빈 drafting 진입 금지.
  const img = await captureElementSnapshot(tabId);
  if (!img) {
    useEditorStore.getState().reset();
    return;
  }
  useEditorStore.getState().onElementShot(
    { selector: payload.selector, tagName: payload.tagName },
    img,
    payload.viewport,
  );
  void clearPicker(tabId);
}

async function captureAndCrop(rect: ViewportRect, viewport: { width: number; height: number }): Promise<void> {
  try {
    const tabId = useEditorStore.getState().target?.tabId;
    if (!tabId) return;
    const dataUrl = await sendBg<string>({ type: "captureVisibleTab", tabId });
    const dpr = window.devicePixelRatio || 1;
    const cropped = await cropImage(dataUrl, {
      x: rect.x * dpr,
      y: rect.y * dpr,
      width: rect.width * dpr,
      height: rect.height * dpr,
    });
    useEditorStore.getState().onAreaCaptured(cropped, viewport);
  } catch (err) {
    if (!maybeSurfacePermissionExpired(err)) {
      console.error("[bugshot] capture and crop failed", err);
    }
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
  return canvas.toDataURL("image/webp", 0.92);
}

async function captureAndInsertInline(
  sectionId: string,
  rect: ViewportRect,
  _viewport: { width: number; height: number },
): Promise<void> {
  try {
    const tabId = useEditorStore.getState().target?.tabId;
    if (!tabId) return;
    const dataUrl = await sendBg<string>({ type: "captureVisibleTab", tabId });
    const dpr = window.devicePixelRatio || 1;
    const cropped = await cropImage(dataUrl, {
      x: rect.x * dpr,
      y: rect.y * dpr,
      width: rect.width * dpr,
      height: rect.height * dpr,
    });
    let blob = dataUrlToBlob(cropped);
    const bitmap = await createImageBitmap(blob);
    if (shouldCompact(bitmap.width, blob.type)) {
      blob = await compactImage(bitmap);
    } else {
      bitmap.close();
    }
    const refId = crypto.randomUUID().slice(0, 8);
    await saveInlineImage(refId, blob);
    useEditorStore.getState().appendInlineImage(sectionId, refId);
  } catch (err) {
    if (!maybeSurfacePermissionExpired(err)) {
      console.error("[bugshot] inline capture failed", err);
    }
  } finally {
    useEditorStore.getState().cancelInlineCapture();
  }
}
