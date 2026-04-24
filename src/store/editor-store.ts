import { create } from "zustand";
import type { Token } from "@/types/picker";
import { useIssuesStore } from "./issues-store";

export type EditorPhase =
  | "idle"
  | "picking"
  | "styling"
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
  priorityId?: string;
  parentKey?: string;
  relatesKey?: string;
}

interface EditorState {
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
  submitResult: { key: string; url: string } | null;
  sessionExpired: boolean;

  startPicking: (target: EditorTarget) => void;
  cancelPicking: () => void;
  onElementSelected: (selection: EditorSelection) => void;
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
  | "phase"
  | "target"
  | "selection"
  | "styleEdits"
  | "tokens"
  | "beforeImage"
  | "afterImage"
  | "draft"
  | "issueFields"
  | "currentIssueId"
  | "submitResult"
>;

const initial = {
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

  startPicking: (target) => set({ ...initial, phase: "picking", target }),
  cancelPicking: () => set({ ...initial }),

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
    if (!state.draft || !state.selection || !state.target) {
      set({ phase: "previewing" });
      return;
    }
    const id = state.currentIssueId ?? newIssueId();
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
    set({ phase: "previewing", currentIssueId: id });
  },

  backToDraft: () => set({ phase: "drafting" }),

  setIssueFields: (patch) =>
    set((s) => ({ issueFields: { ...s.issueFields, ...patch } })),

  onSubmitted: (result) => set({ phase: "done", submitResult: result }),

  reset: () => set({ ...initial }),

  hydrate: (snapshot) => set(snapshot),
}));
