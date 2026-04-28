import { useEffect, useRef, useState } from "react";
import { pageKeyOf, sessionKey } from "@/lib/session-keys";
import {
  type EditorSnapshot,
  useEditorStore,
} from "@/store/editor-store";
import { clearPicker } from "../picker-control";

const SAVE_DEBOUNCE_MS = 300;

// videoBlob 제외: Blob은 chrome.storage 직렬화 불가 → IndexedDB(saveVideoBlob)로 별도 저장
function snapshotFromState(): EditorSnapshot {
  const s = useEditorStore.getState();
  return {
    captureMode: s.captureMode,
    phase: s.phase,
    target: s.target,
    selection: s.selection,
    styleEdits: s.styleEdits,
    tokens: s.tokens,
    beforeImage: s.beforeImage,
    afterImage: s.afterImage,
    screenshotRaw: s.screenshotRaw,
    screenshotAnnotated: s.screenshotAnnotated,
    screenshotViewport: s.screenshotViewport,
    screenshotCapturedAt: s.screenshotCapturedAt,
    videoThumbnail: s.videoThumbnail,
    videoViewport: s.videoViewport,
    videoCapturedAt: s.videoCapturedAt,
    draft: s.draft,
    issueFields: s.issueFields,
    currentIssueId: s.currentIssueId,
    submitResult: s.submitResult,
  };
}

export function useEditorSessionSync(tabId: number | null): boolean {
  const [hydrated, setHydrated] = useState(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    if (tabId == null) {
      setHydrated(true);
      return;
    }

    let cancelled = false;
    const key = sessionKey(tabId);

    void chrome.storage.session.get(key).then((data) => {
      if (cancelled) return;
      const snap = data[key] as EditorSnapshot | undefined;
      if (snap) {
        if (snap.phase === "picking" || snap.phase === "recording" || snap.phase === "capturing") {
          snap.phase = "idle";
        }
        useEditorStore.getState().hydrate(snap);
      }
      setHydrated(true);
    });

    const unsubStore = useEditorStore.subscribe((state, prev) => {
      if (state === prev) return;
      if (state.sessionExpired) return;
      if (saveTimer.current != null) {
        window.clearTimeout(saveTimer.current);
      }
      saveTimer.current = window.setTimeout(() => {
        if (useEditorStore.getState().sessionExpired) return;
        const snap = snapshotFromState();
        void chrome.storage.session
          .set({ [key]: snap })
          .catch(() => {
            const lite = { ...snap, beforeImage: null, afterImage: null, screenshotRaw: null, screenshotAnnotated: null, videoThumbnail: null };
            void chrome.storage.session.set({ [key]: lite }).catch(() => {});
          });
      }, SAVE_DEBOUNCE_MS);
    });

    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== "session") return;
      const change = changes[key];
      if (!change) return;
      if (change.newValue == null) {
        const { phase, captureMode } = useEditorStore.getState();
        const needsExpiry = captureMode === "element" && phase === "styling";
        if (needsExpiry) {
          if (saveTimer.current != null) {
            window.clearTimeout(saveTimer.current);
            saveTimer.current = null;
          }
          useEditorStore.setState({ sessionExpired: true });
        }
        const needsReset = phase === "picking" ||
          (captureMode === "screenshot" && phase === "capturing");
        if (needsReset) {
          useEditorStore.getState().reset();
        }
        if (captureMode === "element" && (needsExpiry || needsReset)) {
          void clearPicker(tabId).catch(() => {});
        }
        if (captureMode === "screenshot" && phase === "capturing") {
          void chrome.tabs.sendMessage(tabId, { type: "picker.cancelAreaSelect" }).catch(() => {});
        }
      }
    };
    chrome.storage.onChanged.addListener(onChanged);

    const onTabUpdated = (
      updatedTabId: number,
      info: chrome.tabs.TabChangeInfo,
    ) => {
      if (updatedTabId !== tabId || !info.url) return;
      const state = useEditorStore.getState();
      if (state.sessionExpired) return;
      const prevKey = pageKeyOf(state.target?.url);
      const newKey = pageKeyOf(info.url);
      if (!prevKey || prevKey === newKey) return;

      const { phase, captureMode } = state;

      const needsExpiry = captureMode === "element" && phase === "styling";
      if (needsExpiry) {
        if (saveTimer.current != null) {
          window.clearTimeout(saveTimer.current);
          saveTimer.current = null;
        }
        useEditorStore.setState({ sessionExpired: true });
        void clearPicker(tabId).catch(() => {});
        return;
      }

      const needsReset =
        phase === "picking" ||
        (captureMode === "screenshot" && phase === "capturing");
      if (needsReset) {
        useEditorStore.getState().reset();
        if (captureMode === "element") {
          void clearPicker(tabId).catch(() => {});
        }
        if (captureMode === "screenshot") {
          void chrome.tabs
            .sendMessage(tabId, { type: "picker.cancelAreaSelect" })
            .catch(() => {});
        }
        return;
      }

      if (
        captureMode === "element" &&
        (phase === "drafting" || phase === "previewing" || phase === "done")
      ) {
        void clearPicker(tabId).catch(() => {});
      }

    };
    chrome.tabs.onUpdated.addListener(onTabUpdated);

    return () => {
      cancelled = true;
      unsubStore();
      chrome.storage.onChanged.removeListener(onChanged);
      chrome.tabs.onUpdated.removeListener(onTabUpdated);
      if (saveTimer.current != null) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    };
  }, [tabId]);

  return hydrated;
}
