import { useEffect, useRef, useState } from "react";
import {
  type EditorSnapshot,
  useEditorStore,
} from "@/store/editor-store";

const SAVE_DEBOUNCE_MS = 300;

export function sessionKey(tabId: number): string {
  return `editor:${tabId}`;
}

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
        useEditorStore.getState().hydrate(snap);
      }
      setHydrated(true);
    });

    const unsubStore = useEditorStore.subscribe((state, prev) => {
      if (state === prev) return;
      if (saveTimer.current != null) {
        window.clearTimeout(saveTimer.current);
      }
      saveTimer.current = window.setTimeout(() => {
        void chrome.storage.session.set({ [key]: snapshotFromState() });
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
        const { phase } = useEditorStore.getState();
        if (phase === "styling" || phase === "drafting") {
          useEditorStore.setState({ sessionExpired: true });
        }
      }
    };
    chrome.storage.onChanged.addListener(onChanged);

    return () => {
      cancelled = true;
      unsubStore();
      chrome.storage.onChanged.removeListener(onChanged);
      if (saveTimer.current != null) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    };
  }, [tabId]);

  return hydrated;
}
