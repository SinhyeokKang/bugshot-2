import { create } from "zustand";
import type { Token } from "@/types/picker";
import type { NetworkLog } from "@/types/network";
import type { ConsoleLog } from "@/types/console";
import type { ActionLog } from "@/types/action";
import type { PlatformId } from "@/types/platform";
import type { EnvironmentRow } from "@/types/environment";
import type { UserAttachmentMeta } from "@/types/attachment";
import { onBlobSaveFailed } from "@/types/messages";
import { useIssuesStore } from "@/store/issues-store";
import { useSettingsStore } from "@/store/settings-store";
import { saveVideoBlob, saveImageBlob, saveNetworkLog, deleteNetworkLog, saveConsoleLog, deleteConsoleLog, saveActionLog, deleteActionLog, dataUrlToBlob, saveAttachmentBlob, deleteAttachmentBlob, deleteAttachmentBlobs, rekeyAttachmentBlobs } from "@/store/blob-db";
import { takeWithinLimits, type TakeWithinLimitsResult } from "@/sidepanel/lib/attachmentLimits";
import { clearNetworkRecorder, clearConsoleRecorder, clearActionRecorder } from "@/sidepanel/recorder-control";

export type CaptureMode = "element" | "screenshot" | "video" | "freeform";
export type RecordingSource = "tab" | "screen";

export interface SubmitResult {
  key: string;
  url: string;
  platform: PlatformId;
  logsDropped?: boolean;
}

export type EditorPhase =
  | "idle"
  | "picking"
  | "styling"
  | "capturing"
  | "recording"
  | "drafting"
  | "previewing"
  | "done";

export interface EditorTarget {
  tabId: number;
  url: string;
  title: string;
  frameUrl?: string;
}

export interface EditorSelection {
  selector: string;
  tagName: string;
  classList: string[];
  computedStyles: Record<string, string>;
  specifiedStyles: Record<string, string>;
  propSources: Record<string, string>;
  hasParent: boolean;
  hasChild: boolean;
  text: string | null;
  viewport: { width: number; height: number };
  capturedAt: number;
}

export interface EditorStyleEdits {
  classList: string[];
  inlineStyle: Record<string, string>;
  text: string;
}

// 한 element의 스타일 변경 컨텍스트 한 묶음(복수 element 버퍼 항목). 본문 직렬화는
// selectionSnapshot + styleEdits로 buildStyleDiff를 다시 만들고, before/after는 플랫폼 업로드용.
export interface BufferedElement {
  selector: string;
  tagName: string;
  selectionSnapshot: {
    classList: string[];
    specifiedStyles: Record<string, string>;
    computedStyles: Record<string, string>;
    // 구버전 영속 스냅샷·IssueRecord 복원 경로엔 없다 — 승격 시 ?? {}로 폴백.
    propSources?: Record<string, string>;
    text: string | null;
    viewport: { width: number; height: number };
    capturedAt: number;
  };
  styleEdits: EditorStyleEdits;
  beforeImage: string | null;
  afterImage: string | null;
}

// 요소 캡처(screenshot 세부 모드)의 경량 selector 보관 — EditorSelection(스타일 메타)은 재사용 안 함.
export interface ShotSelector {
  selector: string;
  tagName: string;
}

export interface EditorDraft {
  title: string;
  sections: Record<string, string>;
  environment?: EnvironmentRow[];
}

export interface EditorIssueFields {
  issueTypeId?: string;
  assigneeId?: string;
  assigneeName?: string;
  priorityId?: string;
  priorityName?: string;
  parentKey?: string;
  parentLabel?: string;
  relatesKey?: string;
  relatesLabel?: string;
  cc?: { accountId: string; displayName: string }[];
}

interface EditorState {
  captureMode: CaptureMode;
  recordingSource: RecordingSource;
  phase: EditorPhase;
  targetPlatform: PlatformId;
  target: EditorTarget | null;
  selection: EditorSelection | null;
  shotSelector: ShotSelector | null;
  styleEdits: EditorStyleEdits;
  tokens: Token[];
  beforeImage: string | null;
  afterImage: string | null;
  bufferedElements: BufferedElement[];
  draft: EditorDraft | null;
  issueFields: EditorIssueFields;
  currentIssueId: string | null;
  screenshotRaw: string | null;
  screenshotAnnotated: string | null;
  screenshotViewport: { width: number; height: number } | null;
  screenshotCapturedAt: number | null;
  videoBlob: Blob | null;
  videoThumbnail: string | null;
  videoViewport: { width: number; height: number } | null;
  videoCapturedAt: number | null;
  videoStartedAt: number | null;
  videoEndedAt: number | null;
  videoTrimmed: boolean; // trim 적용(실제 재인코딩) 여부 — 제출 분석 플래그.
  freeformViewport: { width: number; height: number } | null;
  freeformCapturedAt: number | null;
  networkLog: NetworkLog | null;
  networkLogAttach: boolean;
  consoleLog: ConsoleLog | null;
  consoleLogAttach: boolean;
  actionLog: ActionLog | null;
  actionLogAttach: boolean;
  attachments: UserAttachmentMeta[];
  aiStylingLoading: boolean;
  aiDraftLoading: boolean;
  submitResult: SubmitResult | null;
  inlineCaptureTarget: string | null;
  sessionExpired: boolean;

  startInlineCapture: (sectionId: string) => void;
  cancelInlineCapture: () => void;
  appendInlineImage: (sectionId: string, refId: string) => void;
  setAiStylingLoading: (loading: boolean) => void;
  setAiDraftLoading: (loading: boolean) => void;
  startPicking: (target: EditorTarget, mode?: CaptureMode) => void;
  startCapturing: (target: EditorTarget) => void;
  startElementShot: (target: EditorTarget) => void;
  onElementShot: (
    shot: ShotSelector,
    image: string,
    viewport: { width: number; height: number },
  ) => void;
  startRecording: (target: EditorTarget, source: RecordingSource) => void;
  startFreeform: (target: EditorTarget) => void;
  onRecordingComplete: (blob: Blob, thumbnail: string, viewport: { width: number; height: number }, startedAt: number, endedAt: number) => void;
  replaceVideo: (blob: Blob, thumbnail: string, startedAt: number, endedAt: number) => void;
  cancelRecording: () => void;
  onAreaCaptured: (dataUrl: string, viewport: { width: number; height: number }) => void;
  onAnnotated: (dataUrl: string) => void;
  cancelPicking: () => void;
  onElementSelected: (selection: EditorSelection) => void;
  updateSelectionStyles: (patch: {
    selector: string;
    specifiedStyles: Record<string, string>;
    propSources: Record<string, string>;
    computedStyles: Record<string, string>;
  }) => void;
  setStyleEdits: (patch: Partial<EditorStyleEdits>) => void;
  setTokens: (tokens: Token[]) => void;
  setBeforeImage: (img: string | null) => void;
  setAfterImage: (img: string | null) => void;
  bufferCurrentElement: (afterImage: string | null) => void;
  patchBufferedElement: (
    selector: string,
    patch: Partial<Pick<BufferedElement, "styleEdits" | "afterImage">>,
  ) => void;
  removeBufferedElement: (selector: string) => void;
  confirmStyles: () => void;
  resetAllStyleEdits: () => void;
  backToStyling: () => void;
  setDraft: (draft: EditorDraft) => void;
  // 초안 저장 후 previewing으로 전환. 초안이 실제로 저장됐으면 true, draft/selection
  // 미설정으로 미저장 전환이면 false (호출부 성공 토스트 게이트).
  confirmDraft: () => boolean;
  backToDraft: () => void;
  setIssueFields: (patch: Partial<EditorIssueFields>) => void;
  setNetworkLog: (log: NetworkLog) => void;
  setNetworkLogAttach: (on: boolean) => void;
  setConsoleLog: (log: ConsoleLog) => void;
  setConsoleLogAttach: (on: boolean) => void;
  setActionLog: (log: ActionLog) => void;
  setActionLogAttach: (on: boolean) => void;
  clearNetworkLog: (tabId: number | null) => void;
  clearConsoleLog: (tabId: number | null) => void;
  clearActionLog: (tabId: number | null) => void;
  addAttachments: (files: File[]) => Promise<TakeWithinLimitsResult>;
  removeAttachment: (id: string) => void;
  setTargetPlatform: (platform: PlatformId) => void;
  onSubmitted: (result: SubmitResult) => void;
  reset: () => void;
  hydrate: (snapshot: EditorSnapshot) => void;
}

export type EditorSnapshot = Pick<
  EditorState,
  | "captureMode"
  | "phase"
  | "targetPlatform"
  | "target"
  | "selection"
  | "shotSelector"
  | "styleEdits"
  | "tokens"
  | "beforeImage"
  | "afterImage"
  | "bufferedElements"
  | "screenshotRaw"
  | "screenshotAnnotated"
  | "screenshotViewport"
  | "screenshotCapturedAt"
  | "videoThumbnail"
  | "videoViewport"
  | "videoCapturedAt"
  | "videoStartedAt"
  | "videoEndedAt"
  | "videoTrimmed"
  | "freeformViewport"
  | "freeformCapturedAt"
  | "networkLogAttach"
  | "consoleLogAttach"
  | "actionLogAttach"
  | "attachments"
  | "draft"
  | "issueFields"
  | "currentIssueId"
  | "submitResult"
>;

const initial = {
  captureMode: "element" as CaptureMode,
  recordingSource: "tab" as RecordingSource,
  phase: "idle" as EditorPhase,
  targetPlatform: "jira" as PlatformId,
  target: null,
  selection: null,
  shotSelector: null as ShotSelector | null,
  styleEdits: {
    classList: [] as string[],
    inlineStyle: {} as Record<string, string>,
    text: "",
  },
  tokens: [] as Token[],
  beforeImage: null,
  afterImage: null,
  bufferedElements: [] as BufferedElement[],
  screenshotRaw: null as string | null,
  screenshotAnnotated: null as string | null,
  screenshotViewport: null as { width: number; height: number } | null,
  screenshotCapturedAt: null as number | null,
  videoBlob: null as Blob | null,
  videoThumbnail: null as string | null,
  videoViewport: null as { width: number; height: number } | null,
  videoCapturedAt: null as number | null,
  videoStartedAt: null as number | null,
  videoEndedAt: null as number | null,
  videoTrimmed: false,
  freeformViewport: null as { width: number; height: number } | null,
  freeformCapturedAt: null as number | null,
  networkLog: null as NetworkLog | null,
  networkLogAttach: false,
  consoleLog: null as ConsoleLog | null,
  consoleLogAttach: false,
  actionLog: null as ActionLog | null,
  actionLogAttach: false,
  attachments: [] as UserAttachmentMeta[],
  draft: null,
  inlineCaptureTarget: null as string | null,
  issueFields: {} as EditorIssueFields,
  currentIssueId: null as string | null,
  aiStylingLoading: false,
  aiDraftLoading: false,
  submitResult: null as SubmitResult | null,
  sessionExpired: false,
};

// cross-page 누적 로그·첨부 토글 4필드를 모드 진입 시 보존. element/screenshot/freeform이 공유.
function preserveLogs(state: EditorState): Pick<
  EditorState,
  "networkLog" | "consoleLog" | "actionLog" | "networkLogAttach" | "consoleLogAttach" | "actionLogAttach"
> {
  return {
    networkLog: state.networkLog,
    consoleLog: state.consoleLog,
    actionLog: state.actionLog,
    networkLogAttach: state.networkLogAttach,
    consoleLogAttach: state.consoleLogAttach,
    actionLogAttach: state.actionLogAttach,
  };
}

// 복수 element 버퍼를 모드(picking) 재진입 시 보존. preserveLogs와 동형.
function preserveBuffer(state: EditorState): Pick<EditorState, "bufferedElements"> {
  return { bufferedElements: state.bufferedElements };
}

// class 변경 후 picker.selectionUpdated의 specified/computed에는 인라인 편집값이 새어든다
// (css-resolve가 el.style을 [inline] source로 접음). 편집 중(styleEdits.inlineStyle) prop의 diff
// baseline은 편집 전 원본이어야 하므로, 재수집 패치에서 그 prop만 기존 selection 값으로 되돌린다.
// 원본에 없던 prop은 제거해 buildStyleDiff의 computed 폴백도 원본을 가리키게 한다.
export function mergeSelectionStyles(
  prev: Pick<
    EditorSelection,
    "specifiedStyles" | "computedStyles" | "propSources"
  >,
  patch: {
    specifiedStyles: Record<string, string>;
    computedStyles: Record<string, string>;
    propSources: Record<string, string>;
  },
  inlineEdits: Record<string, string>,
): {
  specifiedStyles: Record<string, string>;
  computedStyles: Record<string, string>;
  propSources: Record<string, string>;
} {
  const specifiedStyles = { ...patch.specifiedStyles };
  const computedStyles = { ...patch.computedStyles };
  const propSources = { ...patch.propSources };
  const restore = (
    next: Record<string, string>,
    base: Record<string, string>,
    prop: string,
  ) => {
    if (prop in base) next[prop] = base[prop];
    else delete next[prop];
  };
  for (const prop of Object.keys(inlineEdits)) {
    restore(specifiedStyles, prev.specifiedStyles, prop);
    restore(computedStyles, prev.computedStyles, prop);
    restore(propSources, prev.propSources, prop);
  }
  return { specifiedStyles, computedStyles, propSources };
}

function newIssueId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `issue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function newAttachmentId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// confirmDraft가 pending→issueId로 옮기는 첨부 rekey는 비동기다. 제출 전 이 promise를
// await해 rekey 완료를 보장(빠른 제출 시 issueId 키에 blob 미존재 레이스 방지).
let attachmentRekeyInFlight: Promise<void> = Promise.resolve();
export function whenAttachmentBlobsReady(): Promise<void> {
  return attachmentRekeyInFlight;
}

function selectAttachedLogs(state: EditorState): {
  networkLog: NetworkLog | null;
  consoleLog: ConsoleLog | null;
  actionLog: ActionLog | null;
} {
  return {
    networkLog:
      state.networkLogAttach && state.networkLog && state.networkLog.captured > 0
        ? state.networkLog
        : null,
    consoleLog:
      state.consoleLogAttach && state.consoleLog && state.consoleLog.captured > 0
        ? state.consoleLog
        : null,
    actionLog:
      state.actionLogAttach && state.actionLog && state.actionLog.captured > 0
        ? state.actionLog
        : null,
  };
}

async function persistAttachedLogs(
  issueId: string,
  targetTabId: number,
  logs: { networkLog: NetworkLog | null; consoleLog: ConsoleLog | null; actionLog: ActionLog | null },
): Promise<boolean> {
  let failed = false;
  if (logs.networkLog) {
    if (!await saveNetworkLog(issueId, logs.networkLog)) {
      useIssuesStore.getState().patchIssue(issueId, { networkLogBlobKey: undefined });
      failed = true;
    }
    deleteNetworkLog(`pending:${targetTabId}`).catch(() => {});
  }
  if (logs.consoleLog) {
    if (!await saveConsoleLog(issueId, logs.consoleLog)) {
      useIssuesStore.getState().patchIssue(issueId, { consoleLogBlobKey: undefined });
      failed = true;
    }
    deleteConsoleLog(`pending:${targetTabId}`).catch(() => {});
  }
  if (logs.actionLog) {
    if (!await saveActionLog(issueId, logs.actionLog)) {
      useIssuesStore.getState().patchIssue(issueId, { actionLogBlobKey: undefined });
      failed = true;
    }
    deleteActionLog(`pending:${targetTabId}`).catch(() => {});
  }
  return failed;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  ...initial,

  startInlineCapture: (sectionId) => set({ inlineCaptureTarget: sectionId }),
  cancelInlineCapture: () => set({ inlineCaptureTarget: null }),
  appendInlineImage: (sectionId, refId) =>
    set((s) => {
      if (!s.draft) return {};
      const prev = s.draft.sections[sectionId] ?? "";
      const separator = prev === "" ? "" : "\n\n";
      return {
        draft: {
          ...s.draft,
          sections: {
            ...s.draft.sections,
            [sectionId]: `${prev}${separator}![](inline:${refId})`,
          },
        },
      };
    }),

  setAiStylingLoading: (loading) => set({ aiStylingLoading: loading }),
  setAiDraftLoading: (loading) => set({ aiDraftLoading: loading }),

  // cross-page 누적 로그와 첨부 토글을 모드 진입 시 보존. 다른 자산 필드는 리셋.
  startPicking: (target, mode) =>
    set((state) => ({
      ...initial,
      captureMode: mode ?? "element",
      phase: "picking",
      target,
      ...preserveLogs(state),
      ...preserveBuffer(state),
    })),
  cancelPicking: () => set((state) => ({ ...initial, ...preserveLogs(state) })),

  startCapturing: (target) =>
    set((prev) => ({
      ...initial,
      captureMode: "screenshot",
      phase: "capturing",
      target,
      ...preserveLogs(prev),
      networkLogAttach: true,
      consoleLogAttach: true,
      actionLogAttach: true,
    })),
  startFreeform: (target) =>
    set((state) => ({
      ...initial,
      captureMode: "freeform",
      phase: "drafting",
      target,
      ...preserveLogs(state),
      networkLogAttach: true,
      consoleLogAttach: true,
      actionLogAttach: true,
    })),
  startElementShot: (target) =>
    set((prev) => ({
      ...initial,
      captureMode: "screenshot",
      phase: "picking",
      target,
      ...preserveLogs(prev),
      networkLogAttach: true,
      consoleLogAttach: true,
      actionLogAttach: true,
    })),
  onElementShot: (shot, image, viewport) =>
    set({
      phase: "drafting",
      screenshotRaw: image,
      screenshotViewport: viewport,
      screenshotCapturedAt: Date.now(),
      shotSelector: shot,
    }),
  startRecording: (target, source) => set({ ...initial, captureMode: "video", recordingSource: source, phase: "recording", target }),
  onRecordingComplete: (blob, thumbnail, viewport, startedAt, endedAt) => set({ captureMode: "video", phase: "drafting", videoBlob: blob, videoThumbnail: thumbnail, videoViewport: viewport, videoCapturedAt: Date.now(), videoStartedAt: startedAt, videoEndedAt: endedAt, videoTrimmed: false, networkLogAttach: true, consoleLogAttach: true, actionLogAttach: true }),
  // trim 확정 시 영상 메타만 교체 — phase·attach·target·videoCapturedAt(원본 캡처 시각)은 불변.
  replaceVideo: (blob, thumbnail, startedAt, endedAt) => set({ videoBlob: blob, videoThumbnail: thumbnail, videoStartedAt: startedAt, videoEndedAt: endedAt, videoTrimmed: true }),
  cancelRecording: () => set((state) => ({ ...initial, ...preserveLogs(state) })),
  // screenshot도 freeform/video와 동일하게 진입 시 첨부 토글 자동 on (startCapturing·startElementShot). preserveLogs는 로그 데이터 보존용이고 attach는 덮어쓴다.
  onAreaCaptured: (dataUrl, viewport) => set({ phase: "drafting", screenshotRaw: dataUrl, screenshotViewport: viewport, screenshotCapturedAt: Date.now() }),
  onAnnotated: (dataUrl) => set({ screenshotAnnotated: dataUrl }),

  onElementSelected: (selection) =>
    set((s) => {
      // 이미 버퍼에 담긴 요소를 재선택하면 그 편집을 작업 set으로 복원한다. 안 그러면
      // 재선택 시 inlineStyle이 {}로 비워져, 추가 편집 후 재버퍼 시 이전 편집이 소실된다.
      const buffered = s.bufferedElements.find((b) => b.selector === selection.selector);
      if (buffered) {
        return {
          phase: "styling",
          // diff baseline(전값)은 인라인이 새어든 재캡처 specified가 아니라 버퍼 원본 snapshot을 쓴다.
          selection: {
            ...selection,
            classList: [...buffered.selectionSnapshot.classList],
            specifiedStyles: { ...buffered.selectionSnapshot.specifiedStyles },
            computedStyles: { ...buffered.selectionSnapshot.computedStyles },
            propSources: { ...(buffered.selectionSnapshot.propSources ?? {}) },
            text: buffered.selectionSnapshot.text,
          },
          styleEdits: {
            classList: [...buffered.styleEdits.classList],
            inlineStyle: { ...buffered.styleEdits.inlineStyle },
            text: buffered.styleEdits.text,
          },
          beforeImage: buffered.beforeImage,
          afterImage: buffered.afterImage,
          // 현재 요소로 승격 — 중복 카드 방지.
          bufferedElements: s.bufferedElements.filter((b) => b.selector !== selection.selector),
          aiStylingLoading: false,
        };
      }
      return {
        phase: "styling",
        selection,
        styleEdits: {
          classList: [...selection.classList],
          inlineStyle: {},
          text: selection.text ?? "",
        },
        beforeImage: null,
        afterImage: null,
        aiStylingLoading: false,
      };
    }),

  updateSelectionStyles: (patch) =>
    set((s) => {
      // 늦게 도착한 stale 보강(다른 요소 선택 후)이 현재 선택 맵을 오염시키지 않게 가드.
      if (!s.selection || s.selection.selector !== patch.selector) return {};
      return {
        selection: {
          ...s.selection,
          ...mergeSelectionStyles(s.selection, patch, s.styleEdits.inlineStyle),
        },
      };
    }),

  setStyleEdits: (patch) =>
    set((s) => ({ styleEdits: { ...s.styleEdits, ...patch } })),

  setTokens: (tokens) => set({ tokens }),

  setBeforeImage: (beforeImage) => set({ beforeImage }),

  setAfterImage: (afterImage) => set({ afterImage }),

  bufferCurrentElement: (afterImage) =>
    set((s) => {
      const sel = s.selection;
      if (!sel) return {};
      const entry: BufferedElement = {
        selector: sel.selector,
        tagName: sel.tagName,
        selectionSnapshot: {
          classList: [...sel.classList],
          specifiedStyles: { ...sel.specifiedStyles },
          computedStyles: { ...sel.computedStyles },
          propSources: { ...sel.propSources },
          text: sel.text,
          viewport: { ...sel.viewport },
          capturedAt: sel.capturedAt,
        },
        styleEdits: {
          classList: [...s.styleEdits.classList],
          inlineStyle: { ...s.styleEdits.inlineStyle },
          text: s.styleEdits.text,
        },
        beforeImage: s.beforeImage,
        afterImage,
      };
      const idx = s.bufferedElements.findIndex((b) => b.selector === sel.selector);
      if (idx >= 0) {
        // 같은 selector 재편집: 최초 before 유지, 나머지는 최신으로 갱신.
        const updated = [...s.bufferedElements];
        updated[idx] = { ...entry, beforeImage: s.bufferedElements[idx].beforeImage };
        return { bufferedElements: updated };
      }
      return { bufferedElements: [...s.bufferedElements, entry] };
    }),

  patchBufferedElement: (selector, patch) =>
    set((s) => ({
      bufferedElements: s.bufferedElements.map((b) =>
        b.selector === selector ? { ...b, ...patch } : b,
      ),
    })),

  removeBufferedElement: (selector) =>
    set((s) => ({
      bufferedElements: s.bufferedElements.filter(
        (b) => b.selector !== selector,
      ),
    })),

  confirmStyles: () => set({ phase: "drafting", aiStylingLoading: false }),
  // 현재 element 편집 초기화 + 복수 element 버퍼 비움(페이지 DOM 원복은 picker.resetAllEdits가 담당).
  resetAllStyleEdits: () =>
    set((s) => ({
      styleEdits: s.selection
        ? {
            classList: [...s.selection.classList],
            inlineStyle: {},
            text: s.selection.text ?? "",
          }
        : s.styleEdits,
      bufferedElements: [],
    })),

  backToStyling: () => set({ phase: "styling", afterImage: null, aiStylingLoading: false }),

  setDraft: (draft) => set({ draft }),

  confirmDraft: () => {
    const state = get();
    if (!state.draft || !state.target) {
      set({ phase: "previewing" });
      return false;
    }
    if (state.targetPlatform === "jira") {
      const { lastSubmitFields, accounts } = useSettingsStore.getState();
      const lastJira = lastSubmitFields.jira;
      const jiraAccount = accounts.jira;
      if (
        lastJira?.projectKey &&
        lastJira.projectKey === jiraAccount?.projectKey &&
        !state.issueFields.assigneeId &&
        !state.issueFields.priorityId
      ) {
        const { projectKey: _, ...restored } = lastJira;
        set((s) => ({ issueFields: { ...restored, ...s.issueFields } }));
      }
    }
    const id = state.currentIssueId ?? newIssueId();
    if (state.captureMode === "freeform") {
      const logs = selectAttachedLogs(state);
      useIssuesStore.getState().saveDraft({
        id,
        status: "draft",
        platform: state.targetPlatform,
        title: state.draft.title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pageUrl: state.target.url,
        pageTitle: state.target.title,
        captureMode: "freeform",
        viewport: state.freeformViewport ?? undefined,
        draft: { ...state.draft },
        snapshot: { before: false, after: false },
        networkLogBlobKey: logs.networkLog ? id : undefined,
        consoleLogBlobKey: logs.consoleLog ? id : undefined,
        actionLogBlobKey: logs.actionLog ? id : undefined,
      });
      const targetTabId = state.target.tabId;
      void (async () => {
        const failed = await persistAttachedLogs(id, targetTabId, logs);
        if (failed) onBlobSaveFailed.fire();
      })();
    } else if (state.captureMode === "video") {
      const logs = selectAttachedLogs(state);
      useIssuesStore.getState().saveDraft({
        id,
        status: "draft",
        platform: state.targetPlatform,
        title: state.draft.title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pageUrl: state.target.url,
        pageTitle: state.target.title,
        captureMode: "video",
        viewport: state.videoViewport ?? undefined,
        videoStartedAt: state.videoStartedAt ?? undefined,
        videoEndedAt: state.videoEndedAt ?? undefined,
        draft: { ...state.draft },
        snapshot: {
          before: !!state.videoThumbnail,
          after: false,
        },
        networkLogBlobKey: logs.networkLog ? id : undefined,
        consoleLogBlobKey: logs.consoleLog ? id : undefined,
        actionLogBlobKey: logs.actionLog ? id : undefined,
      });
      const targetTabId = state.target.tabId;
      void (async () => {
        let failed = false;
        if (state.videoBlob) {
          if (!await saveVideoBlob(id, state.videoBlob)) {
            useIssuesStore.getState().patchIssue(id, { captureMode: undefined });
            failed = true;
          }
        }
        if (state.videoThumbnail) {
          if (!await saveImageBlob(id, "before", dataUrlToBlob(state.videoThumbnail))) {
            useIssuesStore.getState().patchDraftSnapshot(id, { before: false });
            failed = true;
          }
        }
        if (await persistAttachedLogs(id, targetTabId, logs)) failed = true;
        if (failed) onBlobSaveFailed.fire();
      })();
    } else if (state.captureMode === "screenshot") {
      const screenshotImage = state.screenshotAnnotated ?? state.screenshotRaw;
      const logs = selectAttachedLogs(state);
      useIssuesStore.getState().saveDraft({
        id,
        status: "draft",
        platform: state.targetPlatform,
        title: state.draft.title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pageUrl: state.target.url,
        pageTitle: state.target.title,
        captureMode: "screenshot",
        ...(state.shotSelector
          ? { selector: state.shotSelector.selector, tagName: state.shotSelector.tagName }
          : {}),
        viewport: state.screenshotViewport ?? undefined,
        draft: { ...state.draft },
        snapshot: {
          before: !!screenshotImage,
          after: false,
        },
        networkLogBlobKey: logs.networkLog ? id : undefined,
        consoleLogBlobKey: logs.consoleLog ? id : undefined,
        actionLogBlobKey: logs.actionLog ? id : undefined,
      });
      const targetTabId = state.target.tabId;
      void (async () => {
        let failed = false;
        if (screenshotImage) {
          if (!await saveImageBlob(id, "before", dataUrlToBlob(screenshotImage))) {
            useIssuesStore.getState().patchDraftSnapshot(id, { before: false });
            failed = true;
          }
        }
        if (await persistAttachedLogs(id, targetTabId, logs)) failed = true;
        if (failed) onBlobSaveFailed.fire();
      })();
    } else {
      if (!state.selection) {
        // selection 없으면 draft 미저장 → 첨부도 issueId로 못 옮기므로 pending 정리(고아 방지).
        if (state.attachments.length) {
          deleteAttachmentBlobs(`pending:${state.target.tabId}`).catch(() => {});
        }
        set({ phase: "previewing" });
        return false;
      }
      useIssuesStore.getState().saveDraft({
        id,
        status: "draft",
        platform: state.targetPlatform,
        title: state.draft.title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pageUrl: state.target.url,
        pageTitle: state.target.title,
        selector: state.selection.selector,
        tagName: state.selection.tagName,
        viewport: { ...state.selection.viewport },
        draft: { ...state.draft },
        styleEdits: {
          classList: [...state.styleEdits.classList],
          inlineStyle: { ...state.styleEdits.inlineStyle },
          text: state.styleEdits.text,
        },
        snapshot: {
          before: !!state.beforeImage,
          after: !!state.afterImage,
        },
        selectionSnapshot: {
          classList: [...state.selection.classList],
          specifiedStyles: { ...state.selection.specifiedStyles },
          computedStyles: { ...state.selection.computedStyles },
          text: state.selection.text,
          viewport: { ...state.selection.viewport },
          capturedAt: state.selection.capturedAt,
        },
        tokensSnapshot: state.tokens.map((t) => ({
          name: t.name,
          value: t.value,
        })),
        ...(state.bufferedElements.length > 0
          ? {
              bufferedElements: state.bufferedElements.map((b) => ({
                selector: b.selector,
                tagName: b.tagName,
                styleEdits: {
                  classList: [...b.styleEdits.classList],
                  inlineStyle: { ...b.styleEdits.inlineStyle },
                  text: b.styleEdits.text,
                },
                selectionSnapshot: {
                  classList: [...b.selectionSnapshot.classList],
                  specifiedStyles: { ...b.selectionSnapshot.specifiedStyles },
                  computedStyles: { ...b.selectionSnapshot.computedStyles },
                  text: b.selectionSnapshot.text,
                  viewport: { ...b.selectionSnapshot.viewport },
                  capturedAt: b.selectionSnapshot.capturedAt,
                },
                hasBefore: !!b.beforeImage,
                hasAfter: !!b.afterImage,
              })),
            }
          : {}),
      });
      const bufferedSnapshot = state.bufferedElements;
      void (async () => {
        let failed = false;
        if (state.beforeImage) {
          if (!await saveImageBlob(id, "before", dataUrlToBlob(state.beforeImage))) {
            useIssuesStore.getState().patchDraftSnapshot(id, { before: false });
            failed = true;
          }
        }
        if (state.afterImage) {
          if (!await saveImageBlob(id, "after", dataUrlToBlob(state.afterImage))) {
            useIssuesStore.getState().patchDraftSnapshot(id, { after: false });
            failed = true;
          }
        }
        for (let i = 0; i < bufferedSnapshot.length; i++) {
          const b = bufferedSnapshot[i];
          if (b.beforeImage && !await saveImageBlob(id, `b${i}-before`, dataUrlToBlob(b.beforeImage))) {
            useIssuesStore.getState().patchDraftBufferedImageFlags(id, i, { hasBefore: false });
            failed = true;
          }
          if (b.afterImage && !await saveImageBlob(id, `b${i}-after`, dataUrlToBlob(b.afterImage))) {
            useIssuesStore.getState().patchDraftBufferedImageFlags(id, i, { hasAfter: false });
            failed = true;
          }
        }
        if (failed) onBlobSaveFailed.fire();
      })();
    }
    // 사용자 첨부: 토글과 무관하게 pending→issueId rekey + 메타 저장(정리는 issueId 키 기준).
    // 4개 captureMode 정상 경로 공통 — early-return(draft/selection 없음)은 첨부 무의미라 미도달.
    if (state.attachments.length && state.target) {
      const tabId = state.target.tabId;
      const metas = state.attachments;
      useIssuesStore.getState().patchIssue(id, { attachments: metas });
      // confirmDraft 동시 호출 시 이전 rekey가 끝난 뒤 실행되도록 체이닝(이전 promise 손실 방지).
      const prev = attachmentRekeyInFlight;
      attachmentRekeyInFlight = prev
        .catch(() => {})
        .then(() => rekeyAttachmentBlobs(`pending:${tabId}`, id, metas.map((a) => a.id)))
        .then((ok) => {
          if (!ok) onBlobSaveFailed.fire();
        });
    }
    set({ phase: "previewing", currentIssueId: id });
    return true;
  },

  backToDraft: () => set({ phase: "drafting" }),

  setIssueFields: (patch) =>
    set((s) => ({ issueFields: { ...s.issueFields, ...patch } })),

  setNetworkLog: (log) => set({ networkLog: log }),
  setNetworkLogAttach: (on) => set({ networkLogAttach: on }),
  setConsoleLog: (log) => set({ consoleLog: log }),
  setConsoleLogAttach: (on) => set({ consoleLogAttach: on }),
  setActionLog: (log) => set({ actionLog: log }),
  setActionLogAttach: (on) => set({ actionLogAttach: on }),
  clearNetworkLog: (tabId) => {
    set({ networkLog: null });
    if (tabId != null) {
      deleteNetworkLog(`pending:${tabId}`).catch(() => {});
      clearNetworkRecorder(tabId).catch(() => {});
    }
  },
  clearConsoleLog: (tabId) => {
    set({ consoleLog: null });
    if (tabId != null) {
      deleteConsoleLog(`pending:${tabId}`).catch(() => {});
      clearConsoleRecorder(tabId).catch(() => {});
    }
  },
  clearActionLog: (tabId) => {
    set({ actionLog: null });
    if (tabId != null) {
      deleteActionLog(`pending:${tabId}`).catch(() => {});
      clearActionRecorder(tabId).catch(() => {});
    }
  },
  // 파일 선택 즉시 Blob을 pending:${tabId}에 저장하고 메타만 state에 둔다(임의 크기라 session 불가).
  addAttachments: async (files) => {
    const tabId = get().target?.tabId;
    if (tabId == null) return { acceptCount: 0, droppedCount: 0 };
    const owner = `pending:${tabId}`;
    // 하드캡 적용은 여기 단일 출처. 드롭 사유는 호출처(UI)가 result로 받아 토스트.
    const result = takeWithinLimits(
      get().attachments,
      files.map((f) => ({ size: f.size })),
    );
    const metas: UserAttachmentMeta[] = [];
    let saveFailed = false;
    for (const file of files.slice(0, result.acceptCount)) {
      const id = newAttachmentId();
      if (await saveAttachmentBlob(owner, id, file)) {
        metas.push({
          id,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        });
      } else {
        saveFailed = true;
      }
    }
    if (metas.length) set((s) => ({ attachments: [...s.attachments, ...metas] }));
    if (saveFailed) onBlobSaveFailed.fire();
    return result;
  },
  removeAttachment: (id) => {
    const tabId = get().target?.tabId;
    const issueId = get().currentIssueId;
    set((s) => ({ attachments: s.attachments.filter((a) => a.id !== id) }));
    // blob은 confirm 전 pending:${tabId}, confirm 후 issueId 키에 있다. 어느 쪽인지
    // 모르므로 양쪽 삭제(없는 키는 no-op) — confirm 후 제거 시 issueId 고아 방지.
    if (tabId != null) deleteAttachmentBlob(`pending:${tabId}`, id).catch(() => {});
    if (issueId) deleteAttachmentBlob(issueId, id).catch(() => {});
  },
  setTargetPlatform: (platform) => set({ targetPlatform: platform }),

  onSubmitted: (result) => set({ phase: "done", submitResult: result, beforeImage: null, afterImage: null, bufferedElements: [], screenshotRaw: null, screenshotAnnotated: null, videoBlob: null, videoThumbnail: null, networkLog: null, consoleLog: null, actionLog: null, attachments: [] }),

  reset: () => set({ ...initial }),

  hydrate: (snapshot) => set(snapshot),
}));

export function useAiLoading(): boolean {
  const draft = useEditorStore((s) => s.aiDraftLoading);
  const styling = useEditorStore((s) => s.aiStylingLoading);
  return draft || styling;
}
