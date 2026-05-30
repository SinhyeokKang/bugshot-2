# Asana 연동 — 기술 설계

## 개요

GitLab 통합(`src/background/gitlab-api.ts`, `src/background/gitlab-oauth.ts`, `src/sidepanel/lib/submitToGitlab.ts`, `src/sidepanel/tabs/gitlabFields/*`, `src/sidepanel/tabs/connect/GitlabConnectForm.tsx`, `src/sidepanel/tabs/statusBadges/Gitlab*Badge.tsx`)을 **1:1 템플릿**으로 삼아 `gitlab` → `asana`로 미러링한다. 어댑터 공통 인터페이스가 없는 구조이므로 파일 단위 복제 후 Asana API 토폴로지에 맞춰 내부만 교체한다. 인증은 PAT + OAuth(PKCE, 프록시 불필요 — GitLab과 동일)를 지원한다.

## 변경 범위

### 신규 파일 (GitLab 미러)

| GitLab 템플릿 | Asana 신규 파일 | 역할 |
|---|---|---|
| `src/types/gitlab.ts` | `src/types/asana.ts` | 타입(아래 인터페이스 설계) |
| `src/background/gitlab-api.ts` | `src/background/asana-api.ts` | REST 어댑터 |
| `src/background/gitlab-oauth.ts` | `src/background/asana-oauth.ts` | PKCE OAuth |
| `src/sidepanel/lib/buildGitlabIssueBody.ts` | `src/sidepanel/lib/buildAsanaIssueBody.ts` | 본문(html_notes) 생성 |
| `src/sidepanel/lib/submitToGitlab.ts` | `src/sidepanel/lib/submitToAsana.ts` | 업로드+생성 오케스트레이션 |
| — (신규, Asana 고유) | `src/sidepanel/lib/markdownToAsanaHtml.ts` | 마크다운 → Asana html_notes 서브셋 변환 |
| `src/sidepanel/tabs/gitlabFields/GitlabIssueFields.tsx` | `src/sidepanel/tabs/asanaFields/AsanaIssueFields.tsx` | 필드 폼 |
| `gitlabFields/ProjectCombobox.tsx` | `asanaFields/WorkspaceCombobox.tsx` + `asanaFields/ProjectCombobox.tsx` | workspace→project 2단 |
| `gitlabFields/AssigneeCombobox.tsx` | `asanaFields/AssigneeCombobox.tsx` | 담당자 |
| `gitlabFields/LabelCombobox.tsx` | (생략 — MVP label 없음) | — |
| `src/sidepanel/tabs/connect/GitlabConnectForm.tsx` | `src/sidepanel/tabs/connect/AsanaConnectForm.tsx` | 연결 플로우 |
| `connect/gitlabInstanceUrl.ts` | (불필요 — Asana 클라우드 단일) | — |
| `statusBadges/GitlabStatusBadge.tsx` | `statusBadges/AsanaStatusBadge.tsx` | 상태 토글 배지 |
| `statusBadges/GitlabSubmittedBadge.tsx` | `statusBadges/AsanaSubmittedBadge.tsx` | 상태 fetch/렌더 |

### 수정 파일 (공유 인프라 — GitLab 추가 시 건드린 11개와 동일 지점)

- `src/types/platform.ts`: `PlatformId`에 `"asana"` 추가; `PLATFORM_TAB_KEYS.asana`; `Accounts.asana?`; `AsanaLastSubmitFields` 인터페이스 + `LastSubmitFieldsByPlatform.asana?`.
- `manifest.config.ts`: `host_permissions`에 `"https://app.asana.com/*"` 추가. (OAuth PKCE라 프록시 불필요)
- `src/background/messages.ts`: `asana.*` 케이스 + `loadAsanaAuth()` 헬퍼 (GitLab 11개 메시지 미러).
- `src/types/messages.ts`: `asana.*` 메시지 유니언.
- `src/sidepanel/tabs/IntegrationsTab.tsx`: `import { SiAsana } from "@icons-pack/react-simple-icons"`; PLATFORMS 배열에 asana 엔트리.
- `src/lib/settings-storage.ts`: `SettingsEnvelope.state.accounts.asana?`; `readStoredAsanaAuth()`; `writeStoredAsanaOAuthTokens()`.
- `src/store/settings-store.ts`: `updateAsanaAccount()` 액션; `SETTINGS_STORE_VERSION` +1 (현재값 확인 후 bump).
- `src/sidepanel/tabs/IssueCreateModal.tsx`: asana 제출 분기 + `lastSubmitFields.asana` 저장 + 이슈 레코드 좌표 저장.
- `src/sidepanel/hooks/usePlatformFields.ts`: asana 필드 상태 init/effect.
- `src/sidepanel/tabs/issueListUtils.ts`: `resolveAsanaCoords()` + `isRefreshable()` 분기.
- `src/store/issues-store.ts`: `asanaTaskGid?: string`, `asanaProjectGid?: string`, `asanaPermalink?: string`.
- `src/i18n/integrations.ts` + `src/i18n/issue.ts`: `asana.*` 키 (ko/en 동시, PostToolUse 훅 자동 검사). `platform.tab.asana`.
- `.env.example`: `VITE_ASANA_CLIENT_ID=`.

## 데이터 흐름

```
IssueCreateModal (asana 선택)
  → submitToAsana({ workspaceGid, projectGid, assigneeGid, ctx, images, video, logs })
     1. sendMessage("asana.uploadFiles", ...)  ← task 생성 후 첨부 (Asana는 parent task 필요)
        ↳ 순서: task 먼저 생성 → attachment POST (per-file 격리)
     2. buildAsanaIssueBody → markdownToAsanaHtml → html_notes
     3. sendMessage("asana.submitIssue", { payload }) → createTask
     4. 첨부 업로드 (asana.uploadFiles, parent=taskGid)
     5. logs.html 첨부 후 (인라인 URL 주입 불필요 — Asana는 첨부 분리)
  → NormalizedSubmitResult { url: permalink, key: taskGid }
  → issues-store에 asanaTaskGid/asanaProjectGid/asanaPermalink 저장
```

> GitLab은 업로드→본문(URL 임베드)→생성 순이지만, **Asana attachment는 parent task gid가 필수**라 생성→첨부 순으로 뒤집힌다 (Jira attachment 패턴과 동일). 따라서 `submitToAsana`는 createTask 먼저, 그다음 attachment 루프.

## 인터페이스 설계

### `src/types/asana.ts`

```typescript
import type { PlatformAccountBase } from "./platform";

export interface AsanaPatAuth {
  kind: "pat";
  pat: string;
  viewerGid: string;
  viewerName: string;
  viewerEmail?: string;
}
export interface AsanaOAuthAuth {
  kind: "oauth";
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  grantedAt: number;
  viewerGid: string;
  viewerName: string;
  viewerEmail?: string;
}
export type AsanaAuth = AsanaPatAuth | AsanaOAuthAuth;

export interface AsanaDefaults {
  workspaceGid?: string;
  workspaceName?: string;
  projectGid?: string;
  projectName?: string;
}
export interface AsanaAccount extends PlatformAccountBase<"asana"> {
  auth: AsanaAuth;
  defaults: AsanaDefaults;
}

export interface AsanaMyself { gid: string; name: string; email?: string; }
export interface AsanaWorkspace { gid: string; name: string; }
export interface AsanaProject { gid: string; name: string; }
export interface AsanaUser { gid: string; name: string; email?: string; }

export interface AsanaCreateTaskPayload {
  workspaceGid: string;
  projectGid?: string;
  name: string;
  htmlNotes: string;     // <body>…</body>
  assigneeGid?: string;
}
export interface AsanaCreateTaskResult {
  gid: string;
  permalinkUrl: string;
}
export interface AsanaTaskStatus {
  gid: string;
  name: string;
  completed: boolean;
  permalinkUrl: string;
}
```

### `src/background/asana-api.ts` (export 시그니처)

```typescript
export class AsanaError extends Error { status: number; body?: unknown; }
export function buildAuthHeader(auth: AsanaAuth): string;          // `Bearer <token>`
export function messageForAsanaStatus(status: number): string;    // 401/403/404/429/5xx
export function setAsanaRefreshHook(hook: ((a: AsanaAuth) => Promise<AsanaAuth>) | null): void;
export async function asanaFetch<T>(auth: AsanaAuth, path: string, init?: RequestInit): Promise<T>;
export async function getMyself(auth: AsanaAuth): Promise<AsanaMyself>;            // GET /users/me
export async function getWorkspaces(auth: AsanaAuth): Promise<AsanaWorkspace[]>;   // GET /workspaces
export async function searchProjects(auth: AsanaAuth, workspaceGid: string, query: string): Promise<AsanaProject[]>; // GET /workspaces/{wid}/projects (클라이언트 필터) 또는 typeahead
export async function searchUsers(auth: AsanaAuth, workspaceGid: string, query: string): Promise<AsanaUser[]>;        // GET /workspaces/{wid}/typeahead?resource_type=user
export function mapCreateTaskBody(p: AsanaCreateTaskPayload): Record<string, unknown>; // { data: { name, html_notes, workspace, projects?, assignee? } }
export async function createTask(auth: AsanaAuth, payload: AsanaCreateTaskPayload): Promise<AsanaCreateTaskResult>;   // POST /tasks
export async function uploadAttachment(auth: AsanaAuth, taskGid: string, filename: string, blob: Blob): Promise<{ gid: string }>; // POST /attachments (multipart: parent, file)
export async function getTaskStatus(auth: AsanaAuth, taskGid: string): Promise<AsanaTaskStatus>;  // GET /tasks/{gid}?opt_fields=name,completed,permalink_url
export async function setTaskCompleted(auth: AsanaAuth, taskGid: string, completed: boolean): Promise<AsanaTaskStatus>; // PUT /tasks/{gid}
```

API base: `https://app.asana.com/api/1.0`. 응답은 `{ data: ... }` 래핑 → fetch 래퍼에서 `.data` 언랩.

### `src/background/asana-oauth.ts`

GitLab `gitlab-oauth.ts` 1:1 미러 (PKCE):
```typescript
export function isAsanaOAuthConfigured(): boolean;          // VITE_ASANA_CLIENT_ID 존재
export function parseAsanaCallbackParams(redirectUrl: string, expectedState: string): { code: string };
export async function startAsanaOAuth(): Promise<AsanaOAuthAuth>;   // launchWebAuthFlow + token 교환
export async function refreshAsanaToken(auth: AsanaAuth): Promise<AsanaAuth>;
export async function persistAsanaOAuthTokens(auth: AsanaOAuthAuth): Promise<void>;
```
- authorize: `https://app.asana.com/-/oauth_authorize`, token: `https://app.asana.com/-/oauth_token`.
- PKCE public client → client secret 불필요 → **OAuth 프록시 불필요** (GitLab/Linear와 동일).

### `src/sidepanel/lib/markdownToAsanaHtml.ts` (Asana 고유 신규)

```typescript
export function markdownToAsanaHtml(markdown: string): string;  // 반환: "<body>…</body>"
```
- 지원 태그: `<body><h1><h2><ol><ul><li><strong><em><u><s><code><pre><a href><blockquote><hr>`.
- 매핑: `# ` → `<h1>`, `## `→`<h2>`, `### ` 이상 → `<strong>`; 코드펜스 → `<pre>`; 링크 → `<a>`; 리스트 → `<ul>/<ol>`.
- **미지원 폴백**: 이미지(`![]()`) → 텍스트 캡션만(미디어는 첨부로 별도); **테이블 → `<pre>` 코드블록**(스타일 diff 테이블이 핵심 케이스).
- `markdown-it`(기존 의존성) 토큰 순회로 구현, GitLab엔 없던 유일한 추가 로직.

## 기존 패턴 준수

- **세션/스토리지 영속화**: `chrome.storage.local` + `settings-store` zustand, GitLab과 동일.
- **메시지 비동기 응답**: `messages.ts` switch + `await loadAsanaAuth()`.
- **refresh-hook**: 모듈 로드 시 `setAsanaRefreshHook(refreshAsanaToken)` 등록 (GitLab `github-oauth.ts:231` 패턴).
- **i18n 동시 갱신**: ko/en 양쪽 `asana.*` 키 추가, PostToolUse 훅 자동 검사 통과.
- **IconButton/콤보박스 사이즈**: GitLab 콤보박스 그대로 (`h-9` 필드, debounce 250ms).
- **per-file 업로드 격리**: `asana.uploadFiles`가 `Array<{filename, gid|null}>` 반환.

## 대안 검토

1. **`notes`(plain text)만 사용 → 변환기 생략**: 가장 단순하지만 본문 서식(헤딩·리스트·링크)이 전부 사라져 버그 리포트 가독성이 크게 떨어짐. html_notes + 변환기 채택.
2. **OAuth 생략, PAT만**: Asana는 PKCE라 프록시 없이 OAuth 가능 → 사용자 경험상 OAuth 포함이 비용 대비 이득(GitLab과 동일 수준). 포함.
3. **이미지 인라인 임베드 시도**: Asana html_notes는 `<img>` 미지원이라 불가. 첨부로 확정.

## 위험 요소

- **html_notes 허용 태그**: Asana 문서상 서브셋이 제한적이고 변경 가능. 구현 전 실제 API로 허용 태그를 검증(미지원 태그 포함 시 400). `markdownToAsanaHtml.test.ts`로 케이스 고정.
- **테이블 손실**: 스타일 diff 테이블이 `<pre>`로 폴백되면 정렬 가독성 저하. Before/After를 라벨링된 코드블록으로 렌더해 최소 가독성 확보.
- **typeahead API**: project/user 검색은 `/workspaces/{wid}/typeahead` 사용. workspace 미선택 시 비활성(GitLab `requireProject` 패턴 미러).
- **rate limit(429)**: Asana는 분당 제한이 있음 → `messageForAsanaStatus(429)` 안내.
- **회귀 위험 낮음**: 신규 플랫폼 추가는 기존 5개와 격리. 단 `PlatformId` 유니언 확장이 exhaustive switch(messages.ts, IssueCreateModal, issueListUtils)에 컴파일 에러를 유발하므로 모든 분기 추가 필요 → typecheck로 누락 검출.
