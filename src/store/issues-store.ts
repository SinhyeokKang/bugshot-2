import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { chromeLocalStorage } from "./chrome-storage";
import { useEditorStore, type CaptureMode } from "./editor-store";
import { clearPicker } from "@/sidepanel/picker-control";
import {
  deleteVideoBlob,
  clearVideoBlobs,
  getVideoBlobKeys,
  deleteImageBlobs,
  clearImageBlobs,
  getImageBlobKeys,
  saveImageBlobRaw,
  dataUrlToBlob,
} from "./blob-db";

function stripSubmitted(
  issue: IssueRecord,
  patch: Partial<IssueRecord>,
): IssueRecord {
  return {
    ...issue,
    ...patch,
    status: "submitted",
    updatedAt: Date.now(),
    snapshot: { before: false, after: false },
    draft: { title: "", body: "", expectedResult: "" },
    styleEdits: undefined,
    selectionSnapshot: undefined,
    tokensSnapshot: undefined,
    selector: undefined,
    tagName: undefined,
    viewport: undefined,
    pageTitle: undefined,
  };
}

async function pruneOrphanBlobs(): Promise<void> {
  const currentIds = new Set(
    useIssuesStore.getState().issues.map((i) => i.id),
  );
  const videoBlobKeys = await getVideoBlobKeys();
  for (const key of videoBlobKeys) {
    if (!currentIds.has(key)) {
      deleteVideoBlob(key).catch(() => {});
    }
  }
  const imageBlobKeys = await getImageBlobKeys();
  const prunedImageIds = new Set<string>();
  for (const key of imageBlobKeys) {
    const issueId = key.split(":")[0];
    if (!currentIds.has(issueId) && !prunedImageIds.has(issueId)) {
      prunedImageIds.add(issueId);
      deleteImageBlobs(issueId).catch(() => {});
    }
  }
}

function resetEditorIfEditing(removedId: string | null): void {
  const state = useEditorStore.getState();
  if (removedId === null || state.currentIssueId === removedId) {
    const tabId = state.target?.tabId;
    if (tabId != null) void clearPicker(tabId);
    state.reset();
  }
}

export type IssueStatus = "draft" | "submitted";

export interface IssueSnapshot {
  before: boolean;
  after: boolean;
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
      markSubmitted: (id, patch) => {
        set((s) => ({
          issues: s.issues.map((x) =>
            x.id === id ? stripSubmitted(x, patch) : x,
          ),
        }));
        deleteVideoBlob(id).catch(() => {});
        deleteImageBlobs(id).catch(() => {});
      },
      removeIssue: (id) => {
        set((s) => ({ issues: s.issues.filter((x) => x.id !== id) }));
        deleteVideoBlob(id).catch(() => {});
        deleteImageBlobs(id).catch(() => {});
        resetEditorIfEditing(id);
      },
      clearIssues: () => {
        set({ issues: [] });
        clearVideoBlobs().catch(() => {});
        clearImageBlobs().catch(() => {});
        resetEditorIfEditing(null);
      },
    }),
    {
      name: "bugshot-issues",
      version: 2,
      storage: createJSONStorage(() => chromeLocalStorage),
      migrate: async (persisted, version) => {
        const state = persisted as { issues: IssueRecord[] };
        if (version === 0) {
          state.issues = state.issues.map((i) =>
            i.status === "submitted" ? stripSubmitted(i, {}) : i,
          );
        }
        if (version < 2) {
          for (const issue of state.issues) {
            const snap = issue.snapshot as unknown as {
              before: string | null;
              after: string | null;
            };
            let hasBefore = false;
            let hasAfter = false;
            if (typeof snap.before === "string" && snap.before.startsWith("data:")) {
              try {
                await saveImageBlobRaw(issue.id, "before", dataUrlToBlob(snap.before));
                hasBefore = true;
              } catch { /* image lost on migration failure */ }
            }
            if (typeof snap.after === "string" && snap.after.startsWith("data:")) {
              try {
                await saveImageBlobRaw(issue.id, "after", dataUrlToBlob(snap.after));
                hasAfter = true;
              } catch { /* image lost on migration failure */ }
            }
            issue.snapshot = { before: hasBefore, after: hasAfter };
          }
        }
        return state as unknown as IssuesState;
      },
      onRehydrateStorage: () => () => {
        void pruneOrphanBlobs();
      },
    },
  ),
);
