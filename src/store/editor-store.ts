import { create } from "zustand";
import type { Token } from "@/types/picker";
import type { NetworkLog } from "@/types/network";
import type { ConsoleLog } from "@/types/console";
import type { ActionLog } from "@/types/action";
import type { PlatformId } from "@/types/platform";
import type { EnvironmentRow } from "@/types/environment";
import { onBlobSaveFailed } from "@/types/messages";
import { useIssuesStore } from "./issues-store";
import { useSettingsStore } from "./settings-store";
import { saveVideoBlob, saveImageBlob, saveNetworkLog, deleteNetworkLog, saveConsoleLog, deleteConsoleLog, saveActionLog, deleteActionLog, dataUrlToBlob } from "./blob-db";
import { clearNetworkRecorder, clearConsoleRecorder, clearActionRecorder } from "@/sidepanel/recorder-control";

export type CaptureMode = "element" | "screenshot" | "video" | "freeform";

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
}

interface EditorState {
  captureMode: CaptureMode;
  phase: EditorPhase;
  targetPlatform: PlatformId;
  target: EditorTarget | null;
  selection: EditorSelection | null;
  styleEdits: EditorStyleEdits;
  tokens: Token[];
  beforeImage: string | null;
  afterImage: string | null;
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
  freeformViewport: { width: number; height: number } | null;
  freeformCapturedAt: number | null;
  networkLog: NetworkLog | null;
  networkLogAttach: boolean;
  consoleLog: ConsoleLog | null;
  consoleLogAttach: boolean;
  actionLog: ActionLog | null;
  actionLogAttach: boolean;
  aiStylingLoading: boolean;
  aiDraftLoading: boolean;
  submitResult: { key: string; url: string } | null;
  inlineCaptureTarget: string | null;
  sessionExpired: boolean;

  startInlineCapture: (sectionId: string) => void;
  cancelInlineCapture: () => void;
  appendInlineImage: (sectionId: string, refId: string) => void;
  setAiStylingLoading: (loading: boolean) => void;
  setAiDraftLoading: (loading: boolean) => void;
  startPicking: (target: EditorTarget, mode?: CaptureMode) => void;
  startCapturing: (target: EditorTarget) => void;
  startRecording: (target: EditorTarget) => void;
  startFreeform: (target: EditorTarget) => void;
  onRecordingComplete: (blob: Blob, thumbnail: string, viewport: { width: number; height: number }, startedAt: number, endedAt: number) => void;
  cancelRecording: () => void;
  onAreaCaptured: (dataUrl: string, viewport: { width: number; height: number }) => void;
  onAnnotated: (dataUrl: string) => void;
  cancelPicking: () => void;
  onElementSelected: (selection: EditorSelection) => void;
  updateSelectionStyles: (patch: {
    specifiedStyles: Record<string, string>;
    propSources: Record<string, string>;
    computedStyles: Record<string, string>;
  }) => void;
  setStyleEdits: (patch: Partial<EditorStyleEdits>) => void;
  setTokens: (tokens: Token[]) => void;
  setBeforeImage: (img: string | null) => void;
  setAfterImage: (img: string | null) => void;
  confirmStyles: () => void;
  backToStyling: () => void;
  setDraft: (draft: EditorDraft) => void;
  confirmDraft: () => void;
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
  setTargetPlatform: (platform: PlatformId) => void;
  onSubmitted: (result: { key: string; url: string }) => void;
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
  | "styleEdits"
  | "tokens"
  | "beforeImage"
  | "afterImage"
  | "screenshotRaw"
  | "screenshotAnnotated"
  | "screenshotViewport"
  | "screenshotCapturedAt"
  | "videoThumbnail"
  | "videoViewport"
  | "videoCapturedAt"
  | "videoStartedAt"
  | "videoEndedAt"
  | "freeformViewport"
  | "freeformCapturedAt"
  | "networkLogAttach"
  | "consoleLogAttach"
  | "actionLogAttach"
  | "draft"
  | "issueFields"
  | "currentIssueId"
  | "submitResult"
>;

const initial = {
  captureMode: "element" as CaptureMode,
  phase: "idle" as EditorPhase,
  targetPlatform: "jira" as PlatformId,
  target: null,
  selection: null,
  styleEdits: {
    classList: [] as string[],
    inlineStyle: {} as Record<string, string>,
    text: "",
  },
  tokens: [] as Token[],
  beforeImage: null,
  afterImage: null,
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
  freeformViewport: null as { width: number; height: number } | null,
  freeformCapturedAt: null as number | null,
  networkLog: null as NetworkLog | null,
  networkLogAttach: false,
  consoleLog: null as ConsoleLog | null,
  consoleLogAttach: false,
  actionLog: null as ActionLog | null,
  actionLogAttach: false,
  draft: null,
  inlineCaptureTarget: null as string | null,
  issueFields: {} as EditorIssueFields,
  currentIssueId: null as string | null,
  aiStylingLoading: false,
  aiDraftLoading: false,
  submitResult: null as { key: string; url: string } | null,
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

function newIssueId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `issue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    })),
  cancelPicking: () => set((state) => ({ ...initial, ...preserveLogs(state) })),

  startCapturing: (target) =>
    set((prev) => ({
      ...initial,
      captureMode: "screenshot",
      phase: "capturing",
      target,
      ...preserveLogs(prev),
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
  startRecording: (target) => set({ ...initial, captureMode: "video", phase: "recording", target }),
  onRecordingComplete: (blob, thumbnail, viewport, startedAt, endedAt) => set({ captureMode: "video", phase: "drafting", videoBlob: blob, videoThumbnail: thumbnail, videoViewport: viewport, videoCapturedAt: Date.now(), videoStartedAt: startedAt, videoEndedAt: endedAt, networkLogAttach: true, consoleLogAttach: true, actionLogAttach: true }),
  cancelRecording: () => set((state) => ({ ...initial, ...preserveLogs(state) })),
  // screenshot 첨부 토글은 startCapturing의 preserveLogs로 직전 상태만 승계(신규 false). freeform/video와 달리 자동 on하지 않는다.
  onAreaCaptured: (dataUrl, viewport) => set({ phase: "drafting", screenshotRaw: dataUrl, screenshotViewport: viewport, screenshotCapturedAt: Date.now() }),
  onAnnotated: (dataUrl) => set({ screenshotAnnotated: dataUrl }),

  onElementSelected: (selection) =>
    set({
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
    }),

  updateSelectionStyles: (patch) =>
    set((s) => {
      if (!s.selection) return {};
      return { selection: { ...s.selection, ...patch } };
    }),

  setStyleEdits: (patch) =>
    set((s) => ({ styleEdits: { ...s.styleEdits, ...patch } })),

  setTokens: (tokens) => set({ tokens }),

  setBeforeImage: (beforeImage) => set({ beforeImage }),

  setAfterImage: (afterImage) => set({ afterImage }),

  confirmStyles: () => set({ phase: "drafting", aiStylingLoading: false }),

  backToStyling: () => set({ phase: "styling", afterImage: null, aiStylingLoading: false }),

  setDraft: (draft) => set({ draft }),

  confirmDraft: () => {
    const state = get();
    if (!state.draft || !state.target) {
      set({ phase: "previewing" });
      return;
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
        set({ phase: "previewing" });
        return;
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
      });
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
        if (failed) onBlobSaveFailed.fire();
      })();
    }
    set({ phase: "previewing", currentIssueId: id });
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
  setTargetPlatform: (platform) => set({ targetPlatform: platform }),

  onSubmitted: (result) => set({ phase: "done", submitResult: result, beforeImage: null, afterImage: null, screenshotRaw: null, screenshotAnnotated: null, videoBlob: null, videoThumbnail: null, networkLog: null, consoleLog: null, actionLog: null }),

  reset: () => set({ ...initial }),

  hydrate: (snapshot) => set(snapshot),
}));

export function useAiLoading(): boolean {
  const draft = useEditorStore((s) => s.aiDraftLoading);
  const styling = useEditorStore((s) => s.aiStylingLoading);
  return draft || styling;
}
