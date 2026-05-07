# Platform Integrations — Linear 2차 (기술 설계)

## 개요

세 번째 플랫폼 어댑터. GitHub과 구조는 동일하되 두 가지가 다르다: (1) PKCE OAuth로 proxy 의존 제거, (2) REST 대신 GraphQL(단일 endpoint `https://api.linear.app/graphql`). 스토어는 `PlatformId` union 확장 + `Accounts.linear?` 추가. UI는 SettingsTab·SubmitFieldsDialog에 세 번째 탭 추가.

## 변경 범위

### 신규 파일

- **`src/types/linear.ts`** — Linear 타입 정의.
  ```ts
  export type LinearAuth = LinearApiKeyAuth | LinearOAuthAuth;

  export interface LinearApiKeyAuth {
    kind: "apiKey";
    apiKey: string;
    viewerName: string;
    viewerEmail?: string;
  }

  export interface LinearOAuthAuth {
    kind: "oauth";
    accessToken: string;
    refreshToken: string;
    expiresAt: number;       // 24시간 만료
    scope: string;
    viewerName: string;
    viewerEmail?: string;
    grantedAt: number;
  }

  export interface LinearDefaults {
    teamId?: string;
    teamName?: string;
    projectId?: string;
    projectName?: string;
    labelId?: string;
    assigneeId?: string;
    priority?: number;       // 0=none, 1=urgent, 2=high, 3=medium, 4=low
  }

  export interface LinearAccount extends PlatformAccountBase<"linear"> {
    auth: LinearAuth;
    defaults: LinearDefaults;
    titlePrefix?: string;
  }

  export interface LinearMyself {
    id: string;
    name: string;
    email?: string;
    avatarUrl?: string;
  }

  export interface LinearTeam { id: string; name: string; key: string; }
  export interface LinearProject { id: string; name: string; state: string; }
  export interface LinearLabel { id: string; name: string; color: string; }
  export interface LinearUser { id: string; name: string; email?: string; avatarUrl?: string; }

  export interface LinearCreateIssuePayload {
    teamId: string;
    title: string;
    description: string;     // markdown
    projectId?: string;
    assigneeId?: string;
    labelId?: string;
    priority?: number;
  }

  export interface LinearCreateIssueResult {
    id: string;
    identifier: string;      // "ENG-123"
    url: string;
  }

  export interface LinearIssueStatus {
    identifier: string;
    title: string;
    state: { name: string; type: string };
    url: string;
    labels: { name: string; color: string }[];
  }
  ```

- **`src/background/linear-api.ts`** — GraphQL 래퍼.
  - `LinearError(status, message, body)` 에러 클래스.
  - `buildLinearAuthHeader(auth)`: API Key → `${apiKey}`, OAuth → `Bearer ${accessToken}`.
  - `linearGraphQL<T>(auth, query, variables?)`: POST `https://api.linear.app/graphql`. HTTP 에러와 GraphQL `errors[]` 양쪽 핸들링.
  - `setLinearRefreshHook(hook)` / `ensureFresh(auth)`: github-api.ts의 refresh hook 패턴 동일 복제.
  - 쿼리 함수: `getMyself`, `getTeams`, `getProjects(teamId)`, `getLabels(teamId)`, `getMembers(teamId)`, `createIssue(payload)`, `getIssueStatus(issueId)`.
  - `extractLinearErrors(errors)`: GraphQL errors 배열에서 message 추출.
  - `messageForLinearStatus(status)`: HTTP 상태 코드별 i18n 메시지.

- **`src/background/linear-oauth.ts`** — PKCE OAuth.
  - `LINEAR_CLIENT_ID = import.meta.env.VITE_LINEAR_CLIENT_ID`.
  - `isLinearOAuthConfigured()`: `!!LINEAR_CLIENT_ID` (proxy URL 체크 불필요).
  - `generatePkceChallenge()`: `crypto.getRandomValues(32 bytes)` → base64url → SHA-256 → base64url. `{ codeVerifier, codeChallenge }` 반환.
  - `startLinearOAuth()`: PKCE 파라미터 생성 → `chrome.identity.launchWebAuthFlow` → code 추출 → **직접** `https://api.linear.app/oauth/token`에 POST(`grant_type=authorization_code`, `client_id`, `redirect_uri`, `code`, `code_verifier`) → `getMyself(auth)` → `LinearOAuthAuth` 반환.
  - `refreshLinearToken(auth)`: **직접** `https://api.linear.app/oauth/token`에 POST(`grant_type=refresh_token`, `client_id`, `refresh_token`).
  - `persistLinearOAuthTokens(refreshed)` → `writeStoredLinearOAuthTokens`.
  - `refreshOnceWithLock` + 모듈 로드 시 `setLinearRefreshHook(refreshOnceWithLock)` 사이드 이펙트.
  - `parseLinearCallbackParams(redirectUrl, expectedState)`: 순수 헬퍼.

- **`src/sidepanel/tabs/connect/LinearConnectForm.tsx`** — Settings sub-tab.
  - GithubConnectForm.tsx와 동일 구조.
  - 온보딩: `SiLinear` 아이콘 + "Linear로 로그인" OAuth 버튼 + "API Key" 버튼.
  - 연결됨: 뷰어 카드(name, email, OAuth/API Key 배지) + 기본 Team/Project 선택 + title prefix + Disconnect.

- **`src/sidepanel/tabs/linearFields/LinearIssueFields.tsx`** — 등록 다이얼로그 필드 컨테이너.
  - `LinearIssueFieldsValue`: `{ teamId?, teamName?, projectId?, projectName?, labelId?: string, assigneeId?, assigneeName?, priority?: number }`.
  - `initialLinearFields(last, defaults)`: `initialGhFields`와 동일한 merge 로직.
  - 렌더: TeamCombobox(필수) → ProjectCombobox → LabelCombobox → AssigneeCombobox → PrioritySelect.

- **`src/sidepanel/tabs/linearFields/TeamCombobox.tsx`** — Team 셀렉터.
  - `linear.getTeams` 메시지로 목록 조회. `team.key` + `team.name` 표시.
  - RepoCombobox.tsx 패턴 복제.

- **`src/sidepanel/tabs/linearFields/ProjectCombobox.tsx`** — Project 셀렉터.
  - `teamId` 스코프. team 변경 시 리셋.
  - `linear.getProjects` 메시지 호출.

- **`src/sidepanel/tabs/linearFields/LabelCombobox.tsx`** — Label 단일 선택.
  - `teamId` 스코프. GitHub `LabelCombobox`와 동일 패턴.
  - `linear.getLabels` 메시지 호출.

- **`src/sidepanel/tabs/linearFields/AssigneeCombobox.tsx`** — Assignee 단일 선택.
  - Linear 이슈는 assignee 1명. GitHub의 multi와 달리 single-select Combobox.
  - `teamId` 스코프. `linear.getMembers` 메시지 호출.

- **`src/sidepanel/tabs/linearFields/PrioritySelect.tsx`** — Priority 드롭다운.
  - 정적 옵션: None(0), Urgent(1), High(2), Medium(3), Low(4).
  - shadcn `Select` 컴포넌트 사용(설치 불필요).

- **`src/sidepanel/lib/submitToLinear.ts`** — 등록 오케스트레이터.
  - `submitToLinear(input): Promise<NormalizedSubmitResult>`. body 빌드 → `linear.submitIssue` 메시지 → `{ key: identifier, url }` 반환.

- **`src/sidepanel/lib/buildLinearIssueBody.ts`** — 본문 빌더.
  - `MarkdownContext` 입력. `buildGithubIssueBody`와 동일 구조.
  - `## Attachments` 섹션에 파일명 나열 + `linear.attachmentNotInline` i18n 안내.
  - base64 인라인 시도 없음(Linear description은 마크다운 전용, HTML 태그 미지원).

### 변경 파일

- **`src/types/platform.ts`**:
  - `PlatformId = "jira" | "github" | "linear"`.
  - `Accounts.linear?: LinearAccount` 추가.
  - `LinearLastSubmitFields` 인터페이스 추가.
  - `LastSubmitFieldsByPlatform.linear?` 추가.

- **`src/types/messages.ts`**:
  - Linear 타입 re-export 추가.
  - `BgRequest` union에 `linear.*` 11개 멤버 추가: `linear.oauth.available`, `linear.startOAuth`, `linear.testApiKey`, `linear.disconnect`, `linear.getMyself`, `linear.getTeams`, `linear.getProjects`, `linear.getLabels`, `linear.getMembers`, `linear.submitIssue`, `linear.getIssueStatus`.
  - `getOAuthErrorPlatform`: `"linear"` 인식 추가.

- **`src/store/settings-store.ts`**:
  - `SETTINGS_STORE_VERSION` 3 → 4.
  - `updateLinearAccount(patch)` 액션 추가 (`updateGithubAccount`와 동일).
  - `pickInitialPlatform` fallback 순서에 `"linear"` 추가.
  - v3→v4 마이그레이션: 멱등 가드. `accounts` 딕트가 이미 있으면 그대로 통과(데이터 변환 없음, 타입 확장만).

- **`src/store/issues-store.ts`**:
  - `IssueRecord`에 `linearIdentifier?: string`, `linearTeamKey?: string`, `linearLabelName?: string` optional 필드 추가. 버전 증가 불필요(additive optional).

- **`src/lib/settings-storage.ts`**:
  - `readStoredLinearAuth()` + `writeStoredLinearOAuthTokens()` 추가.

- **`src/background/messages.ts`**:
  - `linear-api` 함수 import + `linear-oauth` 모듈 import(사이드 이펙트 hook 등록).
  - `loadLinearAuth()` 헬퍼 추가.
  - `handleMessage` exhaustive switch에 `linear.*` 11개 case 추가.

- **`src/background/index.ts`**:
  - `LinearError`를 에러 직렬화 블록에 추가.
  - `BG_REQUEST_TYPES` 셋에 `linear.*` 타입 추가.

- **`src/sidepanel/tabs/SettingsTab.tsx`**:
  - `grid-cols-2` → `grid-cols-3`. `SiLinear` import.
  - `<TabsTrigger value="linear">` + `<TabsContent value="linear">` → `<LinearConnectForm />`.
  - `PlatformSubTab` 타입에 `"linear"` 추가.

- **`src/sidepanel/tabs/IssueCreateModal.tsx`**:
  - `SubmitFieldsDialogProps`에 `linearFields`, `setLinearFields` 추가.
  - `SubmitFieldsDialog` 내부:
    - `TabsList` `grid-cols-2` → `availablePlatforms.length === 3 ? "grid-cols-3" : "grid-cols-2"` 동적 전환.
    - `<TabsTrigger value="linear">` + `SiLinear` 추가.
    - `platformConfigured` ternary → `"linear"` 분기 추가(`!!linearAccount`).
    - `canSubmit` 조건: `"linear"` → `!!linearFields.teamId`.
    - 필드 렌더: `platform === "linear"` → `<LinearIssueFields />`.
  - `IssueCreateModal` 본체: `linearFields` 상태 + `handleLinearSubmit` + submit 라우팅.

- **`src/sidepanel/tabs/DraftDetailDialog.tsx`**:
  - IssueCreateModal과 동일한 linear 필드·핸들러·라우팅 추가.

- **`src/sidepanel/tabs/IssueListTab.tsx`**:
  - `PlatformChip`에 `"linear"` + `SiLinear` 아이콘.
  - `SubmittedBadge`에 `"linear"` case: `linear.getIssueStatus` 호출. state type별 색상(backlog/unstarted=default, started=blue, completed=green, cancelled=gray).
  - 카드 메타: `linearTeamKey` + `identifier` + label name 표시.

- **`src/sidepanel/App.tsx`**:
  - `oauthExpiredPlatform` 레이블 해소에 `"linear"` 추가.

- **`manifest.config.ts`**:
  - `host_permissions`에 `"https://api.linear.app/*"` 추가. `https://linear.app/*`는 불필요(`launchWebAuthFlow`가 authorize URL 처리).

- **`src/i18n/{ko,en}.ts`**:
  - `platform.tab.linear` 키.
  - `linear.*` namespace 전체: 연결(onboarding, oauthLogin, apiKeyDialog 등), 필드(team, project, labels, assignee, priority + placeholder/empty), 섹션(connection, team, issueSettings), 에러(401/403/404/429/5xx/generic/graphql), OAuth(notConfigured), 기타(viewerLogin, attachmentNotInline, field.requireTeam), 이슈 목록 상태(backlog/unstarted/started/completed/cancelled).

## 데이터 흐름

### OAuth 연결 (PKCE — Proxy 불필요)

```
[LinearConnectForm] "Linear로 로그인"
  → bg "linear.startOAuth"
  → background.startLinearOAuth():
    1. code_verifier 생성 (32 random bytes → base64url)
    2. code_challenge = SHA-256(code_verifier) → base64url
    3. chrome.identity.launchWebAuthFlow({
         url: https://linear.app/oauth/authorize?client_id=...&redirect_uri=<ext callback>
              &response_type=code&scope=read,write,issues:create
              &state=<csrf>&code_challenge=<challenge>&code_challenge_method=S256
       })
    4. 콜백에서 ?code= 추출, state 검증
    5. fetch("https://api.linear.app/oauth/token", {   ← 직접! proxy 없음
         grant_type: "authorization_code",
         client_id: LINEAR_CLIENT_ID,
         redirect_uri: ...,
         code: ...,
         code_verifier: ...
       })
       → { access_token, token_type, expires_in, refresh_token, scope }
    6. getMyself(auth) → viewer name/email
    7. settings-store.setAccount("linear", { auth, defaults: {} })
```

### API Key 연결

```
[LinearConnectForm] API Key 입력 → bg "linear.testApiKey"
  → getMyself({ kind: "apiKey", apiKey })
  → settings-store.setAccount("linear", { auth: { kind: "apiKey", apiKey, viewerName } })
```

### 토큰 갱신 (직접, Proxy 불필요)

```
linear-api.ts: 401 수신 또는 expiresAt 60초 내
  → linearRefreshHook(auth)
  → fetch("https://api.linear.app/oauth/token", {   ← 직접!
       grant_type: "refresh_token",
       client_id: LINEAR_CLIENT_ID,
       refresh_token: auth.refreshToken
     })
  → writeStoredLinearOAuthTokens로 영속화
  → 원래 요청 재시도
```

### 이슈 등록

```
IssueCreateModal:
  PlatformPicker → "linear" 선택
  → Team combobox: bg "linear.getTeams" → 목록
  → Project combobox: bg "linear.getProjects" { teamId } → 목록
  → Label: bg "linear.getLabels" { teamId } → 목록
  → Assignee: bg "linear.getMembers" { teamId } → 목록
  → Priority: 정적 드롭다운 0-4
  → 등록: bg "linear.submitIssue" {
       teamId, title, description: buildLinearIssueBody(ctx), projectId?, assigneeId?, labelId?, priority?
     }
  → 응답: { id, identifier: "ENG-123", url: "https://linear.app/..." }
  → markSubmitted + setLastSubmitFields("linear") + setLastSubmittedPlatform("linear")
```

## GraphQL vs REST

코드베이스 최초의 GraphQL 어댑터. REST 패턴과의 차이:

| 관점 | GitHub/Jira (REST) | Linear (GraphQL) |
|---|---|---|
| 엔드포인트 | 경로별 GET/POST/PUT | 단일 `https://api.linear.app/graphql` POST |
| 에러 | HTTP status로 판별 | HTTP 200 + `{ errors: [...] }` 가능 → 양쪽 체크 |
| 요청 구성 | URL path + query params | `{ query, variables }` JSON body |
| 응답 파싱 | `res.json()` 직접 | `res.json().data` 언래핑 |

`linearGraphQL<T>()` 함수가 이 차이를 캡슐화:
```ts
async function linearGraphQL<T>(
  auth: LinearAuth,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await authedFetch(auth, "https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new LinearError(res.status, ...);
  const json = await res.json();
  if (json.errors?.length) throw new LinearError(200, extractLinearErrors(json.errors), json.errors);
  return json.data as T;
}
```

## PKCE 단순화

| 관점 | GitHub/Jira | Linear |
|---|---|---|
| 토큰 교환 | oauth-proxy 경유 (`client_secret` 필요) | extension에서 직접 (`code_verifier`로 증명) |
| proxy 배포 | 필수 | 불필요 |
| 환경 변수 | `VITE_*_CLIENT_ID` + `VITE_OAUTH_PROXY_URL` | `VITE_LINEAR_CLIENT_ID`만 |
| dev/prod 분리 | 필요 (GitHub은 callback URL 1개 제한) | 불필요 (같은 OAuth App, secret 보호 불필요) |

## SettingsTab 3-column 레이아웃

3개 플랫폼으로 `TabsList` `grid-cols-2` → `grid-cols-3`. 각 trigger는 아이콘(14px) + 라벨. 사이드패널 폭(~360px)에서 trigger당 ~100px이면 충분. `SiJirasoftware`, `SiGithub`, `SiLinear` 아이콘 모두 `h-3.5 w-3.5`.

## SubmitFieldsDialog 동적 탭

`availablePlatforms.length`에 따라 `grid-cols-N` 동적 적용. Tailwind 정적 클래스 요구사항 때문에 조건부:
```ts
availablePlatforms.length === 3 ? "grid-cols-3" : "grid-cols-2"
```

## 기존 패턴 준수

- **discriminated union auth**: `LinearAuth = LinearApiKeyAuth | LinearOAuthAuth`, `kind` 판별자. `GithubAuth`/`JiraAuth`와 동일.
- **메시지 namespace**: `linear.*` 11개. exhaustive switch.
- **에러 클래스**: `LinearError(status, message, body)` — `GithubError`/`JiraError`와 동일.
- **OAuth 에러**: `OAuthError({ platform: "linear" })`. `getOAuthErrorPlatform`에 `"linear"` 추가.
- **refresh hook 주입**: 모듈 로드 시 `setLinearRefreshHook(refreshOnceWithLock)` 사이드 이펙트.
- **스토어 마이그레이션**: 멱등 가드, 버전 증가, `migrate` 콜백 패턴 동일.
- **settings storage**: `readStoredLinearAuth` / `writeStoredLinearOAuthTokens` — GitHub 패턴 복제.
- **submit 결과**: `NormalizedSubmitResult { key: "ENG-123", url }`.
- **body 빌더**: `buildLinearIssueBody` — `MarkdownContext` 소비, `buildGithubIssueBody`와 동일 구조.
- **i18n**: ko/en 동시 갱신. `locales.test.ts` 키 패리티.
- **테스트 배치**: `__tests__/*.test.ts` 소스와 동일 디렉터리.
- **UI 컨벤션**: shadcn 컴포넌트만, CTA `h-9`, icon button `h-8 w-8`, `data-[state=inactive]:hidden`.

## 대안 검토

**대안 A — @linear/sdk 사용**: 공식 TypeScript SDK가 있으나 100KB+ 번들 증가. 프로젝트는 raw fetch 래퍼 패턴(`github-api.ts`, `jira-api.ts`)을 따르고 있으므로 인라인 GraphQL 쿼리로 자기충족 어댑터를 유지.

**대안 B — proxy 경유 OAuth**: 기존 proxy 확장 가능하나 PKCE가 지원되므로 불필요한 인프라 의존. proxy 배포 없이 동작하는 것이 명백한 이점.

**대안 C — Assignee multi-select**: Linear 이슈는 assignee 1명만 지원. GitHub의 multi-select와 달리 single-select Combobox가 올바른 UX. 패턴 약간 다르지만 플랫폼 모델에 충실.

**대안 D — Priority 필드 생략**: 선택 사항이라 제외 가능하지만, 4개 정적 옵션이라 구현 비용 최소. 이슈 품질 향상. 포함.

## 위험 요소

1. **GraphQL 에러 핸들링**: HTTP 200 + `{ errors: [...] }` 반환 가능. 어댑터가 HTTP status와 response body 양쪽을 체크해야 한다. 테스트로 두 경로 모두 커버.
2. **PKCE 브라우저 지원**: `crypto.subtle.digest("SHA-256", ...)` 필요. Chromium 116+(manifest `minimum_chrome_version`)에서 모두 지원.
3. **Linear OAuth App 등록**: Linear workspace 관리자가 `https://linear.app/settings/api/applications/new`에서 생성. callback URL은 `chrome.identity.getRedirectURL()`과 정확히 일치해야 함 (`https://<extension-id>.chromiumapp.org/`).
4. **manifest host_permissions 추가**: `https://api.linear.app/*` 추가 시 Chrome 웹스토어 업데이트에서 권한 재승인 다이얼로그. 릴리스 노트로 안내.
5. **토큰 24시간 만료**: GitHub(만료 없음 가능)보다 짧음. refresh flow 필수. Linear은 항상 refresh token을 발급하므로 GitHub처럼 "refresh 불가" 분기는 없음.
6. **3-platform UI 밀도**: 360px 사이드패널에 3-tab + 플랫폼별 필드. 활성 탭 필드만 렌더되므로 수직 공간은 관리됨. 수평 TabsList가 주요 관심 — 수동 검증 필요.
7. **settings-store v4**: 순수 additive 마이그레이션(데이터 변환 없음). 멱등 가드로 안전.
