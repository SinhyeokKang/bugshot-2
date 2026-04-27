import { create } from "zustand";
import type { Token } from "@/types/picker";
import { useIssuesStore } from "./issues-store";
import { useSettingsStore } from "./settings-store";
import { saveVideoBlob } from "./video-db";

export type CaptureMode = "element" | "screenshot" | "video";

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
  body: string;
  expectedResult: string;
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
  submitResult: { key: string; url: string } | null;
  sessionExpired: boolean;

  startPicking: (target: EditorTarget, mode?: CaptureMode) => void;
  startCapturing: (target: EditorTarget) => void;
  startRecording: (target: EditorTarget) => void;
  onRecordingComplete: (blob: Blob, thumbnail: string, viewport: { width: number; height: number }) => void;
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
  onSubmitted: (result: { key: string; url: string }) => void;
  reset: () => void;
  hydrate: (snapshot: EditorSnapshot) => void;
}

export type EditorSnapshot = Pick<
  EditorState,
  | "captureMode"
  | "phase"
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
  | "draft"
  | "issueFields"
  | "currentIssueId"
  | "submitResult"
>;

const initial = {
  captureMode: "element" as CaptureMode,
  phase: "idle" as EditorPhase,
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
  draft: null,
  issueFields: {} as EditorIssueFields,
  currentIssueId: null as string | null,
  submitResult: null as { key: string; url: string } | null,
  sessionExpired: false,
};

function newIssueId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `issue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  ...initial,

  startPicking: (target, mode) => set({ ...initial, captureMode: mode ?? "element", phase: "picking", target }),
  cancelPicking: () => set({ ...initial }),

  startCapturing: (target) => set({ ...initial, captureMode: "screenshot", phase: "capturing", target }),
  startRecording: (target) => set({ ...initial, captureMode: "video", phase: "recording", target }),
  onRecordingComplete: (blob, thumbnail, viewport) => set({ phase: "drafting", videoBlob: blob, videoThumbnail: thumbnail, videoViewport: viewport, videoCapturedAt: Date.now() }),
  cancelRecording: () => set({ ...initial }),
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

  confirmStyles: () => set({ phase: "drafting" }),

  backToStyling: () => set({ phase: "styling", afterImage: null }),

  setDraft: (draft) => set({ draft }),

  confirmDraft: () => {
    const state = get();
    if (!state.draft || !state.target) {
      set({ phase: "previewing" });
      return;
    }
    const { lastSubmitFields, jiraConfig } = useSettingsStore.getState();
    if (
      lastSubmitFields.projectKey &&
      lastSubmitFields.projectKey === jiraConfig?.projectKey &&
      !state.issueFields.assigneeId &&
      !state.issueFields.priorityId
    ) {
      const { projectKey: _, ...restored } = lastSubmitFields;
      set((s) => ({ issueFields: { ...restored, ...s.issueFields } }));
    }
    const id = state.currentIssueId ?? newIssueId();
    if (state.captureMode === "video") {
      useIssuesStore.getState().saveDraft({
        id,
        status: "draft",
        title: state.draft.title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pageUrl: state.target.url,
        pageTitle: state.target.title,
        captureMode: "video",
        viewport: state.videoViewport ?? undefined,
        draft: { ...state.draft },
        snapshot: {
          before: state.videoThumbnail || null,
          after: null,
        },
      });
      if (state.videoBlob) {
        saveVideoBlob(id, state.videoBlob).catch(() => {});
      }
    } else if (state.captureMode === "screenshot") {
      useIssuesStore.getState().saveDraft({
        id,
        status: "draft",
        title: state.draft.title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pageUrl: state.target.url,
        pageTitle: state.target.title,
        captureMode: "screenshot",
        viewport: state.screenshotViewport ?? undefined,
        draft: { ...state.draft },
        snapshot: {
          before: state.screenshotAnnotated ?? state.screenshotRaw,
          after: null,
        },
      });
    } else {
      if (!state.selection) {
        set({ phase: "previewing" });
        return;
      }
      useIssuesStore.getState().saveDraft({
        id,
        status: "draft",
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
          before: state.beforeImage,
          after: state.afterImage,
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
    }
    set({ phase: "previewing", currentIssueId: id });
  },

  backToDraft: () => set({ phase: "drafting" }),

  setIssueFields: (patch) =>
    set((s) => ({ issueFields: { ...s.issueFields, ...patch } })),

  onSubmitted: (result) => set({ phase: "done", submitResult: result, beforeImage: null, afterImage: null, screenshotRaw: null, screenshotAnnotated: null, videoBlob: null, videoThumbnail: null }),

  reset: () => set({ ...initial }),

  hydrate: (snapshot) => set(snapshot),
}));
