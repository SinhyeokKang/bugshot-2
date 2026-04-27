import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { chromeLocalStorage } from "./chrome-storage";
import { useEditorStore, type CaptureMode } from "./editor-store";
import { deleteVideoBlob, clearVideoBlobs } from "./video-db";

function resetEditorIfEditing(removedId: string | null): void {
  const state = useEditorStore.getState();
  if (removedId === null || state.currentIssueId === removedId) {
    state.reset();
  }
}

export type IssueStatus = "draft" | "submitted";

export interface IssueSnapshot {
  before: string | null;
  after: string | null;
}

export interface IssueStyleEdits {
  classList: string[];
  inlineStyle: Record<string, string>;
  text: string;
}

export interface IssueDraftContent {
  title: string;
  body: string;
  expectedResult: string;
}

export interface IssueSelectionSnapshot {
  classList: string[];
  specifiedStyles: Record<string, string>;
  computedStyles: Record<string, string>;
  text: string | null;
  viewport: { width: number; height: number };
  capturedAt: number;
}

export interface IssueTokenSnapshot {
  name: string;
  value: string;
}

export interface IssueRecord {
  id: string;
  status: IssueStatus;
  title: string;
  createdAt: number;
  updatedAt: number;

  captureMode?: CaptureMode;
  pageUrl: string;
  pageTitle?: string;
  selector?: string;
  tagName?: string;
  viewport?: { width: number; height: number };

  draft: IssueDraftContent;
  styleEdits?: IssueStyleEdits;
  snapshot: IssueSnapshot;

  // 초안 재제출을 위한 풀 컨텍스트. 구 초안은 없을 수 있음 (optional).
  selectionSnapshot?: IssueSelectionSnapshot;
  tokensSnapshot?: IssueTokenSnapshot[];

  key?: string;
  url?: string;
  jiraSiteId?: string;
  issueTypeName?: string;
  priorityName?: string;
  assigneeName?: string;
}

interface IssuesState {
  issues: IssueRecord[];
  saveDraft: (record: IssueRecord) => void;
  markSubmitted: (id: string, patch: Partial<IssueRecord>) => void;
  removeIssue: (id: string) => void;
  clearIssues: () => void;
}

export const useIssuesStore = create<IssuesState>()(
  persist(
    (set) => ({
      issues: [],
      saveDraft: (record) =>
        set((s) => {
          const existing = s.issues.find((x) => x.id === record.id);
          const rest = s.issues.filter((x) => x.id !== record.id);
          const createdAt = existing?.createdAt ?? record.createdAt ?? Date.now();
          const next: IssueRecord = {
            ...record,
            createdAt,
            updatedAt: Date.now(),
          };
          return { issues: [next, ...rest] };
        }),
      markSubmitted: (id, patch) =>
        set((s) => ({
          issues: s.issues.map((x) =>
            x.id === id
              ? { ...x, ...patch, status: "submitted", updatedAt: Date.now() }
              : x,
          ),
        })),
      removeIssue: (id) => {
        set((s) => ({ issues: s.issues.filter((x) => x.id !== id) }));
        deleteVideoBlob(id).catch(() => {});
        resetEditorIfEditing(id);
      },
      clearIssues: () => {
        set({ issues: [] });
        clearVideoBlobs().catch(() => {});
        resetEditorIfEditing(null);
      },
    }),
    {
      name: "bugshot-issues",
      storage: createJSONStorage(() => chromeLocalStorage),
    },
  ),
);
