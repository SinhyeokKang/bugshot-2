import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { chromeLocalStorage } from "./chrome-storage";

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

export interface IssueRecord {
  id: string;
  status: IssueStatus;
  title: string;
  createdAt: number;
  updatedAt: number;

  pageUrl: string;
  pageTitle?: string;
  selector: string;
  tagName?: string;

  draft: IssueDraftContent;
  styleEdits: IssueStyleEdits;
  snapshot: IssueSnapshot;

  key?: string;
  url?: string;
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
      removeIssue: (id) =>
        set((s) => ({ issues: s.issues.filter((x) => x.id !== id) })),
      clearIssues: () => set({ issues: [] }),
    }),
    {
      name: "bugshot-issues",
      storage: createJSONStorage(() => chromeLocalStorage),
    },
  ),
);
