import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import type { PlatformId } from "@/types/platform";
import type { EnvironmentRow } from "@/types/environment";
import { migrateIssueToV4 } from "./issues-migrations";
import { failClosedLocalStorage } from "./chrome-storage";
import { useEditorStore, type CaptureMode } from "./editor-store";
import { clearPicker } from "@/sidepanel/picker-clear";
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
import { ISSUES_PERSIST_KEY, isPendingKey } from "@/lib/session-keys";

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
    bufferedElements: undefined,
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
    // draft.environment가 비워진 뒤 남는 유일한 캡처 문맥 — 사내 호스트명을 무기한 남기지 않는다.
    apiHostsDerived: undefined,
  };
}

// zustand의 postRehydration 콜백은 성공·실패 양쪽에서 발화한다. 실패 시엔 저장분을 못 읽은
// 것이므로 참조 집합(issues)이 비어 보이고, 그대로 prune하면 살아있는 blob을 전부 지운다.
// 외부 write로 촉발된 rehydrate도 마찬가지로 prune 대상이 아니다 — 아래 주석 참조.
export function shouldPruneAfterRehydrate(
  error: unknown,
  isExternalSync: boolean,
): boolean {
  return error == null && !isExternalSync;
}

// 다른 사이드패널 인스턴스의 write로 촉발된 rehydrate 구간. 그 구간의 prune은 금지다 —
// 캡처를 막 끝내 blob을 pending에서 issue id로 rekey했지만 레코드가 아직 storage에 안
// 들어간 인스턴스의 살아있는 blob이 고아로 판정된다(isPendingKey 가드는 rekey 전까지만
// 보호한다). 고아 수거는 마운트 rehydrate에만 맡긴다.
// depth 카운터인 이유: 변경이 연달아 오면 앞선 finally가 뒤 구간의 플래그를 끈다.
// 수용한 잔여: 외부 변경이 마운트 hydration을 추월하면 zustand의 hydrationVersion 가드가
// 마운트 콜백을 아예 건너뛰므로(middleware.js) 그 세션은 prune이 0회다 — 즉 "세션 1회"가
// 아니라 "세션 0~1회"다. 고아는 다음 마운트가 수거하니 용량 축이고, 반대 방향(과잉 삭제)이
// 아니라 안전한 실패 모드다. 세션 플래그로 보정하지 않는 건 그 플래그가 실패 경로에서
// 켜진 채 남으면 prune이 영구 무력화되기 때문이다(POSTMORTEM 2026-07-23).
let externalSyncDepth = 0;

export async function rehydrateIssuesFromExternalWrite(): Promise<void> {
  externalSyncDepth += 1;
  try {
    await useIssuesStore.persist.rehydrate();
  } finally {
    externalSyncDepth -= 1;
  }
}

// persist가 마지막으로 쓴 직렬화 문자열. onChanged는 자기 write에도 발화하는데, 모든
// 뮤테이터가 updatedAt을 올리므로 값 비교(oldValue !== newValue)로는 자기 write가 안 걸러진다.
// 그걸 그대로 두면 (1) 제출 이슈 N건 목록에서 status 배지 N개가 각각 전체 blob의
// get+parse+merge를 태우고 (2) 그 rehydrate의 getItem이 나간 사이 로컬 삭제가 일어나면
// merge의 "존재는 저장분이 권위"가 방금 지운 레코드를 되살린다(삭제는 updatedAt 축 밖이다).
let lastWrittenIssues: string | null = null;

const issuesStorage: StateStorage = {
  ...failClosedLocalStorage,
  async setItem(name, value) {
    lastWrittenIssues = value;
    await failClosedLocalStorage.setItem(name, value);
  },
};

// settings의 에코 가드와 같은 이유 — chrome.storage는 값이 안 바뀌어도 set마다 발화한다.
// 거기에 자기 write 필터를 더한다(위 주석).
export function shouldSyncIssuesChange(
  change: chrome.storage.StorageChange | undefined,
  lastWritten: string | null = null,
): boolean {
  if (!change) return false;
  if (change.oldValue === change.newValue) return false;
  return lastWritten === null || change.newValue !== lastWritten;
}

export function lastWrittenIssuesValue(): string | null {
  return lastWrittenIssues;
}

function pickIssue(persisted: IssueRecord, current: IssueRecord): IssueRecord {
  // 역행 금지. submitted가 draft로 되돌아가면 사용자가 다시 제출해 목적지 플랫폼에 중복
  // 티켓이 생기고, stripSubmitted가 이미 지운 blob을 참조하는 레코드가 남는다.
  if (persisted.status !== current.status) {
    return persisted.status === "submitted" ? persisted : current;
  }
  // 동률이면 메모리를 유지한다 — 자기 write가 촉발한 onChanged에서 레코드 identity가 갈리는
  // 걸 막는다. 동률이 곧 무변경이어야 이게 성립하므로, 레코드를 바꾸는 모든 액션이
  // updatedAt을 올린다(patch* 3종 포함 — 안 올리면 상대의 변경이 무음으로 버려진다).
  return persisted.updatedAt > current.updatedAt ? persisted : current;
}

/**
 * 저장분과 메모리의 issue 목록을 레코드 단위로 합친다(#240).
 *
 * 인스턴스가 둘 이상이면 각자 마운트 시점 스냅샷을 계속 재직렬화하므로, 병합 없이는 마지막
 * write가 배열을 통째로 덮는다 — 제출된 이슈가 Draft로 되돌아가고 삭제된 이슈가 미디어 없이
 * 되살아난다. 규칙은 셋이다:
 * - **존재는 저장분이 권위** — 메모리에만 있는 레코드는 드롭한다(삭제 좀비 금지).
 * - **submitted는 draft로 역행하지 않는다** — updatedAt보다 우선한다.
 * - 나머지는 updatedAt 최신 승자, 동률은 메모리.
 *
 * 필드 단위 병합은 하지 않는다 — 레코드 하나를 통째로 고른다. 필드를 섞으면 "키 없음"이
 * "기존 값 유지"로 뒤집혀 사용자가 비운 필드가 되살아난다(POSTMORTEM 2026-07-26 A-11).
 *
 * 무변경이면 current를 **참조까지 그대로** 돌려준다 — 그래야 자기 write가 촉발한 rehydrate가
 * 구독을 건드리지 않는다.
 *
 * 예외가 하나 있다 — `ownedId`(로컬 에디터가 들고 있는 레코드)가 **아직 draft이면** 저장분에
 * 없어도 보전한다. 존재 권위를 예외 없이 적용하면 다른 인스턴스가 그 초안을 지운 순간 이쪽
 * 메모리에서도 사라지고, 이어지는 `markSubmitted`가 **무음 no-op**이 된다 — 티켓은
 * 목적지에 생겼는데 로컬엔 key/url이 없어 status 조회도, 중복 제출 방지도 못 한다(#240이
 * 실제로 비용을 치른 그 형태). 제출 in-flight 구간은 `markSubmitted` 직전까지 draft라
 * 이 조건으로 덮인다.
 *
 * submitted까지 보전하지 않는 이유: `currentIssueId`는 제출 후에도 남는다(`onSubmitted`는
 * phase만 옮기고, 해제는 사용자가 성공 화면을 닫아 `reset()`이 돌 때뿐이며 세션 스냅샷으로
 * 복원되기까지 한다). 그걸 보전하면 다른 창이 지운 **제출 완료** 이슈가 blob 없이 되살아나
 * #240이 고발한 좀비 그대로가 된다. 그 구간엔 위 정당화(뒤따를 markSubmitted)도 없다.
 *
 * 보전된 draft는 blob이 없을 수 있다 — `removeIssue`는 레코드를 지우면서 blob 6종을 같은
 * 틱에 삭제하므로, 저쪽이 지운 뒤 이쪽이 보전하면 스크린샷·로그가 빠진 채 편집이 이어진다.
 * 그건 보전이 만든 손실이 아니라 저쪽 삭제가 만든 손실이고(보전을 빼도 blob은 안 돌아온다),
 * 이 예외는 `reset()`이 돌 때까지 — `currentIssueId`가 세션 스냅샷으로 복원되므로 패널을
 * 닫았다 열어도 — 유지된다.
 *
 * 남는 구멍: 서로의 read 사이에 끼어든 진짜 동시 write는 여전히 배열을 덮는다. 방금 만들어
 * 아직 영속 전인 레코드도 드롭될 수 있다(창은 그 write의 storage 왕복이 끝날 때까지). 그
 * 구간의 레코드는 대개 `ownedId`라 위 예외가 덮고, 아니어도 그 write의 onChanged가 다음
 * rehydrate를 예약해 자기치유된다.
 *
 * merge 결과는 storage로 되쓰이지 않는다 — zustand는 migrate가 돈 경우에만 setItem을 태운다.
 * 메모리가 이긴 레코드는 다음 로컬 뮤테이션이 있어야 영속되고, 그 전에 패널이 닫히면 저장분이
 * 남는다. 대신 이 성질 덕에 두 인스턴스가 서로의 rehydrate를 무한히 깨우는 루프가 없다.
 */
export function mergeIssueLists(
  persisted: IssueRecord[],
  current: IssueRecord[],
  ownedId?: string | null,
): IssueRecord[] {
  const byId = new Map(current.map((issue) => [issue.id, issue]));
  const merged = persisted.map((p) => {
    const c = byId.get(p.id);
    return c ? pickIssue(p, c) : p;
  });
  const owned = ownedId ? byId.get(ownedId) : undefined;
  if (owned?.status === "draft" && !merged.some((issue) => issue.id === ownedId)) {
    merged.push(owned);
  }
  return sameRefs(merged, current) ? current : merged;
}

function sameRefs(next: IssueRecord[], prev: IssueRecord[]): boolean {
  return next.length === prev.length
    && next.every((issue, index) => issue === prev[index]);
}

// persist merge 진입점. zustand는 이 결과를 set(state, true)로 **replace** 하므로 액션까지
// 든 완전한 상태를 돌려줘야 한다. 저장분이 없거나(최초 실행) issues가 배열이 아니면
// (버전이 같아 migrate가 안 돈 오염) 메모리를 유지한다 — []로 읽으면 초안이 통째로 날아간다.
// 무변경이면 state 객체까지 그대로 돌려준다(zustand가 Object.is로 리스너를 건너뛴다).
// issues 외의 저장분 키는 버린다 — 이 스토어의 영속 필드는 issues 단독이고,
// IssuesState에 영속 필드가 추가되면 여기 명시해야 한다(그물: issues-store.test.ts
// "영속 필드는 issues 단독").
export function mergeIssuesState(
  persisted: unknown,
  current: IssuesState,
): IssuesState {
  const source = persisted && typeof persisted === "object"
    ? persisted as Record<string, unknown>
    : null;
  if (!source || !Array.isArray(source.issues)) return current;
  const issues = mergeIssueLists(
    source.issues as IssueRecord[],
    current.issues,
    useEditorStore.getState().currentIssueId,
  );
  return issues === current.issues ? current : { ...current, issues };
}

async function pruneOrphanBlobs(): Promise<void> {
  const currentIds = new Set(
    useIssuesStore.getState().issues.map((i) => i.id),
  );
  const deletions: Promise<unknown>[] = [];
  const videoBlobKeys = await getVideoBlobKeys();
  for (const key of videoBlobKeys) {
    if (isPendingKey(key)) continue;
    if (!currentIds.has(key)) {
      deletions.push(deleteVideoBlob(key));
    }
  }
  const imageBlobKeys = await getImageBlobKeys();
  const prunedImageIds = new Set<string>();
  for (const key of imageBlobKeys) {
    if (isPendingKey(key)) continue;
    const issueId = key.split(":")[0];
    if (!currentIds.has(issueId) && !prunedImageIds.has(issueId)) {
      prunedImageIds.add(issueId);
      deletions.push(deleteImageBlobs(issueId));
    }
  }
  const networkLogKeys = await getNetworkLogKeys();
  for (const key of networkLogKeys) {
    if (isPendingKey(key)) continue;
    if (!currentIds.has(key)) {
      deletions.push(deleteNetworkLog(key));
    }
  }
  const consoleLogKeys = await getConsoleLogKeys();
  for (const key of consoleLogKeys) {
    if (isPendingKey(key)) continue;
    if (!currentIds.has(key)) {
      deletions.push(deleteConsoleLog(key));
    }
  }
  const actionLogKeys = await getActionLogKeys();
  for (const key of actionLogKeys) {
    if (isPendingKey(key)) continue;
    if (!currentIds.has(key)) {
      deletions.push(deleteActionLog(key));
    }
  }
  const attachmentBlobKeys = await getAttachmentBlobKeys();
  const prunedAttIds = new Set<string>();
  for (const key of attachmentBlobKeys) {
    if (isPendingKey(key)) continue;
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

type IssueStatus = "draft" | "submitted";

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

interface IssueTokenSnapshot {
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
  // logs.html 제출 첨부 여부(편집 이슈에서 토글). undefined = 첨부(기존 이슈 기본값). blob은 불변 —
  // 이 플래그만 게이트하므로 off→on 가역. optional이라 마이그레이션·버전 bump 불필요.
  logsAttached?: boolean;

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

  /**
   * 저장 시점의 API Hosts 자동 파생값(editor-store.apiHostsDerived 스냅샷).
   * stripApiHostsRows가 "사용자가 손 안 댄 자동 행"을 판정하는 유일한 재료다.
   * 구 draft는 undefined → null로 읽혀 어떤 행과도 일치하지 않으므로 strip이 no-op가 된다
   * (판정 재료 없이 지우면 사용자가 고친 값을 지울 수 있다).
   */
  apiHostsDerived?: string | null;
}

// v5: notion 플랫폼 추가 — IssueRecord에 notionPageId/notionDatabaseId/notionDatabaseTitle/notionStatusOption optional 필드.
// PlatformId union에 "notion" 추가. 모두 optional이라 v4→v5 데이터 마이그레이션은 불필요 — 버전 마커만 bump.
// action-recorder: IssueRecord에 actionLogBlobKey optional 추가. optional이라 마이그레이션·버전 bump 불필요.
// video-report: IssueRecord에 videoStartedAt/videoEndedAt optional 추가. 동일하게 버전 bump 불필요.
// multi-element-buffer: IssueRecord에 bufferedElements optional 추가. optional이라 버전 bump 불필요.
// audit-refactor-4: IssueRecord에 apiHostsDerived optional 추가. 동일하게 버전 bump 불필요 —
// 구 draft는 undefined로 읽혀 자동 행 strip이 no-op가 되므로 backfill 마이그레이션도 하지 않는다.
export const ISSUES_STORE_VERSION = 5;

interface LegacyIssueRecord extends Omit<IssueRecord, "platform"> {
  platform?: PlatformId;
}

// persist migrate 본체. 구버전 사용자의 초안·이미지가 지나는 유일한 경로라 단위 테스트로 고정한다.
export async function migrateIssuesState(
  persisted: unknown,
  version: number,
): Promise<IssuesState> {
  const source = persisted && typeof persisted === "object"
    ? persisted as Record<string, unknown>
    : {};
  const state = {
    ...source,
    issues: Array.isArray(source.issues) ? source.issues as LegacyIssueRecord[] : [],
  };
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

export interface IssuesState {
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
          // 통째 교체가 아니라 병합 — patchIssue로만 세팅되는 필드(logsAttached·attachments·
          // 제출 결과)가 재확정 한 번에 사라지던 구멍을 막는다. record가 키를 명시적으로
          // undefined로 실어 보내면 그건 그대로 폐기된다(spread가 undefined도 덮어쓴다).
          const next: IssueRecord = {
            ...existing,
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
      // updatedAt을 함께 올린다 — 안 올리면 다른 인스턴스와 동률이 되어 이 변경이 병합에서
      // 무음으로 버려진다(logsAttached·platform·attachments는 사용자 데이터다).
      // 정렬·표시는 submittedAt/createdAt을 쓰므로 UI 영향은 없다. 스프레드 **뒤**에 두는 건
      // 의도다 — 호출부가 stale timestamp를 실어 동률 규칙을 다시 열 수 없게 한다.
      patchIssue: (id, patch) =>
        set((s) => ({
          issues: s.issues.map((x) =>
            x.id === id ? { ...x, ...patch, updatedAt: Date.now() } : x,
          ),
        })),
      patchDraftSnapshot: (id, patch) =>
        set((s) => ({
          issues: s.issues.map((x) =>
            x.id === id
              ? { ...x, snapshot: { ...x.snapshot, ...patch }, updatedAt: Date.now() }
              : x,
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
                  updatedAt: Date.now(),
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
      name: ISSUES_PERSIST_KEY,
      version: ISSUES_STORE_VERSION,
      storage: createJSONStorage(() => issuesStorage),
      migrate: migrateIssuesState,
      merge: mergeIssuesState,
      onRehydrateStorage: () => (_state, error) => {
        if (!shouldPruneAfterRehydrate(error, externalSyncDepth > 0)) return;
        void pruneOrphanBlobs();
      },
    },
  ),
);
