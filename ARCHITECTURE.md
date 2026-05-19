# Architecture

bugshot-2의 서브시스템별 설계 상세. 해당 영역을 수정할 때 참고한다.

## Side Panel은 탭 스코프

**활성화한 탭에서만 side panel이 보이고, 탭을 이동하면 자동으로 닫힌다.** 돌아오면 다시 열린다.

구현:
- `chrome.storage.session`의 `sidePanel:activated` 키에 활성화된 tabId 셋을 저장
- `chrome.action.onClicked`에서 해당 탭을 셋에 추가하고 `sidePanel.setOptions({tabId, enabled:true, path:...?tabId=X})` + `sidePanel.open({tabId})`
- `chrome.tabs.onActivated` / `onUpdated`에서 각 탭이 활성화 셋에 있으면 enable, 없으면 disable
- **manifest의 `side_panel.default_path`가 전역 fallback을 제공하므로** `onInstalled`/`onStartup`에서 `chrome.sidePanel.setOptions({ enabled: false })`로 전역 비활성화 필수

## user gesture 보존

`chrome.sidePanel.open()`은 **user gesture 안에서만** 동작한다. `chrome.action.onClicked` 리스너에서:

```ts
// ❌ 잘못된 예: await 때문에 user gesture 소실
chrome.action.onClicked.addListener(async (tab) => {
  await setActivated(tab.id, true);
  await chrome.sidePanel.setOptions(...);
  await chrome.sidePanel.open({ tabId: tab.id }); // silently fails
});

// ✅ 올바른 예: open을 동기적으로 호출
chrome.action.onClicked.addListener((tab) => {
  if (tab.id == null || !isSupportedUrl(tab.url)) return;
  void chrome.sidePanel.setOptions({ tabId: tab.id, path, enabled: true });
  void chrome.sidePanel.open({ tabId: tab.id });
  void setActivated(tab.id, true); // fire-and-forget
});
```

## 편집 세션 영속화

- tabId별로 `chrome.storage.session`의 `editor:${tabId}` 키에 저장
- `useEditorSessionSync(tabId)` 훅이 hydration + debounced save(300ms) 담당 (zustand persist 미들웨어 대신 직접 구현 — tabId-scoped 키가 persist의 "one store, one key" 모델에 맞지 않음)
- origin 변경 시 해당 탭의 세션은 버림 (`clearIfOriginChanged` in `tab-bindings.ts`)
- 탭 닫히면 `onRemoved`에서 정리

## Jira 인증 (OAuth 3LO + API Token)

두 방식을 동시에 지원한다. 저장 형태는 discriminated union (`JiraAuth = JiraApiKeyAuth | JiraOAuthAuth`, `kind` 판별자).

- **API Token**: Basic Auth, `{workspace}.atlassian.net` 직접 호출
- **OAuth 3LO**: `chrome.identity.launchWebAuthFlow` → 인가 코드 → **oauth-proxy**(`/token`)에서 `client_secret`과 교환 → accessible-resources로 사이트 선택 → `api.atlassian.com/ex/jira/{cloudId}/...`로 Bearer 호출

**왜 proxy가 필요한가**: Atlassian `/oauth/token`은 confidential client(`client_secret` 요구)라 확장에 비밀키를 번들할 수 없다. `oauth-proxy/` (Cloudflare Worker)가 `code↔token`·`refresh↔token` 교환만 중계한다.

**토큰 갱신**: `jira-api.ts`가 요청 전 `expiresAt`을 확인해 프리-리프레시, 또는 401 수신 시 자동 `refreshOAuthToken` 후 원 요청 재시도. 새 토큰은 `persistOAuthTokens`가 storage envelope을 찾아 제자리 갱신. refresh token 자체가 무효화되면 `OAuthError` → `sendBg`의 `onOAuthExpired(platform)` 이벤트 → App.tsx AlertDialog로 platform별 재인증 안내 + 연동 탭 이동. `OAuthError`는 `{ platform, cancelled }` 옵션을 받아 BG가 `body.platform` / `body.oauthCancelled` / `body.oauthRefreshFailed` 플래그로 직렬화 → UI는 `isOAuthCancelled` / `getOAuthErrorPlatform` 헬퍼로 분기 (정규식 매칭 금지).

**환경 변수** (빌드 타임):
- `VITE_ATLASSIAN_CLIENT_ID` — OAuth 앱 client_id
- `VITE_OAUTH_PROXY_URL` — Worker origin (예: `https://bugshot-oauth.<subdomain>.workers.dev`)

둘 다 비어있으면 설정 탭은 OAuth 버튼을 비활성화하고 API Token 전용 UI를 노출 (`isOAuthConfigured()` 가드).

**manifest 동적 host_permissions**: `manifest.config.ts`가 `VITE_OAUTH_PROXY_URL`의 origin을 자동으로 `host_permissions`에 추가한다. 빌드 시점에 결정되므로 런타임 권한 요청은 없음.

## GitHub 인증 (OAuth Web Flow + PAT)

Jira와 같은 모양으로 두 방식 동시 지원. 저장 형태는 discriminated union (`GithubAuth = GithubPatAuth | GithubOAuthAuth`).

- **PAT**: `Authorization: token <pat>` 헤더로 `api.github.com` 직접 호출. `repo` scope 필요.
- **OAuth Web Flow**: `chrome.identity.launchWebAuthFlow` → 인가 코드 → **oauth-proxy**(`/github/token`)에서 `client_secret`과 교환 → `Authorization: Bearer <accessToken>`로 호출. `Accept: application/vnd.github+json` + `X-GitHub-Api-Version: 2022-11-28` 헤더 고정. scope: `repo user:email` (email은 viewer 카드 desc 용).
- **dev/prod OAuth App 분리**: GitHub OAuth App은 callback URL을 1개만 등록 가능 → dev key extension ID와 스토어 ID가 달라서 두 App 동시 운영. proxy worker가 클라이언트가 보낸 `client_id`로 `GITHUB_CLIENT_{ID,SECRET}_{DEV,PROD}` 중 매칭되는 secret 선택 (화이트리스트 효과). vite.config.ts에서 `BUGSHOT_STORE_BUILD=1`이면 `VITE_GITHUB_CLIENT_ID_PROD`를 `VITE_GITHUB_CLIENT_ID`로 define-치환.

**토큰 갱신 — refresh hook 주입형**: `github-api.ts`는 `setGithubRefreshHook(hook)`을 export하고, `github-oauth.ts`가 모듈 로드 시 자동 등록(`refreshOnceWithLock`). 401 수신 시 hook이 있으면 1회 refresh 후 재시도. **GitHub OAuth App의 "Token expiration" 옵션이 OFF면 refresh token 자체가 발급되지 않으며**, 이 경우 `refreshGithubToken`은 즉시 `OAuthError(github.refreshUnavailable)` throw → 재인증 안내. PR 시점에 OAuth App을 만들 땐 만료 활성화 권장.

**환경 변수** (빌드 타임):
- `VITE_GITHUB_CLIENT_ID` — OAuth App client_id
- `VITE_OAUTH_PROXY_URL` — Atlassian과 공용 (proxy는 `/token`/`/github/token`/`/github/refresh` 3개 라우트)

`isGithubOAuthConfigured()` false면 IntegrationsTab의 [GitHub] sub-tab은 OAuth 버튼을 비활성화하고 PAT 섹션만 사용 가능.

## Linear 인증 (OAuth PKCE + API Key)

Jira·GitHub과 같은 모양으로 두 방식 동시 지원. 저장 형태는 discriminated union (`LinearAuth = LinearApiKeyAuth | LinearOAuthAuth`).

- **API Key**: `Authorization: <apiKey>` 헤더로 `api.linear.app/graphql` 직접 호출.
- **OAuth PKCE**: `chrome.identity.launchWebAuthFlow` → PKCE code_challenge → 인가 코드 → `api.linear.app/oauth/token`에 직접 교환 (public client — **proxy 불필요**). scope: `read write issues:create`.
- **dev/prod redirect URI**: Linear OAuth App은 redirect URI 다중 등록 가능 → App 1개에 dev/prod URL 둘 다 등록, 단일 `VITE_LINEAR_CLIENT_ID` 사용.

**토큰 갱신 — refresh hook 주입형**: GitHub과 동일 패턴. `linear-api.ts`의 `setLinearRefreshHook(hook)` + `linear-oauth.ts`가 모듈 로드 시 자동 등록. 401 수신 시 1회 refresh 후 재시도.

**GraphQL API**: Linear은 REST가 아닌 `api.linear.app/graphql` 단일 엔드포인트. `linear-api.ts`의 `linearGql<T>(auth, query, variables)` 제네릭 래퍼가 모든 호출을 처리.

**환경 변수** (빌드 타임):
- `VITE_LINEAR_CLIENT_ID` — OAuth App client_id

`isLinearOAuthConfigured()` false면 IntegrationsTab의 [Linear] sub-tab은 OAuth 버튼을 비활성화하고 API Key 섹션만 사용 가능.

## Notion 인증 (OAuth + Internal Integration Token)

Jira·GitHub·Linear와 같은 모양으로 두 방식 동시 지원. 저장 형태는 discriminated union (`NotionAuth = NotionApiKeyAuth | NotionOAuthAuth`).

- **Internal Integration Token**: `Authorization: Bearer <token>` 헤더로 `api.notion.com/v1` 직접 호출. workspace owner가 Notion Settings > Integrations에서 발급. 등록할 페이지/DB에 integration이 connect 되어 있어야 함.
- **OAuth (public integration)**: `chrome.identity.launchWebAuthFlow` → 인가 코드 → **oauth-proxy**(`/notion/token`)에서 `client_id:client_secret` Basic 헤더로 교환 (Notion은 confidential client) → `Authorization: Bearer <accessToken>`로 호출. `Notion-Version: 2022-06-28` 헤더 고정.
- **dev/prod redirect URI**: Notion OAuth App은 redirect URI 다중 등록 가능 → App 1개에 dev/prod URL 둘 다 등록, 단일 `VITE_NOTION_CLIENT_ID` 사용.

**Refresh 없음**: Notion 공개 통합 토큰은 만료되지 않는다(설계상). 따라서 refresh hook 보일러플레이트 없음. 권한 박탈/revoke 시 401 → `OAuthError(t("notion.oauthExpired"))` → 재인증 안내.

**환경 변수** (빌드 타임):
- `VITE_NOTION_CLIENT_ID` — OAuth App client_id
- `VITE_OAUTH_PROXY_URL` — Atlassian·GitHub과 공용 (proxy에 `/notion/token` 라우트 추가)

`isNotionOAuthConfigured()` false면 IntegrationsTab의 [Notion] sub-tab은 OAuth 버튼을 비활성화하고 Internal Token 섹션만 사용 가능.

**페이지 ID 추출**: Notion API의 `createPage` 응답 `url`은 `https://www.notion.so/<workspace>/<title-slug>-<pageIdHex>` 형태. status fetch에 필요한 pageId는 끝의 32자 hex 또는 8-4-4-4-12 UUID. `src/lib/notion-page-id.ts`의 `extractNotionPageId(url)`이 단일 헬퍼 — IssueCreateModal·DraftDetailDialog·IssueListTab.resolveNotionPageId 모두 공유. URL split-pop만 쓰면 slug까지 포함된 garbage가 저장돼 후속 status fetch가 깨지므로 반드시 이 헬퍼 사용.

**상태 색**: `NotionPageStatus.statusOption.color`(green/blue/purple/gray/...)를 `notionStatusCategory(color)`로 시각 카테고리(new/indeterminate/done)로 매핑 → `STATUS_CATEGORY_COLORS` 테이블 공용 사용. green=done, blue·purple=indeterminate, 그 외=new.

**미디어 처리**: image와 video 카테고리는 본문 inline 블록으로 emit (`expandBlock`이 placeholderId → file_upload 변환). log/other 카테고리는 첨부 섹션(heading_2 "첨부") 아래 `file` 블록 — `createPage`의 `nonInline` 필터(`category !== "image" && category !== "video"`)가 분기. element 모드는 표가 아니라 **Before/After heading_3 섹션 분리** — 각 섹션 안에 image 블록 + 해당 시점의 prop 값 bullet list (`prop: asIs` / `prop: toBe`). 이유: Notion 표 셀이 rich_text만 받아 image 블록 인라인 불가능 + 표 외부 둥둥 떠있는 이미지가 어색했음. video 모드는 미디어 섹션 안에 inline. 새 미디어 타입 추가 시: NotionBlock union + expandBlock case + 필요 시 nonInline 필터 갱신.

## 플랫폼 어댑터 패턴 (Jira·GitHub·Linear·Notion 공용 골격)

어댑터 단위로 분리. `PlatformId = "jira" | "github" | "linear" | "notion"` union을 한 곳(`src/types/platform.ts`)에서 관리.

- **저장**: `useSettingsStore`의 `accounts: { jira?: JiraAccount; github?: GithubAccount; linear?: LinearAccount; notion?: NotionAccount }` dict + `lastSubmitFields: Record<PlatformId, ...>` + 전역 `titlePrefix: string`. `setAccount(platform, account)` / `removeAccount(platform)` / `updateJiraAccount(patch)` / `updateGithubAccount(patch)` / `updateLinearAccount(patch)` / `updateNotionAccount(patch)` API.
- **메시지**: bg는 `jira.*` / `github.*` / `linear.*` / `notion.*` 네 namespace로 분기. 새 플랫폼은 새 namespace 추가만. `BgRequest` discriminated union의 exhaustive switch가 누락 검증. 새 메시지 타입은 반드시 `index.ts`의 `BG_REQUEST_TYPES` Set에도 등록해야 디스패치됨.
- **API 어댑터**: `{platform}-api.ts`에 fetch 래퍼 + 에러 클래스 + 순수 mapper export. 401 처리는 jira는 즉시 refresh 호출, github·linear는 hook 주입형(서비스 워커 재시작 후에도 module side-effect로 재등록), notion은 refresh가 없어 즉시 `notion.oauthExpired` throw.
- **이슈 상태 변경**: 이슈 목록 badge popover에서 직접 상태 변경 가능. 플랫폼별 흐름: Jira — `getTransitions`(REST)로 전환 목록 조회 → `transitionIssue`로 실행, 전환 후 `getIssueStatus`로 갱신. GitHub — `updateIssueState`(PATCH) open/closed 토글 + stateReason(completed/not_planned). Linear — `getWorkflowStates`(`issue(id:)` → `team.states` GraphQL)로 팀 워크플로 상태 조회 → `updateIssueState` mutation. Notion — `getDatabaseSchema`(기존)로 status 옵션 조회 → `updatePageStatus`(PATCH `/pages/{id}`) 상태 갱신. UI 컴포넌트: `IssueListTab.tsx`의 `{Platform}StatusBadge` 4종이 Popover + 옵션 리스트 렌더.
- **이슈 entry**: `IssueRecord.platform: PlatformId` 필수. v3→v4 migrate가 기존 entry를 `"jira"`로 채움. UI 분기는 `entry.platform`로. github 한정 메타(`githubOwner`/`githubRepo`/`githubLabels`), linear 한정 메타(`linearTeamKey`/`linearTeamId` 등), notion 한정 메타(`notionPageId`/`notionDatabaseId`/`notionDatabaseTitle`/`notionStatusOption`)는 optional — 등록 시 채우고, refresh fetch 응답으로 갱신.
- **본문 빌더**: `buildIssueAdf`(Jira용 ADF), `buildIssueMarkdown`/`buildIssueHtml`(클립보드 복사 공용), `buildGithubIssueBody`(GitHub MD), `buildLinearIssueBody`(Linear MD), `buildNotionIssueBody`(Notion blocks: heading_2/paragraph/bulleted_list_item/code/image/video/table). 모두 `MarkdownContext`를 입력으로 받는다. submit 결과는 `NormalizedSubmitResult { key, url }`로 통일 (Jira `BUG-1` / GitHub `#42` / Linear `TEAM-123` / Notion 페이지 ID hex 첫 8자) — `submitToGithub` / `submitToLinear` / `submitToNotion` 헬퍼.
- **Jira 인라인 미디어**: ADF `mediaSingle > media` 노드에 `type: "file"` + media UUID + `collection: ""` 패턴을 써야 이미지·비디오 인라인 프리뷰가 동작 (드래그앤드롭으로 본문에 박힌 미디어와 동일한 attrs). `type: "external"` + secure URL 경로는 미디어 플레이어가 인증 없이 못 받아서 "미디어를 확인할 수 없다" verify 에러로 표시되므로 **절대 fallback으로 만들지 말 것**. 문제는 첨부 REST API(`POST /rest/api/3/issue/{key}/attachments`) 응답에 `mediaApiFileId`가 거의 없다는 점. 워크어라운드: `GET /rest/api/3/attachment/content/{id}`가 `api.media.atlassian.com/file/{UUID}/binary?token=…`로 리다이렉트되니 `res.url`에서 UUID를 정규식으로 추출(`getMediaFileId` → `extractMediaId`). HEAD가 redirect를 안 트리거하는 환경이 존재하므로 **`getMediaFileId`는 GET+`Range: bytes=0-0` → HEAD 순으로 두 전략 시도**(`probeMediaRedirect` 헬퍼). 둘 다 실패하면 비디오는 텍스트 fallback(`t("md.videoAttached")`) — 인라인 임베드 포기하고 첨부 링크에 맡김.
- **Jira 미디어 디버깅 trap**: 인라인 재생 안 되거나 "미디어를 확인할 수 없다" 에러 보일 때 **코덱(VP9/VP8)·해상도·파일 크기·duration 의심부터 하지 말 것 — 거의 99% ADF/UUID 추출 경로 문제다.** 좁히는 순서: (1) `GET /rest/api/3/issue/{KEY}?fields=description` REST로 떠서 mediaSingle 노드의 `media.attrs.type` 확인 — `"external"`이면 `getMediaFileId`가 undefined 리턴해서 fallback 발동한 것. (2) 동일 파일을 Jira 본문에 드래그앤드롭해서 정답 attrs와 비교 — `type:"file"` + `collection:""` + UUID. (3) UUID 추출이 환경별로 깨지면 `probeMediaRedirect`에 다른 HTTP 메서드/헤더 조합 추가하거나, fallback을 텍스트 안내문으로 유지. 진짜로 코덱이 문제인 케이스는 동일 파일이 드래그앤드롭으로도 안 재생될 때뿐이다.
- **AI/디버그 메타 첨부**: `buildAiMetaAttachment(ctx)` 단일 헬퍼가 마크다운을 만들어 `data:text/markdown;base64,...`로 반환. filename은 `bugshot.md` 고정(`AI_META_FILENAME` 상수, placeholder 없음 — Jira/GitHub/Linear/Notion 공통). Jira는 `submitIssue` 핸들러가 `attachments[0]`로 받고, GitHub은 `uploadGithubFiles`로 업로드 후 본문 첨부 섹션에 파일 링크로 포함, Linear/Notion은 본문에 인라인하지 않고 createIssue/createPage 후(또는 페이로드의 attachments 큐) **별도 첨부**로 보낸다 (Linear: `createAttachment`, Notion: 첨부 섹션 file 블록 = log 카테고리).
- **다이얼로그**: `SubmitFieldsDialog`가 IssueCreateModal과 DraftDetailDialog 양쪽에서 공유. 연결 1개=Tab 숨김 자동, 2개 이상=shadcn Tabs로 platform 선택. 선택 시 `editor-store.setTargetPlatform` + `issuesStore.patchIssue`로 IssueRecord.platform 동기. default platform은 `pickInitialPlatform(accounts, lastSubmittedPlatform)` (직전 제출 → jira → github → linear → notion 순). prefill effect deps는 `[open, issue?.id]`만 — issue.platform 변경(사용자 Tab 클릭 결과)에 effect 재발화 시 SubmitFieldsDialog가 강제로 닫히는 버그 회피.
- **OAuth 에러 분기**: `OAuthError`는 `{ platform, cancelled }` 옵션을 가지며 BG가 `body.platform` / `body.oauthCancelled` / `body.oauthRefreshFailed` 플래그로 직렬화. 정규식 메시지 매칭 금지 — UI는 `isOAuthCancelled` / `getOAuthErrorPlatform` 헬퍼로 분기. cancel 코드는 `isAtlassianCancellationCode` / `isGithubCancellationCode` / `isLinearCancellationCode` / `isNotionCancellationCode` 화이트리스트.

## 토큰 체인 resolve 룰

picker의 `resolveVarChain`은 `var()` 체인을 따라가며 어느 이름에서 멈출지 결정한다. 원칙: **디자인 토큰 이름은 보존, 컴포넌트 내부 alias는 펼침**.

- **공용(public) 토큰** (`--radius-xxl`, `--color-text-semantic`, `--spacing-14` 등): 처음 만나는 이름에서 멈춘다. 원시 > 시맨틱 구조에서 시맨틱이 원시를 참조해도(`--color-text-semantic: var(--color-gray-scale-900)`) 시맨틱 이름이 그대로 노출된다.
- **private alias** (`--_xxx` 언더스코어 prefix 컨벤션): 리터럴까지 끝까지 펼친다. 컴포넌트 내부 임시변수(`--_padding: var(--spacing-14)`, `--_size: 40px`)는 실제 참조 토큰/값으로 대체.

조합 예:
- `padding: var(--_padding)` + `--_padding: var(--spacing-14)` → 노출: `var(--spacing-14)`
- `color: var(--color-text-semantic)` + `--color-text-semantic: var(--color-gray-scale-900)` → 노출: `var(--color-text-semantic)`
- fallback `var(--x, var(--y))` — primary 정의 없으면 fallback의 이름으로 resolve 시도, 규칙은 동일.

## CSSOM shorthand 한계 우회 (Raw CSS Cache)

배경: **shorthand(var 포함) + 같은 shorthand의 longhand 부분 override** 조합에서 Chrome이 shorthand를 explode하면서 **원본 var() 값을 빈 문자열로 대체**한다. CSSOM만으로는 복구 불가.

예:
```css
.user-message {
  border-radius: var(--radius-xxl);
  border-bottom-right-radius: 4px;
}
```

CSSOM이 보여주는 것: `border-top-left-radius: ""` / `border-top-right-radius: ""` / `border-bottom-left-radius: ""` / `border-bottom-right-radius: "4px"`. `getPropertyValue("border-radius")` → `""`.

**대응**: `src/content/css-source-cache.ts`가 raw CSS 텍스트를 별도 확보해 룰별로 매핑.

수집 경로:
- `<style>` 블록: `ownerNode.textContent` (sync)
- `<link rel=stylesheet>`: `fetch(href)` — same-origin / CORS-safe만 성공, cross-origin은 silent fallback
- `adoptedStyleSheets`: 각 룰의 `cssText` 직렬화 (constructable sheet은 explode 없음)

라이프사이클: 픽커 활성화(`handleStart`) 시 `ensureLoaded()` 호출 + `MutationObserver`로 `<link>`/`<style>` 추가·제거·HMR 감지해 invalidate. 비활성화(`handleClear`) 시 cache drop.

매핑: parsed rule list와 `sheet.cssRules` flatten 결과를 **순서 + selectorText 검증**으로 1:1 매핑. mismatch 시 해당 sheet은 cache miss 처리 → 기존 CSSOM 경로로 fallback.

`collectSpecifiedFromRules`(css-resolve.ts)에서 매칭된 룰별로 `getRawDeclarationsFor(rule)` 우선 사용, null이면 CSSOM `decl.cssText` fallback. `extractVarPropsFromMap` 헬퍼가 raw map 입력을 받아 shorthand → longhand expansion 처리.

비동기 영향: `picker.collectTokens` 메시지 핸들러 + `emitSelected` / `scheduleSelectionUpdate` / `scheduleTokenBuild`가 응답 전 `await ensureCssCacheLoaded()`. content script 메시지 핸들러는 `return true` + IIFE 패턴으로 비동기 응답.

여전히 못 잡는 케이스: cross-origin stylesheet 중 CORS 헤더 없는 것 (대부분의 CDN). 이 경우 기존 한계 그대로 — computed literal 폴백.

## 백그라운드 로그 캡처 (Network / Console)

content_scripts에 MAIN world entry(`run_at: "document_start"`)로 `src/content/recorders-entry.ts`를 등록해 모든 페이지의 fetch/XHR/sendBeacon/console.*을 자동 wrap. 페이지 자체 스크립트보다 먼저 실행되므로 Sentry 등 SDK가 `originalFetch`를 캐싱하기 전에 wrap이 끼어든다.

**document_start부터 무조건 buffer (옵션 A)** — wrap 설치 즉시 buffer에 적재한다. sentinel은 dispatch 채널 식별용일 뿐이며, sentinel 도착 전에 발생한 첫 fetch도 누락되지 않는다. 메모리는 두 단계로 보호: (1) 50MB body cap + LRU trim(`enforceMemoryCap`)이 본문을 omitted로 회수, (2) 5000 entry FIFO cap(`enforceEntryCap`)이 본문 없는 요청(HEAD/204/binary beacon) 폭증으로부터 buffer 길이 자체를 막는다. cap 도달 시 oldest를 버리는 FIFO — 버그 재현 시나리오에서 가치 있는 신호는 후반부라는 가정. 사이드패널이 켜져 있지 않아도 buffer가 차오를 수 있는 비용이 있지만, recording 시작 시점에 이미 시나리오 재현이 진행 중인 케이스를 커버하기 위해 채택. console-recorder도 동일하게 2000 entry FIFO + `clearBuffer`가 counters/timers Map까지 리셋.

**요청 phase 추적** — fetch/XHR send 시점에 `phase: "pending"` entry를 push하고, 응답 완료 시 `phase: "complete"`, reject/abort/error/timeout 시 `phase: "error"`로 in-place 갱신. 따라서 sync 시점에 in-flight 요청도 가시화되고, navigation으로 끊긴 요청은 pending으로 남아 디버깅 단서가 된다. summary는 `phase=error`를 status=0이어도 에러로 집계하므로 CORS·네트워크 실패가 이슈 본문에서 누락되지 않는다.

**Body omission context** — `responseBody`/`requestBody`가 `string | NetworkBodyOmission` union. omission shape은 단순 kind 태그가 아니라 사유와 크기를 같이 들고 다닌다:
- `{ kind: "truncated", limit, size }` — `size`가 `BODY_CAP`(3MB) 초과
- `{ kind: "binary", contentType, size }` — image/audio/video/font/pdf/wasm/octet-stream
- `{ kind: "stream", contentType }` — body 미존재 또는 reader 실패 (SSE / multipart)
- `{ kind: "omitted", reason: "memory-cap" }` — LRU trim으로 본문 회수

UI(`NetworkLogPreviewDialog`)와 HAR export 모두 이 context를 살려 "본문 잘림 (5.0 MB · 한도 3.0 MB)" / "Binary response (image/png · 500 B)" 등 정확한 사유를 표시.

**클리어 트리거** — `useBackgroundRecorder`의 store 구독이 `preserve phase → idle` 전환을 감지하면 pending IndexedDB + MAIN buffer를 정리한 뒤 새 sentinel 발급. `shouldPreserveBackgroundLogs(phase)` = `recording / drafting / previewing / done`. 작성 취소, 정상 제출 후 reset, 녹화 중 취소 모두 이 분기에서 일괄 처리.

**고아 pending 정리 (SW 부트)** — `pending:${tabId}` IndexedDB 엔트리는 평소 `chrome.tabs.onRemoved`·URL 변경·이슈 저장 3경로로 정리되지만, 브라우저 강제 종료·확장 reload·SW 휴면 중 탭 종료 등으로 onRemoved가 누락되면 영구 잔류한다. `src/lib/pending-log-prune.ts`의 `pruneOrphanPendingLogsOncePerSession()`이 SW 부트 시 `chrome.storage.session.pendingPrunedAt` 플래그로 세션당 1회만 도는 가드를 두고, 현재 `chrome.tabs.query({})` 결과에 없는 tabId의 `pending:` 엔트리를 회수. `findOrphanPendingKeys`는 순수 함수로 분리해 테스트.

**race 회피** — clear → setSentinel을 sequential `await`로 강제. fire-and-forget이면 Chrome 메시지 큐 처리 순서 미보장으로 setSentinel이 먼저 처리되어 이전 sentinel의 clearHandler가 detach → 후속 clear가 무시되는 경로가 가능. sequential로 picker.ts 처리 round-trip을 기다린 뒤 setSentinel.

**추가 캡처** — `window.fetch`와 XHR 외에 `navigator.sendBeacon` (GA/Sentry/Datadog 등), fetch reject (네트워크 실패·CORS 차단), XHR error/abort/timeout 이벤트까지 entry화. 실패 entry는 `status=0` + `statusText="Network Error"/"Aborted"/"Timeout"`, beacon은 queued 결과에 따라 `200 OK` 또는 `0 Queue Full`. 모두 `phase`로 분류된다.

**Console wrap 범위** — `console.log/info/debug` + `trace/assert/dir/table/group*/count*/time*` 시리즈만 wrap한다. `console.error/warn`은 의도적으로 풀어둔다 — 페이지가 native `console.error`를 호출하면 우리 wrap 함수가 콜스택에 끼는데, Chrome이 그걸 "이 확장이 console.error를 호출했다"로 attribution → `chrome://extensions` 오류 페이지에 페이지 라이브러리의 모든 deprecation/info 경고가 누적된다(Atlassian/Jira는 매 페이지마다 수십~수백 건). 진짜 가치 있는 신호는 다른 경로로 잡힌다: `window.addEventListener("error")`가 uncaught 에러를, `unhandledrejection`이 reject된 promise를, wrapped `console.assert`가 condition false 시점을 직접 `pushEntry("error")`로 buffer에 push. catch 후 `console.error(err)`로만 로깅한 케이스만 손해.

**SPA path 변경** — `chrome.tabs.onUpdated`가 발화하는 케이스(full reload, 주소창 navigation)에 한해 URL key(`origin + pathname`) 비교 → 변경 시 preserve가 아니면 MAIN buffer + pending IndexedDB clear. `history.pushState` 기반 SPA navigation은 onUpdated가 발화하지 않아 자동 클리어 안 됨 — recording phase는 누적 의도라 이 동작이 부합.

**handleStartVideo 흐름** — 녹화 시작 전에 명시 clear가 필요(이미 누적된 백그라운드 버퍼를 녹화 구간 이전 데이터로 두지 않기 위해). `injectNetworkRecorder` (rebind, no-op일 수도) → `clearNetworkRecorder` → `startRecording` 순서. 녹화 정상 종료(`recording → drafting`)에 `recordersStopped = true`로 세팅해 drafting 동안 페이지 reload에도 재주입 차단(자산 보존). `startRecording` 내부에선 `chrome.tabCapture.getMediaStreamId` 직후 `recorder.start(1000)` 호출. tabCapture 해상도는 1920×1080 상한으로 제한.

**Cross-tab 메시지 격리** — `chrome.runtime.sendMessage`는 모든 extension contexts에 broadcast되므로 다른 탭의 content script가 보낸 `networkRecorder.data`/`consoleRecorder.data`/`picker.*`도 내 사이드패널 핸들러에 도달한다. `usePickerMessages`가 핸들러 진입부에서 `sender.tab?.id !== myTabId`인 메시지를 drop — 그러지 않으면 같은 origin/다른 path의 두 탭에서 동시에 녹화 중일 때 한 사이드패널이 다른 탭의 로그로 자기 store/IDB를 덮어쓰는 버그가 발생한다. `sender.tab` 부재(사이드패널/서비스워커 내부 통신)는 통과.

## chrome.scripting.executeScript MAIN world 주입 규칙

`chrome.scripting.executeScript({ world: "MAIN", func })`의 `func` 인자는 `Function.prototype.toString()`으로 직렬화 후 대상 탭의 페이지 컨텍스트에서 **재평가**된다. SW의 모듈 스코프 클로저는 살아남지 않는다 — 모듈 스코프의 헬퍼 함수·상수를 참조하면 페이지에서 `ReferenceError`로 즉시 throw, 반환 Promise가 reject되어 `result.result === null`로 떨어진다.

규칙: 주입 함수는 **self-contained**여야 한다. 헬퍼는 nested function으로 inline하거나 함수 인자로 전달. 글로벌(`fetch`/`FormData`/`Blob`/`URL`/`atob` 등)과 인자만 사용 가능.

현재 사용처: `src/background/github-upload.ts:pageBatchUploadFn` (issue attachment 업로드). `network/console-recorder`는 content_scripts MAIN world entry라서 모듈 번들 통째로 실행되므로 별개 — 이 규칙은 **런타임 SW→탭 주입**에만 해당.

방어선: TypeScript는 같은 모듈 참조라 잡지 못하고, 단위 테스트도 MAIN world 직렬화 경계를 재현하기 어렵다. **GitHub 인라인 업로드 같은 inject 경로는 수동 회귀가 유일한 방어선**. v1.1.2에서 단일 파일 업로드 → `Promise.all` 병렬화 리팩터로 `uploadOne`을 모듈 스코프로 추출하면서 이 규칙을 위반, v1.1.4까지 latent로 남아 있었다. inject 함수 본체를 리팩터·헬퍼 추출할 땐 항상 실제 탭에서 한 번 더 확인.

## DOM 트리 Lazy Load

DOM 트리 Dialog(`IssueTab.tsx`의 `DomTree`)는 큰 페이지에서 전체 DOM을 한 번에 직렬화하면 프리즈된다. 그래서 두 단계로 동작:

1. **초기 트리 (`picker.describeInitial`)**: `body`부터 현재 선택된 요소까지의 **조상 경로**와 각 레벨의 **sibling**만 내려준다. `{ tree, ancestorPath[] }`.
2. **자식 온디맨드 (`picker.describeChildren`)**: 유저가 노드를 펼칠 때 `{ selector }`로 요청, 해당 노드의 자식만 추가 로드 → `injectChildren`으로 트리에 머지.

노드의 `childCount > 0 && children === undefined`면 "아직 안 불러온 상태"로 간주하고 토글 시 fetch. 한 번 로드한 자식은 캐시.

## 마크다운 복사 (Preview)

Jira는 마크다운 원본을 파싱하지 않고, 붙여넣기는 **ProseMirror가 HTML을 해석**한다. 그래서 `ClipboardItem`으로 `text/plain` + `text/html` **둘 다** 쓴다.

- `text/plain`: GFM 파이프 테이블 포함 MD (Slack/Gmail fallback)
- `text/html`: `<h1>/<h2>/<p>/<table>` — Jira·Notion·Confluence가 네이티브 테이블로 변환
- base64 이미지는 Jira가 sanitize하므로 클립보드 출력에서 **제외**

구현: `src/sidepanel/lib/buildIssueMarkdown.ts` — `buildIssueMarkdown()` + `buildIssueHtml()` 페어.

## 이슈 섹션 구성 (설정 탭 → 이슈 설정)

사용자 입력 섹션은 **설정 탭에서 on/off 가능**한 4종 빌트인. `settings-ui-store`의 `IssueSection[]` (`DEFAULT_ISSUE_SECTIONS`) 배열 순서가 곧 출력 순서.

| id | 기본 enabled | renderAs |
|---|---|---|
| `description` (발생 현상) | ✅ | paragraph |
| `stepsToReproduce` (재현 과정) | ✅ | orderedList |
| `expectedResult` (기대 결과) | ✅ | paragraph |
| `notes` (비고) | ⬜ | paragraph |

draft 데이터 모델은 `{ title, sections: Record<string, string>, environment?: EnvironmentRow[] }`. 섹션 마다 newline-joined 평문. `stepsToReproduce`는 줄별 Input + Trash2 IconButton의 `OrderedListEditor` 전용 UI; 그 외는 plain Textarea.

**재현 환경 섹션**: drafting 패널 제목 아래 `ReproEnvironmentSection`이 모드별 메타(Page/DOM/Viewport/Captured)를 readonly로 파생 표시하고, `draft.environment`의 사용자 정의 label/value row를 편집한다. custom row는 `MarkdownContext.environment`를 거쳐 5종 빌드 함수의 Environment 섹션에 추가된다. 순수 헬퍼 `filterEnvironmentRows`(빈/공백 row 제거 + 개행 치환) / `deriveReadonlyEnvRows`(모드별 readonly row 파생)는 `sidepanel/lib/environmentRows.ts`, 타입은 `types/environment.ts`. `environment`는 optional이라 버전 bump 없이 구 레코드는 `?? []`로 호환.

**자동 메타 위치**: `POST_MEDIA_SECTION_IDS = {"expectedResult","notes"}` — enabled iterate 중 첫 POST_MEDIA 섹션을 만나면 그 직전에 media/styleChanges 블록 emit. 둘 다 disabled면 모든 섹션 끝에 emit. `buildIssueMarkdown` / `buildIssueHtml` / `buildIssueAdf` / `DraftingPanel` / `PreviewPanel` / `DraftDetailDialog` 5곳에서 동일 룰. 라벨 i18n 헬퍼는 `sectionLabelKey` / `sectionMdLabelKey` / `sectionPlaceholderKey` / `sectionHelpKey` (`settings-ui-store`).

**마이그레이션 3중 가드**: `issues-store` v3, `settings-ui-store` v2, `useEditorSessionSync.migrateLegacyDraft` — 세 곳 모두 `if (legacy.sections)` 멱등 가드 + sparse 저장(빈 legacy 값은 sections에 키 추가 안 함). 빈 paragraph 섹션 출력은 마크다운/HTML/ADF 모두 `(없음)` (`md.noValue`)로 통일.

**플랫폼 마이그레이션** (별도 트랙):
- `settings-store` v2→v3: `jiraConfig` → `accounts: { jira?, github? }` + `lastSubmitFields` → `Record<PlatformId, ...>`. `migrateV2ToV3` pure helper export — 단위 테스트 표적. 멱등 가드.
- `settings-store` v3/v4→v5: 각 플랫폼 account에 있던 `titlePrefix`를 전역 `titlePrefix: string`으로 승격. `migrateToV5` pure helper export. jira → github → linear 순 우선순위로 기존 값 추출, 없으면 빈 문자열.
- `settings-store` v5→v6: notion 플랫폼 추가 마커. `accounts.notion` / `lastSubmitFields.notion`은 모두 optional이라 데이터 마이그레이션 불필요 — 버전만 bump.
- `issues-store` v3→v4: `IssueRecord`에 `platform: PlatformId` 필수 추가. 기존 entry는 `"jira"`로 채움. `migrateIssueToV4`는 `issues-migrations.ts`로 분리(테스트가 issues-store 본체를 import하면 picker-control→i18n→settings-ui-store→navigator 트랜시티브 로드 발생 — pure helper 분리로 회피).
- `issues-store` v4→v5: notion 한정 optional 메타(`notionPageId`/`notionDatabaseId`/`notionDatabaseTitle`/`notionStatusOption`) 추가 마커. 데이터 마이그레이션 불필요.
