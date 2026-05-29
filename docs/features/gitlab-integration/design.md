# GitLab 연동 — 기술 설계

## 개요

GitLab을 기존 4개 플랫폼과 동일한 **수직 슬라이스 패턴**(타입 1 + API 어댑터 1 + OAuth 1 + 메시지 분기 + 스토어 분기 + connect 폼 + 필드 컴포넌트 + i18n + 테스트)으로 추가한다. GitHub 슬라이스를 레퍼런스로 삼는다 — REST·라벨·담당자·상태(open/close) 모델이 가장 유사하다. 핵심 차이점 두 가지:

1. **base URL 가변**: gitlab.com과 self-managed를 같은 `gitlab` 플랫폼으로 다루기 위해 모든 GitLab API 호출은 `auth`에 실린 base URL을 prefix로 쓴다. Jira의 `apiKey` auth가 이미 `baseUrl`을 보유하는 선례(`src/types/jira.ts`)와 동일.
2. **첨부가 단순**: GitHub은 page injection(`github-upload.ts`)으로 업로드하지만, GitLab은 `POST /projects/:id/uploads` 멀티파트 한 번으로 마크다운 참조를 돌려준다. 별도 page injection·`world:"MAIN"` 불필요.

## 변경 범위

### 신규 파일

| 파일 | 역할 |
|---|---|
| `src/types/gitlab.ts` | `GitlabAuth`(pat/oauth union, 둘 다 `baseUrl` 보유), `GitlabAccount`, `GitlabDefaults`, `GitlabMyself`, `GitlabProject`, `GitlabLabel`, `GitlabMember`, `GitlabCreateIssuePayload`, `GitlabCreateIssueResult`, `GitlabIssueStatus` |
| `src/background/gitlab-api.ts` | REST 어댑터. `buildAuthHeader`, `gitlabFetch`(baseUrl 기반), `getMyself`, `searchProjects`, `getProjectLabels`, `getProjectMembers`, `createIssue`, `uploadFile`, `getIssueStatus`, `updateIssueState`, `messageForGitlabStatus`, `GitlabError`, refresh hook |
| `src/background/gitlab-oauth.ts` | gitlab.com 전용 PKCE OAuth (Linear식 직접 토큰 교환, proxy 불필요). `isGitlabOAuthConfigured`, `startGitlabOAuth`, `refreshGitlabToken`, `parseGitlabCallbackParams` |
| `src/sidepanel/lib/submitToGitlab.ts` | 제출 오케스트레이션 (`submitToGithub.ts` 미러). 첨부 업로드 → 마크다운 인라인 → `gitlab.submitIssue` |
| `src/sidepanel/lib/buildGitlabIssueBody.ts` | 마크다운 본문 빌더 (`buildGithubIssueBody.ts` 미러). GitLab도 마크다운이라 거의 동일 |
| `src/sidepanel/tabs/connect/GitlabConnectForm.tsx` | **두 export로 분리**(연동 탭 리디자인 패턴): `GitlabConnectedBody`(연결 카드 + 기본값 설정) + `GitlabConnectFlow({connected, onConnected})`(행 버튼 + 공용 `ConnectMethodDialog`로 OAuth/PAT 선택 + PAT 다이얼로그 Instance URL+Token 2필드). 다른 `*ConnectForm.tsx` 미러 |
| `src/sidepanel/tabs/gitlabFields/ProjectCombobox.tsx` | 프로젝트 검색 콤보박스 (`githubFields/RepoCombobox.tsx` 미러) |
| `src/sidepanel/tabs/gitlabFields/LabelCombobox.tsx` | 라벨 콤보박스 |
| `src/sidepanel/tabs/gitlabFields/AssigneeCombobox.tsx` | 담당자 콤보박스 |
| `src/sidepanel/tabs/gitlabFields/GitlabIssueFields.tsx` | 필드 컨테이너 (`GithubIssueFields.tsx` 미러) |
| `src/sidepanel/tabs/statusBadges/GitlabSubmittedBadge.tsx` | 상태 폴링 배지 (`GithubSubmittedBadge.tsx` 미러) |
| `src/background/__tests__/gitlab-api.test.ts` | 순수 함수 단위 테스트 |
| `src/background/__tests__/gitlab-oauth.test.ts` | 콜백 파싱·설정 체크 테스트 |

### 변경 파일 (gitlab 분기 추가)

| 파일 | 현재 역할 | 변경 |
|---|---|---|
| `src/types/platform.ts` | `PlatformId` union, `PLATFORM_TAB_KEYS`, `Accounts`, `LastSubmitFieldsByPlatform` | `"gitlab"` 추가 + `GitlabAccount`·`GitlabLastSubmitFields` 필드. `gitlab: "platform.tab.gitlab"` |
| `src/types/messages.ts` | `BgRequest` union, `getOAuthErrorPlatform` | `gitlab.*` 메시지 12종 + `p === "gitlab"` 분기 |
| `src/background/messages.ts` | 메시지 핸들러 switch + `loadXxxAuth` | `loadGitlabAuth()` + gitlab.* case 12종 + import |
| `src/background/index.ts` | `BG_REQUEST_TYPES` 런타임 allowlist Set (line 30) | **gitlab.* 12종 등록 필수.** 여기 없는 `message.type`은 `return false`로 조용히 무시됨 → 누락 시 모든 GitLab 메시지 전면 실패. `tsc` exhaustive `never` 사각지대(런타임 Set이라 컴파일러가 못 잡음) |
| `src/lib/settings-storage.ts` | `readStoredXxxAuth`/`writeStoredXxxOAuthTokens` | `readStoredGitlabAuth`, `writeStoredGitlabOAuthTokens` |
| `src/store/settings-store.ts` | 스토어·setters·버전·`PLATFORM_FALLBACK_ORDER` | `updateGitlabAccount` setter + 버전 6→7(데이터 마이그레이션 불요) + `PLATFORM_FALLBACK_ORDER`에 `"gitlab"` |
| `src/store/issues-store.ts` | `IssueRecord` | `gitlabProjectId?`, `gitlabIssueIid?`, `gitlabLabels?` 등 optional 필드 |
| `src/sidepanel/tabs/IntegrationsTab.tsx` | "내 연동/플랫폼 추가" 서브탭 + `PLATFORMS` 메타 배열(map 동적 렌더) | **`PLATFORMS` 배열에 엔트리 1줄 추가**: `{ id: "gitlab", Icon: SiGitlab, ConnectedBody: GitlabConnectedBody, ConnectFlow: GitlabConnectFlow, iconClassName: "dark:invert" }`. 구버전의 `PlatformSubTab`·`PLATFORM_ORDER`·`PLATFORM_LABEL_KEYS`·`grid-cols-N`·TabsTrigger/TabsContent는 **리디자인으로 제거됨** — 더 이상 손댈 필요 없음. 플랫폼 노출 순서는 `settings-store.ts`의 `PLATFORM_FALLBACK_ORDER`가 결정 |
| `src/sidepanel/tabs/SubmitFieldsDialog.tsx` | 제출 필드 다이얼로그 | configured/canSubmit 분기(중첩 삼항 else→notion 오라우팅 주의) + TabsList **동적 grid 분기에 `length===5 → grid-cols-5` 케이스 추가**(현재 `===4`/`===3`/else=`cols-2`라 5개 연결 시 cols-2로 깨짐) + 필드 렌더 분기에 gitlab |
| `src/sidepanel/hooks/usePlatformFields.ts` | 플랫폼별 필드 state·init·prefill 리셋 effect (github/linear/notion 보유, jira는 별도) | **gitlab 블록 추가 필수.** `gitlabFields` state + `initialGitlabFields` + prefill 리셋 effect(deps: `open/lastGitlabSubmit/gitlabDefaults/resetKey`). 누락 시 `gitlabFields`/`setGitlabFields`가 SubmitFieldsDialog로 전달 불가. gh/linear/notion 블록 미러 |
| `src/sidepanel/tabs/DraftDetailDialog.tsx` | 드래프트 제출 | gitlabAccount·lastGitlabSubmit·`usePlatformFields` + `handleSubmit` dispatch에 gitlab(`submitToGitlab`) |
| `src/sidepanel/tabs/IssueCreateModal.tsx` | 즉시 제출 | 위와 동일 패턴으로 gitlab 분기 |
| `src/sidepanel/tabs/statusBadges/PlatformChip.tsx` | 플랫폼 칩 | fallback 앞에 gitlab(`SiGitlab`) 분기 |
| `src/sidepanel/tabs/statusBadges/SubmittedBadge.tsx` | 배지 디스패치 | `GitlabSubmittedBadge` 라우팅 |
| `src/sidepanel/tabs/issueListUtils.ts` | `canShowIssueUrl` 등 | gitlab 분기 |
| `manifest.config.ts` | host_permissions | `"https://gitlab.com/*"` 추가 (self-managed origin은 기존 `optional_host_permissions: https://*/*, http://*/*` 재사용 + 런타임 요청) |
| `src/i18n/namespaces/integrations.ts` | i18n | `gitlab.*` 키 전체(ko/en 동시) |
| `docs/privacy.md` | 개인정보처리방침 | gitlab.com 신규 호스트 + self-managed 임의 origin 사용 동작 반영(시행일 갱신) |

## 데이터 흐름

### 인증 저장 구조

```
chrome.storage.local["bugshot-settings"].state.accounts.gitlab = {
  platform: "gitlab",
  connectedAt: number,
  auth: GitlabAuth,        // baseUrl을 항상 포함
  defaults: GitlabDefaults // { projectId?, projectPath?, label?, assignee? }
}
```

`GitlabAuth`는 두 종류 모두 `baseUrl`을 갖는다(self-managed PAT가 base URL을 보존해야 하므로):

```typescript
interface GitlabPatAuth {
  kind: "pat";
  pat: string;
  baseUrl: string;          // "https://gitlab.com" | "https://gitlab.example.com"
  viewerUsername: string;
  viewerEmail?: string;
}
interface GitlabOAuthAuth {
  kind: "oauth";
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  baseUrl: string;          // 항상 "https://gitlab.com" (OAuth는 SaaS 전용)
  viewerUsername: string;
  viewerEmail?: string;
  grantedAt: number;
}
type GitlabAuth = GitlabPatAuth | GitlabOAuthAuth;
```

### 제출 흐름 (submitToGitlab.ts)

```
side panel: 캡처 컨텍스트(ctx) + 이미지/영상/로그/인라인
  │
  ├─(1) sendBg("gitlab.uploadFiles", {projectId, files[]})
  │       bg: 각 파일 POST ${baseUrl}/api/v4/projects/:id/uploads (multipart)
  │       ← [{ filename, markdown, url }]   // GitLab이 마크다운 참조 반환
  │
  ├─(2) hrefMap = filename→(markdown 또는 url) ; 인라인 placeholder를 url로 치환
  │
  ├─(3) buildGitlabIssueBody(ctx, images, video, logs) → body(markdown)
  │
  └─(4) sendBg("gitlab.submitIssue", { projectId, title, description: body,
                                       labels: [label?], assigneeIds: [id?] })
          bg: POST ${baseUrl}/api/v4/projects/:id/issues
          ← { iid, web_url, id }
        → NormalizedSubmitResult { key: `#${iid}`, url: web_url }
```

> **GitLab uploads 주의**: `/uploads`가 돌려주는 `url`은 `/uploads/<hash>/<file>.png`처럼 **프로젝트 상대 경로**다. 같은 프로젝트의 이슈 본문 안에서는 상대 마크다운(`![](/uploads/...)`)이 그대로 렌더되므로 반환된 `markdown` 문자열을 본문에 인라인하면 된다. 절대 URL이 필요한 위치는 없음.

> **첨부 업로드 실패 격리**: gitlab.com `/uploads`는 기본 10MB 제한(self-managed 가변). 30s Replay MP4가 자주 초과한다. `submitToLinear.ts`의 첨부 격리 패턴(`.catch(() => null)`)을 미러 — **첨부 업로드 1건 실패가 이슈 생성 전체를 실패시키지 않게** 각 업로드를 격리하고, 실패한 첨부만 토스트로 안내한다. 이슈는 생성된다.

### self-managed 런타임 권한

gitlab.com은 manifest `host_permissions`에 포함되므로 즉시 fetch 가능. self-managed base URL은 `host_permissions`에 없으므로, PAT 연결 시 `chrome.permissions.request({ origins: [`${baseUrl}/*`] })`로 런타임 획득 후 검증한다. 이 메커니즘은 BYOK LLM 프로바이더 연결과 동일(`optional_host_permissions: https://*/*, http://*/*` 재사용). **선행 조건**: 기존 BYOK 권한 요청 헬퍼 위치를 찾아 재사용(중복 구현 금지) — tasks의 Task 0 참조.

### OAuth 흐름 (gitlab.com PKCE, proxy 불필요)

Linear와 동일 구조(`linear-oauth.ts`):
- authorize: `https://gitlab.com/oauth/authorize` (`response_type=code`, `code_challenge` S256, `scope=api`, `state`)
- token: `https://gitlab.com/oauth/token` (`grant_type=authorization_code`, `code_verifier`, `redirect_uri`)
- refresh: 같은 token 엔드포인트 `grant_type=refresh_token` (GitLab은 refresh token 회전 — 응답의 새 refresh_token 저장)
- redirect URI: `chrome.identity.getRedirectURL()`
- client ID: `import.meta.env.VITE_GITLAB_CLIENT_ID`. 누락 시 `isGitlabOAuthConfigured()===false` → OAuth 버튼 숨김. **Linear식 단일 client ID** — public PKCE라 dev/store 공용, `_PROD` 분리·`vite.config.ts` 승격 로직 불필요(GitHub만 vite.config define에 `_PROD` 승격이 있고 Linear엔 없음). gitlab.com OAuth App에 **dev/store 두 extension ID의 redirect URI를 모두 등록**(multi-redirect).

## 인터페이스 설계

### GitLab API 엔드포인트 매핑 (`gitlab-api.ts`)

base = `${auth.baseUrl}/api/v4`, 헤더 `Authorization: Bearer ${token|pat}` (PAT도 `Bearer` 또는 `PRIVATE-TOKEN` 헤더 — PAT는 `Authorization: Bearer <pat>` 동작).

```typescript
getMyself(auth): GitlabMyself
  → GET /user  → { id, username, name, email, avatar_url }

searchProjects(auth, query): GitlabProject[]
  → GET /projects?membership=true&search=<q>&order_by=last_activity_at&per_page=30&min_access_level=20
  → 빈 쿼리: search 생략(최근 활동순)
  → normalize: { id, pathWithNamespace, name, nameWithNamespace, webUrl }

getProjectLabels(auth, projectId): GitlabLabel[]
  → GET /projects/:id/labels?per_page=100  → { id, name, color, description }

getProjectMembers(auth, projectId): GitlabMember[]
  → GET /projects/:id/members/all?per_page=100  → { id, username, name, avatar_url }

createIssue(auth, payload): GitlabCreateIssueResult
  → POST /projects/:id/issues
     body: { title, description, labels: labels.join(","), assignee_ids: number[] }
  → { iid, id, web_url }

uploadFile(auth, projectId, filename, blob): { markdown, url }
  → POST /projects/:id/uploads  (FormData: file)
  → { markdown, url, alt }

getIssueStatus(auth, projectId, iid): GitlabIssueStatus
  → GET /projects/:id/issues/:iid
  → { iid, title, state: "opened"|"closed", web_url, labels: string[] }

updateIssueState(auth, projectId, iid, state): GitlabIssueStatus
  → PUT /projects/:id/issues/:iid  { state_event: "close" | "reopen" }
```

### 타입 (`src/types/gitlab.ts`)

```typescript
export interface GitlabDefaults {
  projectId?: number;
  projectPath?: string;     // pathWithNamespace (표시·복원용)
  label?: string;
  assignee?: string;        // username
}

export interface GitlabAccount extends PlatformAccountBase<"gitlab"> {
  auth: GitlabAuth;
  defaults: GitlabDefaults;
}

export interface GitlabProject {
  id: number;
  pathWithNamespace: string;
  name: string;
  nameWithNamespace: string;
  webUrl: string;
}

export interface GitlabLabel { id: number; name: string; color: string; description?: string }
export interface GitlabMember { id: number; username: string; name: string; avatarUrl?: string }

export interface GitlabCreateIssuePayload {
  projectId: number;
  title: string;
  description: string;
  labels?: string[];
  assigneeIds?: number[];
}
export interface GitlabCreateIssueResult { iid: number; id: number; url: string }

export interface GitlabIssueStatus {
  iid: number;
  title: string;
  state: "opened" | "closed";
  webUrl: string;
  labels: string[];
}
```

### 메시지 타입 (`src/types/messages.ts` 추가, github 미러)

```typescript
| { type: "gitlab.oauth.available" }
| { type: "gitlab.startOAuth" }
| { type: "gitlab.testPat"; pat: string; baseUrl: string }
| { type: "gitlab.disconnect" }
| { type: "gitlab.getMyself" }
| { type: "gitlab.searchProjects"; query: string }
| { type: "gitlab.getLabels"; projectId: number }
| { type: "gitlab.searchAssignees"; projectId: number }
| { type: "gitlab.uploadFiles"; projectId: number;
    files: Array<{ filename: string; contentType: string; dataUrl: string }> }
| { type: "gitlab.submitIssue"; payload: GitlabCreateIssuePayload }
| { type: "gitlab.getIssueStatus"; projectId: number; iid: number }
| { type: "gitlab.updateIssueState"; projectId: number; iid: number;
    state: "opened" | "closed" }
```

> `gitlab.testPat`만 `baseUrl`을 별도로 받는다 — 연결 전이라 저장된 auth가 없기 때문. 검증 성공 후 `baseUrl`을 auth에 박아 저장. 나머지 메시지는 `loadGitlabAuth()`가 읽은 auth의 baseUrl을 쓴다.

## 데이터 흐름 — 토큰 갱신

GitHub/Linear와 동일한 refresh hook 패턴: `gitlab-api.ts`가 `setGitlabRefreshHook` export, `gitlab-oauth.ts`가 모듈 로드 시 `refreshOnceWithLock` 주입. `ensureFresh`(만료 60s 전 선제 갱신) + 401 시 1회 재시도. PAT는 갱신 없음.

## 기존 패턴 준수

- **세션/영속화**: `chrome.storage.local`의 `bugshot-settings` envelope, zustand persist. `settings-store.ts` 버전 7로 bump(새 필드 전부 optional → 데이터 마이그레이션 불필요, 마커만).
- **메시지 비동기 응답**: `sendBg<T>` + bg `handleMessage` switch의 exhaustive `never` 체크 → gitlab case 누락 시 컴파일 에러로 강제.
- **i18n 동시 갱신**: `integrations.ts`에 `gitlab.*` 키를 ko/en 양쪽 추가. PostToolUse 훅이 대칭 검사.
- **아이콘**: `SiGitlab` from `@icons-pack/react-simple-icons`, `color="default"`. GitLab 마크는 컬러(주황) — `dark:invert` 불필요(GitHub/Notion만 invert).
- **콤보박스 디바운스/req-id 패턴**: `RepoCombobox`의 250ms 디바운스 + `reqIdRef` 경쟁 가드 그대로 미러.
- **Label/Assignee 게이트**: 기존 GitHub `LabelCombobox`/`AssigneeCombobox`는 trigger를 `disabled`로 막지 **않고**, `ready = !!project`로 *fetch만* 게이트한다(미선택 시 CommandEmpty). GitLab도 동일하게 **fetch 게이트(트리거 비활성화 아님)**. "project 선택 후 활성"이라는 표현은 trigger disable이 아니라 fetch 게이트를 뜻한다.
- **연동 탭 리디자인 패턴 준수**: connect 폼은 `GitlabConnectedBody`(연결 카드+설정) + `GitlabConnectFlow`(행 버튼+연결 로직) 2개 export로 분리(다른 4개 폼 미러). `GitlabConnectFlow`는 `integrationsTabUtils.ts`의 `ConnectFlowProps {connected, onConnected}` 시그니처를 따르고, 연결 성공 시 `onConnected()`로 "내 연동" 탭 전환. OAuth/PAT 선택은 신규 공용 `ConnectMethodDialog` 재사용 — OAuth 가능하면(=`VITE_GITLAB_CLIENT_ID` 설정) `ConnectMethodDialog`로 OAuth/토큰 선택, 미설정 시 `connectMethods(false)===["token"]`라 컨펌 생략하고 PAT 다이얼로그 직행(리디자인 단일수단 패턴). gitlab은 OAuth=gitlab.com 전용, 토큰=Instance URL 포함이라 self-managed는 항상 토큰 경로.
- **버튼 사이즈**: CTA `default`(h-9). IconButton 패널 헤더 `h-8 w-8`.
- **PAT 다이얼로그(2필드)**: GitHub PatDialog는 단일 필드라 Instance URL 추가 시 레이아웃 선례가 부족. **Jira connect 폼의 PAT 다이얼로그(`jira-baseUrl`+email+token 3필드, `https://your-workspace.atlassian.net` 긴 URL placeholder)를 레이아웃 선례로 미러** — 같은 `w-[80vw]` 폭에서 baseUrl 필드를 이미 운용 중.
- **"토큰 받기" 링크 안전 처리**: `${instanceUrl}/-/user_settings/personal_access_tokens` 동적 생성 시, 입력 중 부분 문자열(`gitlab.exa`)이면 깨진 href가 됨. **trim + `new URL` 검증해 유효 origin일 때만 링크 활성화, 빈/무효 값이면 `https://gitlab.com/...`로 폴백.**
- **base URL 정규화는 순수 함수로 분리**: `normalizeInstanceUrl(input)` — trailing slash 제거 + 빈 값→`https://gitlab.com` + 스킴 없는 입력(`gitlab.example.com`) 처리(또는 reject). `new URL` throw를 connect 폼이 잡도록. **단위 테스트 대상**(자동화). `requestHostPermission`(`ai-provider.ts:383`)이 `new URL(baseUrl)` 기반 origin을 만들므로 정규화 후 전달.
- **테스트 우선**: `gitlab-api.ts`의 순수 함수(`normalizeProject`, `mapCreateIssueBody`, `messageForGitlabStatus`, `buildAuthHeader`, `normalizeIssueStatus`)와 `gitlab-oauth.ts`의 `parseGitlabCallbackParams`/`isGitlabOAuthConfigured`, connect 폼의 `normalizeInstanceUrl` 테스트 선작성.

## 대안 검토

1. **self-managed를 별도 플랫폼(`gitlab-self`)으로 분리** — 기각. API·UI·어댑터가 100% 동일하고 base URL만 다르다. 슬라이스를 둘로 쪼개면 모든 exhaustive switch에 분기 2개가 생기고 i18n·테스트가 중복된다. base URL 가변 하나로 흡수하는 게 단순.
2. **공유 `PlatformAdapter` 인터페이스 추출 후 GitLab부터 적용** — 기각. 기존 4개 플랫폼은 의도적으로 공유 인터페이스 없이 수직 슬라이스로 구현돼 있다(Explore 확인). GitLab만 새 추상화를 도입하면 컨벤션 불일치 + 요청 범위 초과. 기존 패턴 미러가 원칙.
3. **첨부를 GitHub처럼 page injection으로** — 기각. GitLab은 `/uploads` REST 한 방이면 되므로 `world:"MAIN"` 주입·직렬화 제약이 전혀 필요 없다. 더 단순한 길을 택한다.
4. **self-managed OAuth(커스텀 client ID 입력)** — 기각(PRD 비목표). connect 폼·authorize URL·저장 구조 복잡도 대비 수요 낮음. PAT로 충분.

## 위험 요소

- **self-managed 런타임 권한**: `https://*/*`·`http://*/*` optional 권한을 GitLab이 *새 목적*으로 재사용 → manifest diff가 작아도 **privacy.md 갱신 필수**(30s Replay가 같은 이유로 심사 탈락한 전례). docs 신선도 검사 트리거.
- **PAT 인증 헤더**: GitLab PAT는 `Authorization: Bearer <pat>`와 `PRIVATE-TOKEN: <pat>` 둘 다 허용. OAuth와 통일하려 `Bearer` 사용 — 단, 일부 구버전 self-managed에서 동작 차이 가능성. 테스트 시 확인.
- **project id vs iid**: GitLab API는 프로젝트 **id**(글로벌)로 경로를 만들고, 이슈는 **iid**(프로젝트 내부 번호)로 표시·조회한다. 둘을 혼동하면 404. `IssueRecord`에 `gitlabProjectId`+`gitlabIssueIid` 둘 다 저장.
- **min_access_level**: 이슈 생성 권한이 없는 프로젝트가 검색에 섞이면 제출 시 403. `min_access_level=20`(Reporter)로 1차 필터하되, 그래도 권한 부족 가능 → 403 에러 메시지 안내.
- **OAuth scope**: gitlab.com OAuth App을 `api` scope로 등록해야 이슈 생성+업로드 가능. client ID 발급 시 scope 설정 필요(선행 조건).
- **exhaustive switch 누락 — `tsc` 사각지대 수동 점검 리스트**: `never` 체크가 잡는 곳은 messages 핸들러 switch(`messages.ts:321-322`)뿐. 아래 **if/else·삼항·런타임 Set은 컴파일러가 못 잡으므로 gitlab 분기 누락 시 조용히 오동작**한다. 각각을 구현·검증 체크리스트의 개별 항목으로 둔다:
  - `src/background/index.ts` `BG_REQUEST_TYPES` Set → 누락 시 **모든 gitlab 메시지 무시**(가장 심각)
  - `getOAuthErrorPlatform`(`messages.ts:203`, `||` 체인) → 누락 시 OAuth 만료가 `null` 반환 → 재연결 안내 미발화. **단위 테스트 1줄**로 확인(`gitlab` BgError→반환=`gitlab`)
  - `issueListUtils.isRefreshable`(else→false) → 누락 시 **상태 배지 갱신 안 됨**(refresh 비활성)
  - `SubmitFieldsDialog`의 `platformConfigured`/`canSubmit` 중첩 삼항(else→notion) → 누락 시 **gitlab이 notion 분기로 오라우팅**
  - `PlatformChip`(else→github) → 누락 시 **GitLab 이슈가 GitHub 칩으로 오표시**
