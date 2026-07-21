import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { PlatformId } from "@/types/platform";
import type { EnvironmentRow } from "@/types/environment";
import { migrateIssueToV4 } from "./issues-migrations";
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
  deleteNetworkLog,
  clearNetworkLogs,
  getNetworkLogKeys,
  deleteConsoleLog,
  clearConsoleLogs,
  getConsoleLogKeys,
  deleteActionLog,
  clearActionLogs,
  getActionLogKeys,
  deleteAttachmentBlobs,
  clearAttachmentBlobs,
  getAttachmentBlobKeys,
  saveImageBlobRaw,
  dataUrlToBlob,
} from "./blob-db";
import type { UserAttachmentMeta } from "@/types/attachment";

export function stripSubmitted(
  issue: IssueRecord,
  patch: Partial<IssueRecord>,
): IssueRecord {
  return {
    ...issue,
    ...patch,
    status: "submitted",
    submittedAt: Date.now(),
    updatedAt: Date.now(),
    snapshot: { before: false, after: false },
    draft: { title: "", sections: {}, environment: [] },
    styleEdits: undefined,
    selectionSnapshot: undefined,
    tokensSnapshot: undefined,
    selector: undefined,
    tagName: undefined,
    viewport: undefined,
    pageTitle: undefined,
    networkLogBlobKey: undefined,
    consoleLogBlobKey: undefined,
    actionLogBlobKey: undefined,
    attachments: undefined,
    slackPreserved: undefined,
  };
}

async function pruneOrphanBlobs(): Promise<void> {
  const currentIds = new Set(
    useIssuesStore.getState().issues.map((i) => i.id),
  );
  const deletions: Promise<unknown>[] = [];
  const videoBlobKeys = await getVideoBlobKeys();
  for (const key of videoBlobKeys) {
    if (key.startsWith("pending:")) continue;
    if (!currentIds.has(key)) {
      deletions.push(deleteVideoBlob(key));
    }
  }
  const imageBlobKeys = await getImageBlobKeys();
  const prunedImageIds = new Set<string>();
  for (const key of imageBlobKeys) {
    const issueId = key.split(":")[0];
    if (!currentIds.has(issueId) && !prunedImageIds.has(issueId)) {
      prunedImageIds.add(issueId);
      deletions.push(deleteImageBlobs(issueId));
    }
  }
  const networkLogKeys = await getNetworkLogKeys();
  for (const key of networkLogKeys) {
    if (key.startsWith("pending:")) continue;
    if (!currentIds.has(key)) {
      deletions.push(deleteNetworkLog(key));
    }
  }
  const consoleLogKeys = await getConsoleLogKeys();
  for (const key of consoleLogKeys) {
    if (key.startsWith("pending:")) continue;
    if (!currentIds.has(key)) {
      deletions.push(deleteConsoleLog(key));
    }
  }
  const actionLogKeys = await getActionLogKeys();
  for (const key of actionLogKeys) {
    if (key.startsWith("pending:")) continue;
    if (!currentIds.has(key)) {
      deletions.push(deleteActionLog(key));
    }
  }
  const attachmentBlobKeys = await getAttachmentBlobKeys();
  const prunedAttIds = new Set<string>();
  for (const key of attachmentBlobKeys) {
    if (key.startsWith("pending:")) continue;
    const issueId = key.split(":")[0];
    if (!currentIds.has(issueId) && !prunedAttIds.has(issueId)) {
      prunedAttIds.add(issueId);
      deletions.push(deleteAttachmentBlobs(issueId));
    }
  }
  await Promise.allSettled(deletions);
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
  sections: Record<string, string>;
  environment?: EnvironmentRow[];
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

// 복수 element 버퍼의 한 항목(현재 element 제외 — 그건 record 최상위 styleEdits/selectionSnapshot).
// 이미지는 blob-db에 b${i}-before/after 슬롯으로 저장. hasBefore/hasAfter로 존재 표시.
export interface IssueBufferedElement {
  selector: string;
  tagName: string;
  // 프레임 구분(0=top)·origin — 동일 selector의 프레임 간 dedup 붕괴 방지. 구 초안은 undefined → ?? 0 / ?? "".
  frameId?: number;
  origin?: string;
  styleEdits: IssueStyleEdits;
  selectionSnapshot: IssueSelectionSnapshot;
  hasBefore: boolean;
  hasAfter: boolean;
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
  // 현재 element의 프레임(0=top). element 모드 draft의 dedup 정합용. 구 초안 undefined → ?? 0.
  frameId?: number;
  viewport?: { width: number; height: number };
  // 영상 동기화 앵커(공통 0점). video 모드에서만 세팅. 구 draft는 undefined → 동기화 비활성.
  videoStartedAt?: number;
  videoEndedAt?: number;

  draft: IssueDraftContent;
  styleEdits?: IssueStyleEdits;
  snapshot: IssueSnapshot;

  // 초안 재제출을 위한 풀 컨텍스트. 구 초안은 없을 수 있음 (optional).
  selectionSnapshot?: IssueSelectionSnapshot;
  tokensSnapshot?: IssueTokenSnapshot[];
  // 복수 element 버퍼(현재 element 앞에 편집한 것들). 단일/구 초안은 undefined.
  bufferedElements?: IssueBufferedElement[];

  networkLogBlobKey?: string;
  consoleLogBlobKey?: string;
  actionLogBlobKey?: string;

  // 사용자 직접 첨부 파일 메타. Blob은 attachments store에 `${id}:${meta.id}` 키로. optional이라 버전 bump 불필요.
  attachments?: UserAttachmentMeta[];

  submittedAt?: number;
  platform: PlatformId;
  key?: string;
  url?: string;
  jiraSiteId?: string;
  issueTypeName?: string;
  priorityName?: string;
  assigneeName?: string;
  // GitHub 전용 — refresh 시 status 조회에 필요. 등록 시점에 ghFields에서 세팅.
  githubOwner?: string;
  githubRepo?: string;
  // jira의 issueTypeName 자리에 메타로 노출되는 분류 태그. 등록 시 ghFields.labels로,
  // 새로고침 후 status fetch 응답의 labels[].name으로 갱신.
  githubLabels?: string[];
  // Linear 전용
  linearIdentifier?: string;
  linearTeamKey?: string;
  linearLabelName?: string;
  // Notion 전용
  notionPageId?: string;
  notionDatabaseId?: string;
  notionDatabaseTitle?: string;
  notionStatusOption?: string;
  // GitLab 전용 — project id로 경로 구성, iid로 표시·조회.
  gitlabProjectId?: number;
  gitlabIssueIid?: number;
  gitlabLabels?: string[];
  // Asana 전용 — task gid로 조회.
  asanaTaskGid?: string;
  // ClickUp 전용 — task id로 조회.
  clickupTaskId?: string;
  // submitted이면서 Slack 공유로 원본 데이터(draft/snapshot/blob)를 보존 중인 이슈.
  // 일반 트래커로 승격(markSubmitted→stripSubmitted)되면 함께 폐기된다.
  slackPreserved?: boolean;
}

// v5: notion 플랫폼 추가 — IssueRecord에 notionPageId/notionDatabaseId/notionDatabaseTitle/notionStatusOption optional 필드.
// PlatformId union에 "notion" 추가. 모두 optional이라 v4→v5 데이터 마이그레이션은 불필요 — 버전 마커만 bump.
// action-recorder: IssueRecord에 actionLogBlobKey optional 추가. optional이라 마이그레이션·버전 bump 불필요.
// video-report: IssueRecord에 videoStartedAt/videoEndedAt optional 추가. 동일하게 버전 bump 불필요.
// multi-element-buffer: IssueRecord에 bufferedElements optional 추가. optional이라 버전 bump 불필요.
export const ISSUES_STORE_VERSION = 5;

interface LegacyIssueRecord extends Omit<IssueRecord, "platform"> {
  platform?: PlatformId;
}

// persist migrate 본체. 구버전 사용자의 초안·이미지가 지나는 유일한 경로라 단위 테스트로 고정한다.
export async function migrateIssuesState(
  persisted: unknown,
  version: number,
): Promise<IssuesState> {
  const state = persisted as { issues: LegacyIssueRecord[] };
  if (version < 4) {
    state.issues = state.issues.map(migrateIssueToV4);
  }
  if (version === 0) {
    state.issues = state.issues.map((i) =>
      i.status === "submitted" ? stripSubmitted(i as IssueRecord, {}) : i,
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
  if (version < 3) {
    for (const issue of state.issues) {
      const legacy = issue.draft as unknown as {
        title?: string;
        body?: string;
        expectedResult?: string;
        sections?: Record<string, string>;
      };
      if (legacy.sections) continue;
      const sections: Record<string, string> = {};
      if (legacy.body) sections.description = legacy.body;
      if (legacy.expectedResult) sections.expectedResult = legacy.expectedResult;
      issue.draft = { title: legacy.title ?? "", sections };
    }
  }
  return state as unknown as IssuesState;
}

interface IssuesState {
  issues: IssueRecord[];
  saveDraft: (record: IssueRecord) => void;
  markSubmitted: (id: string, patch: Partial<IssueRecord>) => void;
  // Slack 공유 — markSubmitted와 정반대로 데이터를 보존한다(blob 삭제 없음).
  markSlackShared: (id: string, patch: { key: string; url: string }) => void;
  patchIssue: (id: string, patch: Partial<IssueRecord>) => void;
  patchDraftSnapshot: (id: string, patch: Partial<IssueSnapshot>) => void;
  patchDraftBufferedImageFlags: (
    id: string,
    index: number,
    patch: { hasBefore?: boolean; hasAfter?: boolean },
  ) => void;
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
        deleteNetworkLog(id).catch(() => {});
        deleteConsoleLog(id).catch(() => {});
        deleteActionLog(id).catch(() => {});
        deleteAttachmentBlobs(id).catch(() => {});
      },
      markSlackShared: (id, patch) =>
        set((s) => ({
          issues: s.issues.map((x) =>
            x.id === id
              ? {
                  ...x,
                  key: patch.key,
                  url: patch.url,
                  status: "submitted",
                  platform: "slack",
                  slackPreserved: true,
                  submittedAt: Date.now(),
                  updatedAt: Date.now(),
                }
              : x,
          ),
        })),
      patchIssue: (id, patch) =>
        set((s) => ({
          issues: s.issues.map((x) =>
            x.id === id ? { ...x, ...patch } : x,
          ),
        })),
      patchDraftSnapshot: (id, patch) =>
        set((s) => ({
          issues: s.issues.map((x) =>
            x.id === id ? { ...x, snapshot: { ...x.snapshot, ...patch } } : x,
          ),
        })),
      // 버퍼 element의 blob 저장 실패 시 hasBefore/hasAfter를 레코드와 일치시킨다(플래그-blob 정합).
      patchDraftBufferedImageFlags: (id, index, patch) =>
        set((s) => ({
          issues: s.issues.map((x) =>
            x.id === id && x.bufferedElements?.[index]
              ? {
                  ...x,
                  bufferedElements: x.bufferedElements.map((b, i) =>
                    i === index ? { ...b, ...patch } : b,
                  ),
                }
              : x,
          ),
        })),
      removeIssue: (id) => {
        set((s) => ({ issues: s.issues.filter((x) => x.id !== id) }));
        deleteVideoBlob(id).catch(() => {});
        deleteImageBlobs(id).catch(() => {});
        deleteNetworkLog(id).catch(() => {});
        deleteConsoleLog(id).catch(() => {});
        deleteActionLog(id).catch(() => {});
        deleteAttachmentBlobs(id).catch(() => {});
        resetEditorIfEditing(id);
      },
      clearIssues: () => {
        set({ issues: [] });
        clearVideoBlobs().catch(() => {});
        clearImageBlobs().catch(() => {});
        clearNetworkLogs().catch(() => {});
        clearConsoleLogs().catch(() => {});
        clearActionLogs().catch(() => {});
        clearAttachmentBlobs().catch(() => {});
        resetEditorIfEditing(null);
      },
    }),
    {
      name: "bugshot-issues",
      version: ISSUES_STORE_VERSION,
      storage: createJSONStorage(() => chromeLocalStorage),
      migrate: migrateIssuesState,
      onRehydrateStorage: () => () => {
        void pruneOrphanBlobs();
      },
    },
  ),
);
