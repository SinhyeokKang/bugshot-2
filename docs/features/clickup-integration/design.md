# ClickUp 연동 — 기술 설계

## 개요

GitLab 통합을 1:1 템플릿으로 미러링하되 인증은 **Personal Token only**(`Authorization: <token>`, Bearer 아님), 생성은 **평범한 JSON**(`POST /list/{id}/task`), 본문은 **`markdown_content` 네이티브**(변환기 불필요)다. 가장 큰 차이는 **team→space→(folder)→list 4단 리소스 계층** 피커. OAuth는 비목표.

## 변경 범위

### 신규 파일 (GitLab 미러)

| GitLab 템플릿 | ClickUp 신규 파일 | 역할 |
|---|---|---|
| `src/types/gitlab.ts` | `src/types/clickup.ts` | 타입 |
| `src/background/gitlab-api.ts` | `src/background/clickup-api.ts` | REST 어댑터 |
| `src/background/gitlab-oauth.ts` | (없음 — Personal Token only) | — |
| `buildGitlabIssueBody.ts` | `buildClickupIssueBody.ts` | 마크다운 본문(거의 동일) |
| `submitToGitlab.ts` | `submitToClickup.ts` | 업로드+생성 |
| `connect/gitlabInstanceUrl.ts` | (불필요 — ClickUp 클라우드 단일) | — |
| `gitlabFields/ProjectCombobox.tsx` | `clickupFields/{TeamCombobox,SpaceCombobox,ListCombobox}.tsx` | 4단 계층 |
| `gitlabFields/AssigneeCombobox.tsx` | `clickupFields/AssigneeCombobox.tsx` | assignee |
| `gitlabFields/GitlabIssueFields.tsx` | `clickupFields/ClickupIssueFields.tsx` | 필드 폼 |
| `connect/GitlabConnectForm.tsx` | `connect/ClickupConnectForm.tsx` | 연결(Personal Token) |
| `statusBadges/GitlabStatusBadge.tsx` | `statusBadges/ClickupStatusBadge.tsx` | status 배지 |
| `statusBadges/GitlabSubmittedBadge.tsx` | `statusBadges/ClickupSubmittedBadge.tsx` | status fetch/렌더 |

### 수정 파일 (공유 인프라)

GitLab 11개 지점. OAuth 관련 전부 생략(Azure와 동일).

- `src/types/platform.ts`: `"clickup"` 추가; `PLATFORM_TAB_KEYS.clickup`; `Accounts.clickup?`; `ClickupLastSubmitFields` + `LastSubmitFieldsByPlatform.clickup?`.
- `manifest.config.ts`: `host_permissions`에 `"https://api.clickup.com/*"`.
- `src/background/messages.ts`: `clickup.*` 케이스 + `loadClickupAuth()`. OAuth/refresh-hook 없음.
- `src/types/messages.ts`: `clickup.*` 유니언.
- `src/sidepanel/tabs/IntegrationsTab.tsx`: `SiClickup` 아이콘 + PLATFORMS 엔트리.
- `src/lib/settings-storage.ts`: `accounts.clickup?`; `readStoredClickupAuth()`. (토큰 불변 → write 함수 불필요)
- `src/store/settings-store.ts`: `updateClickupAccount()`; `SETTINGS_STORE_VERSION` +1.
- `src/sidepanel/tabs/IssueCreateModal.tsx`: clickup 제출 분기 + lastSubmitFields.
- `src/sidepanel/hooks/usePlatformFields.ts`: clickup 필드(team/space/list).
- `src/sidepanel/tabs/issueListUtils.ts`: `resolveClickupCoords()`.
- `src/store/issues-store.ts`: `clickupTaskId?: string`, `clickupListId?: string`.
- `src/i18n/integrations.ts` + `issue.ts`: `clickup.*` 키.
- `.env.example`: (OAuth 비목표 → 추가 없음).

## 데이터 흐름

```
IssueCreateModal (clickup 선택)
  → submitToClickup({ listId, assigneeId, ctx, images, video, logs })
     1. buildClickupIssueBody(ctx) → markdown_content (이미지 인라인은 검증 후 결정)
     2. sendMessage("clickup.submitIssue", { listId, payload }) → createTask
        ↳ POST /list/{listId}/task  { name, markdown_content, assignees:[id]? }
     3. sendMessage("clickup.uploadFiles", { taskId, files })  ← task 생성 후 첨부
        ↳ POST /task/{taskId}/attachment (multipart) → { url }  (per-file 격리)
  → NormalizedSubmitResult { url: task.url, key: taskId }
  → issues-store에 clickupTaskId/clickupListId 저장
```

> ClickUp attachment는 task_id 필수 → **생성→첨부 순**(Asana와 동일, GitLab과 반대).

## 인터페이스 설계

### `src/types/clickup.ts`

```typescript
import type { PlatformAccountBase } from "./platform";

export interface ClickupTokenAuth {
  kind: "token";
  token: string;           // pk_...
  viewerId: number;
  viewerName: string;
  viewerEmail?: string;
}
export type ClickupAuth = ClickupTokenAuth;   // MVP 단일 variant

export interface ClickupDefaults {
  teamId?: string;
  spaceId?: string;
  listId?: string;
  listName?: string;
}
export interface ClickupAccount extends PlatformAccountBase<"clickup"> {
  auth: ClickupAuth;
  defaults: ClickupDefaults;
}

export interface ClickupMyself { id: number; username: string; email?: string; }
export interface ClickupTeam { id: string; name: string; }
export interface ClickupSpace { id: string; name: string; }
export interface ClickupFolder { id: string; name: string; }
export interface ClickupList { id: string; name: string; folderId?: string; }
export interface ClickupMember { id: number; username: string; email?: string; }
export interface ClickupStatusMeta { status: string; type: "open" | "custom" | "closed" | "done"; color?: string; }

export interface ClickupCreateTaskPayload {
  listId: string;
  name: string;
  markdownContent: string;
  assigneeIds?: number[];
}
export interface ClickupCreateTaskResult { id: string; url: string; }
export interface ClickupTaskStatus {
  id: string;
  name: string;
  status: string;          // 현재 status 이름
  statusType: string;      // open/closed/done/custom
  url: string;
}
```

### `src/background/clickup-api.ts`

```typescript
export class ClickupError extends Error { status: number; body?: unknown; }
export function buildAuthHeader(auth: ClickupAuth): string;   // raw token (NOT Bearer)
export function messageForClickupStatus(status: number): string;
export async function clickupFetch<T>(auth: ClickupAuth, path: string, init?: RequestInit): Promise<T>;
export async function getMyself(auth: ClickupAuth): Promise<ClickupMyself>;       // GET /user
export async function getTeams(auth: ClickupAuth): Promise<ClickupTeam[]>;        // GET /team
export async function getSpaces(auth: ClickupAuth, teamId: string): Promise<ClickupSpace[]>;  // GET /team/{id}/space
export async function getLists(auth: ClickupAuth, spaceId: string): Promise<ClickupList[]>;
  // 병합: GET /space/{id}/folder → 각 folder의 /folder/{fid}/list  +  GET /space/{id}/list (folderless)
export async function getListStatuses(auth: ClickupAuth, listId: string): Promise<ClickupStatusMeta[]>;  // GET /list/{id} → statuses
export async function getMembers(auth: ClickupAuth, listId: string): Promise<ClickupMember[]>;  // GET /list/{id}/member
export function mapCreateTaskBody(p: ClickupCreateTaskPayload): Record<string, unknown>;  // { name, markdown_content, assignees? }
export async function createTask(auth: ClickupAuth, payload: ClickupCreateTaskPayload): Promise<ClickupCreateTaskResult>;  // POST /list/{listId}/task
export async function uploadAttachment(auth: ClickupAuth, taskId: string, filename: string, blob: Blob): Promise<{ url: string }>;  // POST /task/{taskId}/attachment (multipart: attachment)
export async function getTaskStatus(auth: ClickupAuth, taskId: string): Promise<ClickupTaskStatus>;  // GET /task/{taskId}
export async function setTaskStatus(auth: ClickupAuth, taskId: string, status: string): Promise<ClickupTaskStatus>;  // PUT /task/{taskId} { status }
```

API base: `https://api.clickup.com/api/v2`. **인증 헤더는 raw token**(`Authorization: pk_...`), Bearer 접두 없음 — GitLab과 다른 유일한 인증 디테일.

### `src/sidepanel/lib/buildClickupIssueBody.ts`

GitLab `buildGitlabIssueBody`와 거의 동일 — 마크다운 그대로 `markdown_content`. 차이: 첨부 이미지 인라인 임베드는 검증 후 결정(위험 요소). **신규 변환기 없음**.

## 기존 패턴 준수

- 스토리지/스토어/메시지/per-file 업로드 격리/i18n 동시 갱신 GitLab 패턴.
- Personal Token 불변 → refresh-hook 불필요.
- status 배지는 GitLab `opened/closed`를 ClickUp 커스텀 status로 일반화(`statusType`으로 닫힘 판정).

## 대안 검토

1. **OAuth2 MVP 포함**: confidential(secret) → 프록시 엔드포인트 신규 필요(Jira/GitHub/Notion 프록시 패턴 확장). MVP 과함 → Personal Token 우선, OAuth 후속.
2. **list 계층 평탄화(team→list 직접 검색)**: ClickUp은 list 전역 검색 API가 없어 space 경유 필수 → 4단 유지.
3. **folderless list 무시**: 실제로 folder 없이 space 직속 list를 쓰는 팀이 많음 → folder+folderless 병합 채택.

## 위험 요소

- **인라인 이미지 렌더**: ClickUp `markdown_content`에서 attachment URL의 `![](url)` 인라인 렌더가 보장되지 않음(attachment는 별도 표시될 수 있음). **구현 전 검증** → 미렌더 시 첨부 + 본문 "첨부 참조" 링크 폴백.
- **4단 계층 UX**: team→space→(folder)→list 선택이 길다. 기본값(account defaults) 적극 활용 + folder 단계는 list 그룹 헤더로 평탄 표시해 클릭 수 절감.
- **커스텀 status 다양성**: list별 status 집합이 달라 "닫기" 동작의 타깃 status를 `statusType`(closed/done)로 결정. 후보 없으면 배지 토글 비활성.
- **rate limit(429)**: ClickUp은 토큰당 분당 제한 → `messageForClickupStatus(429)` 안내.
- **회귀**: PlatformId 확장 → exhaustive switch 컴파일 에러로 누락 검출(typecheck).
