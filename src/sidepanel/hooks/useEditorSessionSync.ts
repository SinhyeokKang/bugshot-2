import { useEffect, useRef, useState } from "react";
import { FROZEN_PHASES, pageKeyOf, sessionKey, pendingKey } from "@/lib/session-keys";
import {
  EDITOR_SNAPSHOT_KEYS,
  type EditorDraft,
  type EditorSnapshot,
  type EditorState,
  useEditorStore,
} from "@/store/editor-store";
import { onSessionSaveExhausted } from "@/lib/app-events";
import { cancelAreaSelect, clearPicker, rebindStylingSession } from "@/sidepanel/picker-control";
import { getNetworkLog, getConsoleLog, getActionLog, getVideoBlob, pruneOrphanInlineImages } from "@/store/blob-db";
import { extractInlineRefs } from "@/sidepanel/lib/resolveInlineImages";
import { deriveLogsAttach } from "@/sidepanel/hooks/deriveLogsAttach";
import { toLiteSnapshot } from "@/sidepanel/lib/liteSnapshot";

export function migrateLegacyDraft(snap: EditorSnapshot): EditorSnapshot {
  let next = {
    ...snap,
    beforeAnnotated: snap.beforeAnnotated ?? null,
    afterAnnotated: snap.afterAnnotated ?? null,
  };
  // 구 3플래그(networkLogAttach/consoleLogAttach/actionLogAttach) 스냅샷 → 단일 logsAttach 파생.
  const legacyAttach = snap as unknown as {
    networkLogAttach?: boolean;
    consoleLogAttach?: boolean;
    actionLogAttach?: boolean;
    logsAttach?: boolean;
  };
  if (legacyAttach.logsAttach === undefined) {
    next = { ...next, logsAttach: deriveLogsAttach(legacyAttach) };
  }
  if (!next.draft) return next;
  const legacy = next.draft as unknown as {
    title?: string;
    body?: string;
    expectedResult?: string;
    sections?: Record<string, string>;
  };
  if (legacy.sections) return next;
  const sections: Record<string, string> = {};
  if (legacy.body) sections.description = legacy.body;
  if (legacy.expectedResult) sections.expectedResult = legacy.expectedResult;
  const migrated: EditorDraft = { title: legacy.title ?? "", sections };
  return { ...next, draft: migrated };
}

const SAVE_DEBOUNCE_MS = 300;
// hydrate는 이 세 phase를 idle로 강등하므로, IDB 왕복 뒤 store가 여기 있다면 그 사이
// 사용자가 **새 캡처를 시작한 것**이다 — 직전 세션의 늦은 복원분으로 덮지 않는다.
const ACTIVE_CAPTURE_PHASES = new Set(["picking", "capturing", "recording"]);

// videoBlob 제외: Blob은 chrome.storage 직렬화 불가 → 로그와 동일하게 IndexedDB(pending:${tabId})에
// 별도 저장하고 hydrate가 복원. onRecordingComplete/replaceVideo 시점에 미러링된다.
// 순수 모듈로 옮기지 않는다 — 손나열 + getState() 직접 호출이라 이동 중 하나가 빠지면 타입·런타임
// 에러 없이 조용히 초기값이 되고 영향 범위가 편집 세션 전체다. export는 키 집합 그물 테스트용.
// 영속 키가 하나도 안 바뀌고 livePageUrl만 달라진 전이인가. 스냅샷 키 전량 대조라
// 새 키가 추가돼도 열거가 안 새고, 값이 같으면 애초에 저장할 게 없다는 뜻이다.
export function isLivePageUrlOnlyChange(
  prev: EditorState,
  next: EditorState,
): boolean {
  if (prev.livePageUrl === next.livePageUrl) return false;
  return EDITOR_SNAPSHOT_KEYS.every((k) => prev[k] === next[k]);
}

export function snapshotFromState(): EditorSnapshot {
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
    beforeAnnotated: s.beforeAnnotated,
    afterAnnotated: s.afterAnnotated,
    captureContext: s.captureContext,
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
    videoTrimSource: s.videoTrimSource,
    freeformViewport: s.freeformViewport,
    freeformCapturedAt: s.freeformCapturedAt,
    logsAttach: s.logsAttach,
    reproPrefillDone: s.reproPrefillDone,
    apiHostsDismissed: s.apiHostsDismissed,
    apiHostsDerived: s.apiHostsDerived,
    attachments: s.attachments,
    draft: s.draft,
    issueFields: s.issueFields,
    currentIssueId: s.currentIssueId,
    submitResult: s.submitResult,
  };
}

export function useEditorSessionSync(tabId: number | null): boolean {
  const [hydratedTabId, setHydratedTabId] = useState<number | null>(null);
  const saveTimer = useRef<number | null>(null);
  const saveFailCount = useRef(0);
  const saveSuspended = useRef(false);

  useEffect(() => {
    if (tabId == null) {
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
        // 로그 데이터는 첨부 상태와 무관하게 항상 로드 — off 상태에서도 카드 건수·다이얼로그가
        // 뜨도록. logsAttach는 스냅샷 hydrate 값 유지(부재 시 카드가 사라지는 구 버그 해소).
        // 바깥 .then의 cancelled 확인만으론 부족하다 — 같은 탭에서 새 캡처가 시작되는 경우는
        // cancelled가 서지 않으므로 도착 시점에 세션 세대를 다시 본다.
        const superseded = (): boolean =>
          cancelled || ACTIVE_CAPTURE_PHASES.has(useEditorStore.getState().phase);
        getNetworkLog(pendingKey(tabId)).then((log) => {
          if (log && !superseded()) useEditorStore.getState().setNetworkLog(log);
        }).catch(() => {});
        getConsoleLog(pendingKey(tabId)).then((log) => {
          if (log && !superseded()) useEditorStore.getState().setConsoleLog(log);
        }).catch(() => {});
        getActionLog(pendingKey(tabId)).then((log) => {
          if (log && !superseded()) useEditorStore.getState().setActionLog(log);
        }).catch(() => {});
        // 영상 blob은 스냅샷 밖(직렬화 불가)이라 IDB에서 복원. drafting은 pending:${tabId}에,
        // confirm 후(previewing/done, 또는 backToDraft로 돌아온 drafting)엔 issueId 키에 있으므로
        // pending → currentIssueId 순으로 조회. 둘 다 없으면 썸네일만 남고 videoBlob은 null.
        if (snap.captureMode === "video" && FROZEN_PHASES.has(snap.phase)) {
          void (async () => {
            let blob = await getVideoBlob(pendingKey(tabId));
            if (!blob && snap.currentIssueId) blob = await getVideoBlob(snap.currentIssueId);
            if (blob && !superseded()) useEditorStore.setState({ videoBlob: blob });
          })().catch(() => {});
        }
      }
      setHydratedTabId(tabId);
    }).catch((e) => {
      // 복원 실패는 저장분 없음으로 강등하고 화면은 띄운다 — 게이트를 닫아두면 App.tsx의
      // `!editorHydrated`가 패널을 영구 빈 화면으로 굳힌다(POSTMORTEM 2026-07-26,
      // chromeLocalStorage.getItem이 같은 이유로 삼킨다).
      // 스코프는 조회만이 아니라 hydrate·마이그레이션까지다 — 어느 쪽이 터져도 빈 화면보다
      // 강등이 낫다. 대신 삼키지 말고 남긴다(같은 선례가 console.error를 함께 든다).
      // 잔여 위험: 조회가 일시 실패했을 뿐 저장분이 실재하면, 이후 편집의 debounce 저장이
      // 그 키를 통째로 덮어쓴다. 세션 유실을 감수하고 패널을 살리는 쪽이 이 트레이드오프다.
      console.error("[session-sync] hydrate failed:", key, e);
      if (cancelled) return;
      setHydratedTabId(tabId);
    });

    const unsubStore = useEditorStore.subscribe((state, prev) => {
      if (state === prev) return;

      if (FROZEN_PHASES.has(prev.phase) && !FROZEN_PHASES.has(state.phase)) {
        const sections = prev.draft?.sections;
        if (sections) {
          const activeRefs = extractInlineRefs(Object.values(sections).join("\n"));
          void pruneOrphanInlineImages(activeRefs);
        } else {
          void pruneOrphanInlineImages([]);
        }
      }

      if (state.sessionExpired) return;
      // livePageUrl은 비영속이라 이 전이는 스냅샷을 못 바꾼다. 그냥 두면 네비게이션마다
      // 저장이 예약돼 screenshot/video drafting에서 수 MB data URL이 매번 재직렬화된다.
      if (isLivePageUrlOnlyChange(prev, state)) return;
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
            void chrome.storage.session.set({ [key]: toLiteSnapshot(snap) })
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
          void cancelAreaSelect(tabId);
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
          void cancelAreaSelect(tabId);
        } else {
          void clearPicker(tabId).catch(() => {});
        }
        return;
      }

      if (captureMode === "element" && FROZEN_PHASES.has(phase)) {
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
      // debounce 경로와 같은 lite 폴백 — 쿼터 초과 시 통째 유실되던 마지막 꼬리를 살린다.
      const snap = snapshotFromState();
      void chrome.storage.session.set({ [key]: snap }).catch(() => {
        void chrome.storage.session.set({ [key]: toLiteSnapshot(snap) }).catch(() => {});
      });
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

  return tabId == null || hydratedTabId === tabId;
}
