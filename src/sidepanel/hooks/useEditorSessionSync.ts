import { useEffect, useRef, useState } from "react";
import { pageKeyOf, sessionKey } from "@/lib/session-keys";
import {
  type EditorDraft,
  type EditorSnapshot,
  useEditorStore,
} from "@/store/editor-store";
import { onSessionSaveExhausted } from "@/types/messages";
import { clearPicker, rebindStylingSession } from "@/sidepanel/picker-control";
import { getNetworkLog, getConsoleLog, getActionLog, getVideoBlob, pruneOrphanInlineImages } from "@/store/blob-db";
import { extractInlineRefs } from "@/sidepanel/lib/resolveInlineImages";

function migrateLegacyDraft(snap: EditorSnapshot): EditorSnapshot {
  if (!snap.draft) return snap;
  const legacy = snap.draft as unknown as {
    title?: string;
    body?: string;
    expectedResult?: string;
    sections?: Record<string, string>;
  };
  if (legacy.sections) return snap;
  const sections: Record<string, string> = {};
  if (legacy.body) sections.description = legacy.body;
  if (legacy.expectedResult) sections.expectedResult = legacy.expectedResult;
  const migrated: EditorDraft = { title: legacy.title ?? "", sections };
  return { ...snap, draft: migrated };
}

const SAVE_DEBOUNCE_MS = 300;
const DRAFT_PHASES = new Set(["drafting", "previewing", "done"]);

// videoBlob 제외: Blob은 chrome.storage 직렬화 불가 → 로그와 동일하게 IndexedDB(pending:${tabId})에
// 별도 저장하고 hydrate가 복원. onRecordingComplete/replaceVideo 시점에 미러링된다.
function snapshotFromState(): EditorSnapshot {
  const s = useEditorStore.getState();
  return {
    captureMode: s.captureMode,
    phase: s.phase,
    targetPlatform: s.targetPlatform,
    target: s.target,
    selection: s.selection,
    shotSelector: s.shotSelector,
    styleEdits: s.styleEdits,
    tokens: s.tokens,
    beforeImage: s.beforeImage,
    afterImage: s.afterImage,
    bufferedElements: s.bufferedElements,
    screenshotRaw: s.screenshotRaw,
    screenshotAnnotated: s.screenshotAnnotated,
    screenshotViewport: s.screenshotViewport,
    screenshotCapturedAt: s.screenshotCapturedAt,
    videoThumbnail: s.videoThumbnail,
    videoViewport: s.videoViewport,
    videoCapturedAt: s.videoCapturedAt,
    videoStartedAt: s.videoStartedAt,
    videoEndedAt: s.videoEndedAt,
    videoTrimmed: s.videoTrimmed,
    freeformViewport: s.freeformViewport,
    freeformCapturedAt: s.freeformCapturedAt,
    networkLogAttach: s.networkLogAttach,
    consoleLogAttach: s.consoleLogAttach,
    actionLogAttach: s.actionLogAttach,
    reproPrefillDone: s.reproPrefillDone,
    attachments: s.attachments,
    draft: s.draft,
    issueFields: s.issueFields,
    currentIssueId: s.currentIssueId,
    submitResult: s.submitResult,
  };
}

export function useEditorSessionSync(tabId: number | null): boolean {
  const [hydrated, setHydrated] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const saveFailCount = useRef(0);
  const saveSuspended = useRef(false);

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
          // picking 중 닫힌 세션의 버퍼는 DOM 편집이 이미 원복돼 ghost가 된다 — idle
          // 강등과 함께 폐기(남기면 startPicking의 preserveBuffer로 다음 세션에 합류).
          if (snap.phase === "picking") snap.bufferedElements = [];
          snap.phase = "idle";
        }
        useEditorStore.getState().hydrate(migrateLegacyDraft(snap));
        // 패널이 닫힐 때 port disconnect로 페이지 편집이 전부 원복되므로, styling 복원은
        // DOM 재적용 + picker 재바인딩까지 마쳐야 유령 세션이 안 된다(실패 시 sessionExpired).
        if (snap.phase === "styling" && snap.captureMode === "element") {
          void rebindStylingSession(tabId);
        }
        if (snap.networkLogAttach) {
          getNetworkLog(`pending:${tabId}`).then((log) => {
            if (log) useEditorStore.getState().setNetworkLog(log);
            else useEditorStore.setState({ networkLogAttach: false });
          }).catch(() => {
            useEditorStore.setState({ networkLogAttach: false });
          });
        }
        if (snap.consoleLogAttach) {
          getConsoleLog(`pending:${tabId}`).then((log) => {
            if (log) useEditorStore.getState().setConsoleLog(log);
            else useEditorStore.setState({ consoleLogAttach: false });
          }).catch(() => {
            useEditorStore.setState({ consoleLogAttach: false });
          });
        }
        if (snap.actionLogAttach) {
          getActionLog(`pending:${tabId}`).then((log) => {
            if (log) useEditorStore.getState().setActionLog(log);
            else useEditorStore.setState({ actionLogAttach: false });
          }).catch(() => {
            useEditorStore.setState({ actionLogAttach: false });
          });
        }
        // 영상 blob은 스냅샷 밖(직렬화 불가)이라 IDB에서 복원. drafting은 pending:${tabId}에,
        // confirm 후(previewing/done, 또는 backToDraft로 돌아온 drafting)엔 issueId 키에 있으므로
        // pending → currentIssueId 순으로 조회. 둘 다 없으면 썸네일만 남고 videoBlob은 null.
        if (snap.captureMode === "video" && DRAFT_PHASES.has(snap.phase)) {
          void (async () => {
            let blob = await getVideoBlob(`pending:${tabId}`);
            if (!blob && snap.currentIssueId) blob = await getVideoBlob(snap.currentIssueId);
            if (blob) useEditorStore.setState({ videoBlob: blob });
          })().catch(() => {});
        }
      }
      setHydrated(true);
    });

    const unsubStore = useEditorStore.subscribe((state, prev) => {
      if (state === prev) return;

      if (DRAFT_PHASES.has(prev.phase) && !DRAFT_PHASES.has(state.phase)) {
        const sections = prev.draft?.sections;
        if (sections) {
          const activeRefs = extractInlineRefs(Object.values(sections).join("\n"));
          void pruneOrphanInlineImages(activeRefs);
        } else {
          void pruneOrphanInlineImages([]);
        }
      }

      if (state.sessionExpired) return;
      if (saveSuspended.current) return;
      if (saveTimer.current != null) {
        window.clearTimeout(saveTimer.current);
      }
      saveTimer.current = window.setTimeout(() => {
        if (useEditorStore.getState().sessionExpired) return;
        if (saveSuspended.current) return;
        const snap = snapshotFromState();
        void chrome.storage.session
          .set({ [key]: snap })
          .then(() => { saveFailCount.current = 0; })
          .catch(() => {
            // bufferedElements는 배열 안 base64라 얕은 스프레드로는 안 비워짐 → 명시 변환.
            const lite = {
              ...snap,
              beforeImage: null,
              afterImage: null,
              bufferedElements: snap.bufferedElements.map((e) => ({
                ...e,
                beforeImage: null,
                afterImage: null,
              })),
              screenshotRaw: null,
              screenshotAnnotated: null,
              videoThumbnail: null,
            };
            void chrome.storage.session.set({ [key]: lite })
              .then(() => { saveFailCount.current = 0; })
              .catch(() => {
                saveFailCount.current++;
                if (saveFailCount.current >= 3) {
                  saveSuspended.current = true;
                  onSessionSaveExhausted.fire();
                }
              });
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
        // 콘텐츠 picker 정리: area-select(screenshot+capturing)만 cancelAreaSelect,
        // 그 외 element-select picker(element 스타일 / 요소 캡처 picking)는 clear.
        if (captureMode === "screenshot" && phase === "capturing") {
          void chrome.tabs.sendMessage(tabId, { type: "picker.cancelAreaSelect" }).catch(() => {});
        } else if (needsExpiry || needsReset) {
          void clearPicker(tabId).catch(() => {});
        }
      }
    };
    chrome.storage.onChanged.addListener(onChanged);

    const onTabUpdated = (
      updatedTabId: number,
      info: chrome.tabs.TabChangeInfo,
    ) => {
      if (updatedTabId !== tabId) return;

      if (!info.url) return;
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
        // area-select(screenshot+capturing)만 cancelAreaSelect, element-select picker는 clear.
        if (captureMode === "screenshot" && phase === "capturing") {
          void chrome.tabs
            .sendMessage(tabId, { type: "picker.cancelAreaSelect" })
            .catch(() => {});
        } else {
          void clearPicker(tabId).catch(() => {});
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

    // debounce 대기 중이던 편집을 즉시 저장 — 마지막 편집 후 300ms 안에 패널이 닫히면 유실되던 꼬리 보강.
    const flushPendingSave = () => {
      if (saveTimer.current == null) return;
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      if (useEditorStore.getState().sessionExpired) return;
      if (saveSuspended.current) return;
      void chrome.storage.session.set({ [key]: snapshotFromState() }).catch(() => {});
    };
    window.addEventListener("pagehide", flushPendingSave);

    return () => {
      cancelled = true;
      unsubStore();
      chrome.storage.onChanged.removeListener(onChanged);
      chrome.tabs.onUpdated.removeListener(onTabUpdated);
      window.removeEventListener("pagehide", flushPendingSave);
      flushPendingSave();
    };
  }, [tabId]);

  return hydrated;
}
