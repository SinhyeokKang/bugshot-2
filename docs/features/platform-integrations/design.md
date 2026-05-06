# Platform Integrations — GitHub 1차 (기술 설계)

## 개요

플랫폼별 어댑터 패턴 도입. 백그라운드에 `github-api.ts`를 jira-api.ts와 같은 모양(`githubFetch` + 토큰 갱신 + namespaced 메시지 핸들러)으로 추가. 기존 oauth-proxy(`oauth-proxy/`)에 GitHub `/token` 교환 엔드포인트를 추가해 client_secret을 Worker에 보관. 스토어는 단일 `jiraConfig` → `accounts: { jira?, github? }` 구조로 마이그레이션(v3). UI는 SettingsTab 명칭을 "연동 설정"으로 바꾸고 그 안에 플랫폼 sub-tab을 두며, IssueCreateModal에 PlatformPicker를 더한다. 이슈 본문은 Jira만 ADF, GitHub은 기존 `buildIssueMarkdown`을 베이스로 image placeholder를 base64 또는 안내 푸터로 치환.

## 변경 범위

### 신규 파일

- `src/types/platform.ts` — `PlatformId = "jira" | "github"`(앞으로 union 확장될 것), `Accounts`(키 기반 dict) 타입.
- `src/types/github.ts` — `GithubAuth`(`{ kind: "oauth"; ... } | { kind: "pat"; ... }`), `GithubRepo`/`GithubLabel`/`GithubUser`/`GithubCreateIssuePayload`/`GithubCreateIssueResult`, `GithubMyself`.
- `src/background/github-api.ts` — `githubFetch<T>(auth, path, init)` REST 래퍼. `getMyself`, `searchRepos(query)`, `getRepoLabels(owner,repo)`, `getRepoAssignees(owner,repo)`, `createIssue(payload)`. PAT은 `Authorization: token <pat>`, OAuth는 `Authorization: Bearer <accessToken>`. 401 시 OAuth 한정 refresh 1회 시도(jira-api.ts의 `authedFetch`와 동일 골격) — 단, GitHub OAuth Apps의 access token은 refresh token이 default scope에서는 발급되지 않음. `expires_in` + `refresh_token`을 받으려면 OAuth App 설정에서 "Token expiration" 활성화 필요(주석으로 명시). 만료 없는 토큰이면 refresh 분기는 dead path가 되며 401 → 즉시 재인증 안내.
- `src/background/github-oauth.ts` — Web Flow 헬퍼. `startGithubOAuth()`(`chrome.identity.launchWebAuthFlow` → authorize URL → code 수신 → proxy `/github/token` 교환 → `getMyself`로 viewer 확정 → `GithubOAuthAuth` 반환). `refreshGithubToken()`(token expiration 활성화된 경우만 동작). Atlassian용 `oauth.ts`는 손대지 않고, 공용 패턴(parse code, error class)만 별도 헬퍼로 두지 말고 인라인 — 1차에선 두 플랫폼만이라 추상 base 도입은 과함.
- `src/sidepanel/lib/buildGithubIssueBody.ts` — `buildIssueMarkdown`을 호출해 베이스 텍스트를 받고, 미디어 placeholder를 base64 인라인 또는 안내 푸터로 치환. base64 캡 헬퍼 `tryInlineImage(blob, remainingBudget): string | null` 포함.
- `src/sidepanel/tabs/connect/{JiraConnectForm,GithubConnectForm}.tsx` — 기존 SettingsTab의 Jira 인증 UI를 `JiraConnectForm`으로 외과적 추출(behaviour 동일). `GithubConnectForm`은 OAuth 버튼 + PAT 섹션을 같은 카드 안에 배치.
- `src/sidepanel/tabs/PlatformPicker.tsx` — 등록 다이얼로그 상단 칩 셀렉터(연결된 플랫폼만 노출).
- `src/sidepanel/tabs/githubFields/{RepoCombobox,LabelMultiSelect,AssigneeMultiSelect}.tsx` — GitHub 메타 필드 컴포넌트. 기존 `ProjectCombobox`/`UserCombobox` 패턴 복제.
- `oauth-proxy/src/github.ts` (또는 기존 worker entry 안에 GitHub 라우트 추가) — `POST /github/token` (code → access_token 교환), `POST /github/refresh` (refresh_token → access_token; token expiration 활성 시).

### 변경 파일

- `src/store/settings-store.ts` — `jiraConfig: JiraConfig | null` → `accounts: { jira?: JiraAccount; github?: GithubAccount }`. `lastSubmitFields` → `Record<PlatformId, LastSubmitFields>`(플랫폼별로 마지막 입력 분리). v2→v3 마이그레이션: 기존 jiraConfig가 있으면 `accounts.jira`로 이동, `lastSubmitFields`는 `{ jira: <기존값> }`으로. 멱등 가드 + sparse 저장(이미 v3면 그대로 통과).
- `src/store/issues-store.ts` — issue entry에 `platform: PlatformId` + `accountKey`(현재는 platform과 1:1) + `url` 필드. 기존 entry는 `platform: "jira"`로 마이그레이션(v3 또는 그 다음 버전, 기존 v 카운트와 충돌 없게).
- `src/background/messages.ts` + `src/background/index.ts` — 신규 디스패치: `github.startOAuth`, `github.testPat`, `github.getMyself`, `github.searchRepos`, `github.getLabels`, `github.searchAssignees`, `github.submitIssue`. 기존 `jira.*` 핸들러는 손대지 않음.
- `src/sidepanel/tabs/SettingsTab.tsx` — 명칭/i18n 변경 + 내부에 shadcn `Tabs` 추가. 컨텐츠를 두 sub-tab으로 분기. 추출된 connect 폼만 호출.
- `src/sidepanel/tabs/IssueCreateModal.tsx`, `DraftDetailDialog.tsx` — PlatformPicker 추가. 선택된 플랫폼 키에 따라 메타 필드 컴포넌트(Jira는 기존 그대로, GitHub는 신규 `githubFields/*`) 동적 렌더. submit 시점에 `<platform>.submitIssue` 메시지 호출.
- `src/sidepanel/tabs/IssueListTab.tsx` — entry의 `platform` 키에 따라 아이콘·식별자 표기 분기.
- `manifest.config.ts` — `host_permissions`에 `https://api.github.com/*`, `https://github.com/*`(authorize 페이지) 추가. 기존 proxy origin 추가는 그대로 유지(GitHub 콜백도 같은 proxy origin).
- `src/i18n/{ko,en}.ts` — `platform.connect`/`platform.disconnect`/`platform.error.{401,403,404,429,5xx}` 공용 키, `github.*` 신규 키, 기존 `settings.title`을 "연동 설정"/"Integrations"로 갱신, sub-tab 라벨 키.
- 기존 `src/background/oauth.ts`는 변경 없음(Atlassian 전용). GitHub OAuth는 `github-oauth.ts`로 분리.

## 데이터 흐름

### OAuth 연결

```
[GithubConnectForm] "GitHub로 로그인"
  → bg "github.startOAuth"
  → background.startGithubOAuth():
    1. chrome.identity.launchWebAuthFlow({
         url: https://github.com/login/oauth/authorize?client_id=...&redirect_uri=<extension callback>&scope=repo&state=<csrf>
       })
    2. 콜백에서 ?code= 추출
    3. fetch(VITE_OAUTH_PROXY_URL + "/github/token", { code })
       → proxy가 client_secret 첨부 후 GitHub /login/oauth/access_token POST
       → { access_token, token_type, scope, [refresh_token, expires_in?] }
    4. getMyself(auth) → viewer login
    5. settings-store.setAccount("github", { auth, defaults, viewer })
  ← issue-store에 영향 없음
```

### PAT 연결

```
[GithubConnectForm] PAT 입력 → bg "github.testPat"
  → getMyself({ kind: "pat", pat })
  → settings-store.setAccount("github", { auth: { kind: "pat", pat, viewerLogin } })
```

### 이슈 등록

```
IssueCreateModal:
  PlatformPicker(연결된 키 = ["jira","github"]) → 선택
  → 동적 메타 fetch (bg "github.searchRepos" 등)
  → 등록 → bg "github.submitIssue" { payload: { owner, repo, title, body(=buildGithubIssueBody(ctx)), labels, assignees } }
  → background.createIssue → { url, number }
  → 토스트 + issues-store.addEntry({ platform: "github", url, identifier: `${owner}/${repo}#${number}` })
```

## 인터페이스 설계

```ts
// src/types/platform.ts
export type PlatformId = "jira" | "github"; // 후속 PR에서 "linear" | "notion" 등 확장

export interface PlatformAccountBase<P extends PlatformId> {
  platform: P;
  connectedAt: number;
}

// src/types/github.ts
export type GithubAuth =
  | { kind: "pat"; pat: string; viewerLogin: string }
  | {
      kind: "oauth";
      accessToken: string;
      tokenType: string;          // "bearer"
      scope: string;
      refreshToken?: string;       // GitHub OAuth App의 token expiration 옵션이 켜진 경우만
      expiresAt?: number;          // refreshToken과 짝
      viewerLogin: string;
      grantedAt: number;
    };

export interface GithubDefaults {
  owner?: string;
  repo?: string;
  labels?: string[];
  assignees?: string[];
}

export interface GithubAccount extends PlatformAccountBase<"github"> {
  auth: GithubAuth;
  defaults: GithubDefaults;
}

export interface GithubCreateIssuePayload {
  owner: string;
  repo: string;
  title: string;
  body: string;          // markdown (이미지 base64 인라인 가능)
  labels?: string[];
  assignees?: string[];
}

export interface GithubCreateIssueResult {
  number: number;
  url: string;           // html_url
  nodeId: string;
}

// src/store/settings-store.ts
export interface Accounts {
  jira?: JiraAccount;     // 기존 JiraConfig를 평면화한 형태(아래 "기존 패턴 준수" 참조)
  github?: GithubAccount;
}

export type LastSubmitFieldsByPlatform = {
  jira?: JiraLastSubmitFields;       // 현재 LastSubmitFields가 그대로 들어감
  github?: GithubLastSubmitFields;   // { owner?, repo?, labels?[], assignees?[] }
};

interface SettingsState {
  accounts: Accounts;
  lastSubmitFields: LastSubmitFieldsByPlatform;
  setAccount<P extends PlatformId>(platform: P, account: Accounts[P] | undefined): void;
  // ...
}

// 메시지 (BgRequest 확장)
type GithubStartOAuthReq = { type: "github.startOAuth" };
type GithubTestPatReq = { type: "github.testPat"; pat: string };
type GithubSearchReposReq = { type: "github.searchRepos"; query: string };
type GithubSubmitIssueReq = { type: "github.submitIssue"; payload: GithubCreateIssuePayload };
// ... (메타 fetch 핸들러들)
```

## Base64 인라인 캡 정책

- 이미지 1장당 **raw 64KB** 이하만 인라인 시도(base64 인코딩 후 약 87KB).
- 본문 전체 크기는 GitHub 65,536 바이트 제한이 있으므로 누적 본문 사이즈가 60,000 바이트를 넘기 시작하면 그 시점부터의 이미지는 안내 푸터로 강등.
- 캡 헬퍼는 `src/sidepanel/lib/buildGithubIssueBody.ts`에서 동기 함수로 결정(이미지 blob의 size 속성 기반). `tryInlineImage(blob, remainingBudget): string | null`.
- 안내 푸터 문구는 i18n: `github.attachmentTooLarge`("스크린샷이 너무 커서 본문에 포함할 수 없습니다. 사이드패널에서 다운로드한 뒤 GitHub UI에 직접 첨부하세요.").

## 기존 패턴 준수

- **메시지 비동기 응답**: 새 핸들러도 `return true` + IIFE async (content/picker.ts 패턴).
- **OAuth refresh**: GitHub access token이 만료 활성된 경우 jira-api.ts의 `refreshOnce`/`persistOAuthTokens` 골격을 그대로 따라 `github-oauth.ts`에 별도 구현. 잠금 변수 `githubRefreshInFlight`로 동시 401 race 방지.
- **discriminated union 마이그레이션**: settings-store v2→v3은 기존 v1→v2 패턴(`migrateLegacy`)을 그대로 복제. 멱등 가드 + sparse 저장 필수(CLAUDE.md "마이그레이션 3중 가드" 컨벤션 준수: settings-store, issues-store, useEditorSessionSync에서 같은 패턴).
- **i18n 동시 갱신**: `ko.ts`/`en.ts` 동시 갱신.
- **shadcn 컴포넌트**: 신규 설치 없이 기존 Tabs/Combobox/Command/Popover 재사용. PlatformPicker는 `ToggleGroup` 또는 칩 형태(`Button variant="outline"` 토글). 다중 선택은 `Command` + 체크박스로 구성.
- **스타일링 컨벤션**: 직접 색상 사용 금지, shadcn CSS 변수만. IconButton은 패널 헤더 액션 `h-8 w-8`, Input/Textarea 인접 `h-9 w-9` 룰 준수.
- **세션 격리**: 이슈 작성 다이얼로그의 PlatformPicker 선택값은 zustand 일반 상태(persisted) — 등록 후에도 다음 등록까지 유지(LastSubmitFields의 일부로 함께 저장).
- **OAuth proxy 환경 변수**: 기존 `VITE_OAUTH_PROXY_URL` 그대로 사용. 누락 시 GitHub OAuth 버튼만 비활성화하고 PAT 섹션은 노출(현재 `isOAuthConfigured()` 가드를 플랫폼별로 일반화: `isJiraOAuthConfigured()` / `isGithubOAuthConfigured()`).

## 대안 검토

**대안 A — Device Flow (proxy 불필요)**: GitHub /login/device/code로 직접 폴링. proxy 확장 없이 가능하지만 사용자가 verification URL을 외부 브라우저에서 열고 8자리 코드를 수동 입력해야 함. UX 어색하고 Jira의 Web Flow와 분기 코드 증가. 사용자가 "Jira 인증 플로우 그대로 트윅"을 명시했으므로 Web Flow 채택.

**대안 B — GitHub App**: fine-grained repo permissions, installation 단위. 개인 계정·소규모 팀에는 셋업 부담이 크고 설치 페이지를 거쳐야 함. 1차 스코프에서는 OAuth App만.

**대안 C — 단일 활성(한 플랫폼만 연결)**: 스토어가 단순해지지만 사용자가 명시적으로 다중 활성을 요청. 스토어는 키 기반 dict로 충분히 단순.

**대안 D — 본문 인라인 자동 첨부 우회 (uploads.github.com 비공식 API)**: GitHub 웹 UI가 paste 시 호출하는 비공식 엔드포인트(`https://uploads.github.com/repositories/.../files`). 비공식 + 인증 경로 다르고 UA 검사가 있어 권장 안 됨.

## 위험 요소

- **GitHub OAuth refresh 가용성**: 기본 OAuth App 설정에서는 access token이 만료 없는(non-expiring) 형태로 발급되며 refresh token이 없다. 만료 활성화는 OAuth App 설정에서 "Refresh tokens" 옵션을 켜야 함. design은 두 케이스 모두 지원하지만, 1차 OAuth App을 만들 때 만료 활성화를 켜는 것을 권장(security best practice). PR 시점 기준으로 켜고 진행.
- **proxy 빌드/배포**: oauth-proxy/는 Cloudflare Worker 별도 배포. GitHub 라우트 추가 후 Worker를 다시 publish해야 확장이 동작. tasks의 T4에 명시.
- **manifest host_permissions 추가**: 사용자가 업그레이드 시 권한 재승인 다이얼로그가 뜸(웹스토어 업로드 후). 릴리스 노트로 안내.
- **본문 65KB 제한**: 큰 화면의 스타일 diff 표가 본문 자체를 부풀릴 수 있음. 예산 초과 시 이미지부터 안내 푸터로 강등하고, 그래도 초과하면 styleChanges 표를 잘라내고 "전체는 사이드패널 참조" 안내. 캡 헬퍼는 디테일 조건 분기 포함.
- **base64 sanitize**: GitHub은 본문 마크다운에서 `data:image/...` URL을 일부 허용(렌더 가능). 일부 size/type 조합에서 차단될 수 있음 — webp는 `<img src="data:image/webp;base64,...">`로 감싸 HTML 형태로 두는 편이 안정적인지 수동 검증 필요(T8 검증 항목).
- **issues-store 마이그레이션**: 기존 entry는 jira 키만 가정. `platform` 필드가 없으면 `"jira"`로 채우는 마이그레이션 필요(별도 v 버전 증가).
- **PAT 보안**: chrome.storage.local 평문 저장(현재 Jira PAT 동등). 1차에서는 동일 수준, 후속 보안 강화는 별도 작업.
