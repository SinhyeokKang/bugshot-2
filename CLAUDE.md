# CLAUDE.md

bugshot-2: Chrome MV3 Side Panel 확장. 웹 페이지의 DOM 요소를 골라 스타일을 수정·비교한 후 Jira·GitHub·Linear·Notion 이슈로 등록한다.

사용자는 한국어로 간결한 답변을 선호한다. 불필요한 꾸밈말·서두 금지.

## 작업 원칙

- **가정을 명시**: 해석이 여러 개면 조용히 하나 고르지 말고 선택지를 제시. 불확실하면 물어라.
- **더 단순한 방법이 있으면 제안**: 200줄을 50줄로 줄일 수 있으면 줄여라. 요청하지 않은 유연성·설정 가능성·추상화 추가 금지.
- **외과적 변경**: 요청과 직접 관련 없는 인접 코드 개선·리팩터 금지. 기존 스타일 따르기. 기존 dead code는 언급만 하고 삭제하지 않는다 — 내 변경이 만든 고아만 제거.
- **검증 가능한 목표로 전환**: "버그 고쳐" → "재현 테스트 작성 후 통과시켜". 멀티스텝 작업은 단계별 검증 체크를 포함한 플랜을 먼저 제시.
- **테스트 우선**: 신규 인터페이스(함수·헬퍼·어댑터) 추가 시 테스트를 먼저 작성하고 구현한다. 기존 로직 변경 시에도 관련 순수 함수의 단위 테스트를 작성/갱신하고 `pnpm test` 통과를 확인한 뒤 작업을 마친다. 테스트 없이 코드만 변경하지 않는다.

## 스택

- React 18 + TypeScript + Vite (via `@crxjs/vite-plugin`)
- Tailwind CSS v3 + shadcn/ui (style `new-york`, base color `slate`)
- Zustand + `chrome.storage` (session/local 혼용)
- 아이콘: lucide-react (UI 일반), `@icons-pack/react-simple-icons` (브랜드 — Jira/GitHub 등 플랫폼 마크는 `Si{Name}` import, `color="default"` + GitHub만 `dark:invert`), 폰트: Pretendard
- MV3 service worker + content script + side panel

## 명령어

| 용도 | 명령 |
|---|---|
| 개발 서버 | `pnpm dev` |
| 빌드 | `pnpm build` |
| 스토어 업로드용 빌드 | `pnpm build:store` (manifest `key` 제거) |
| 타입 체크만 | `pnpm typecheck` |
| 테스트 | `pnpm test` |
| 테스트 (watch) | `pnpm test:watch` |

**빌드는 자동 실행하지 않는다.** 사용자가 명시적으로 요청하거나 `/build` 스킬을 실행할 때만 돌린다. 타입 확인이 필요하면 `pnpm typecheck` 선호.

`build:store`는 `BUGSHOT_STORE_BUILD=1`을 세팅해 `manifest.config.ts`에서 dev용 `key`를 생략한다. 로컬 dev/로드 언팩 시에는 `key`가 있어야 OAuth redirect URI(`chrome-extension://<ID>/...`)가 고정되므로 **기본 `pnpm build` 유지**.

## 디렉터리 구조

```
src/
├── background/      # service worker
│   ├── index.ts         # 메시지 라우터 + 전역 sidePanel 비활성화
│   ├── tab-bindings.ts  # 탭별 side panel on/off (활성화 셋 기반)
│   ├── jira-api.ts      # Jira REST 래퍼 (Basic + Bearer, 401 시 refresh 재시도)
│   ├── oauth.ts         # Atlassian 3LO (launchWebAuthFlow + proxy 교환)
│   ├── github-api.ts    # GitHub REST 래퍼 (PAT/Bearer, 401 refresh hook 주입형)
│   ├── github-oauth.ts  # GitHub Web Flow (launchWebAuthFlow + proxy 교환) + refresh hook 자동 등록
│   ├── linear-api.ts    # Linear GraphQL 래퍼 (API Key/Bearer, 401 refresh hook 주입형)
│   ├── linear-oauth.ts  # Linear OAuth (PKCE, launchWebAuthFlow, proxy 불필요) + refresh hook 자동 등록
│   ├── notion-api.ts    # Notion REST 래퍼 (apiKey/Bearer, 401 → notion.oauthExpired, refresh 없음)
│   ├── notion-oauth.ts  # Notion Web Flow (launchWebAuthFlow + proxy 교환, public integration — refresh 토큰 없음)
│   └── messages.ts      # 메시지 핸들러 디스패치 (jira.* / github.* / linear.* / notion.* namespace)
├── content/
│   ├── picker.ts          # DOM picker 메인 (메시지 라우터 + 모드 FSM + hover/select 이벤트)
│   ├── css-resolve.ts     # CSS 스타일 수집·토큰 resolve (resolveVarChain, collectSelection, collectTokens)
│   ├── css-source-cache.ts# raw CSS 텍스트 캐시 (CSSOM shorthand explode 우회, fetch + 경량 파서 + MutationObserver)
│   ├── dom-describe.ts    # DOM 트리 직렬화 (buildSelector, buildInitialTree, buildChildrenResponse)
│   ├── overlay.ts         # Shadow DOM 오버레이 (아웃라인·배너·블로커·프리뷰)
│   ├── area-select.ts     # 영역 드래그 선택 (dimming + 사이즈 라벨)
│   ├── network-recorder.ts# MAIN world 네트워크 캡처 (fetch/XHR 래핑, sentinel 기반 통신)
│   └── console-recorder.ts# MAIN world 콘솔 캡처 (console.* 래핑, 500건 캡)
├── sidepanel/
│   ├── App.tsx          # Radix Tabs 4개 (이슈 작성/목록/연동/설정)
│   ├── main.tsx
│   ├── capture.ts       # 요소 크롭 스냅샷
│   ├── picker-control.ts
│   ├── hooks/           # useBoundTabId, useChromeAI, useEditorSessionSync, useIssueImages, usePickerMessages, useThemeEffect
│   ├── components/      # 공통 UI (Section/PageShell/PageScroll/PageFooter/AnnotationOverlay 등)
│   ├── tabs/            # 탭별 진입점 + 편집 패널 (StyleEditorPanel/IssueTab/IssueListTab/IntegrationsTab/SettingsTab 등)
│   │   ├── styleEditor/   # ValueCombobox, StylePropEditors와 헬퍼 (propMetadata, tokenUtils, styleHooks, TokenChip, colorLiteral, hexUtils)
│   │   ├── connect/       # 플랫폼별 연결 폼 (JiraConnectForm, GithubConnectForm, LinearConnectForm, NotionConnectForm) — IntegrationsTab의 sub-tab content
│   │   ├── githubFields/  # GitHub 메타 필드 컴포넌트 (RepoCombobox, LabelCombobox, AssigneeMultiSelect, GithubIssueFields 묶음, labelToggle 헬퍼) — IntegrationsTab/IssueCreateModal 양쪽에서 controlled로 재사용
│   │   ├── linearFields/  # Linear 메타 필드 컴포넌트 (TeamCombobox, ProjectCombobox, LabelCombobox, PrioritySelect, AssigneeCombobox, LinearIssueFields 묶음) — IntegrationsTab/IssueCreateModal 양쪽에서 controlled로 재사용
│   │   ├── notionFields/  # Notion 메타 필드 컴포넌트 (DatabaseCombobox, StatusSelect, PropertiesFieldset, PropertySelectCombobox, NotionIssueFields 묶음, reconcileNotionFields 헬퍼) — IntegrationsTab/IssueCreateModal 양쪽에서 controlled로 재사용
│   │   └── notionStatusColors.ts  # Notion status option color → STATUS_CATEGORY (new/indeterminate/done) 매핑
│   └── lib/             # buildIssueMarkdown, buildIssueAdf, buildGithubIssueBody, buildLinearIssueBody, buildNotionIssueBody, submitToGithub, submitToLinear, submitToNotion(NormalizedSubmitResult), buildAiDraftPrompt 등 순수 유틸
├── store/               # Zustand 스토어 (editor/issues/settings/settings-ui), blob-db(IndexedDB 이미지·비디오·네트워크/콘솔 로그 저장)
│                        # settings v6: accounts: { jira?, github?, linear?, notion? } + lastSubmitFields per platform + global titlePrefix
│                        # issues v5: entry에 platform: PlatformId 필드 + notion 한정 메타 (notionPageId/notionDatabaseId 등)
├── i18n/                # 다국어 (ko/en 로케일, t()/useT() 훅)
├── lib/                 # 공용 유틸 (session-keys, adf-sentinels, url-support, settings-storage, notion-page-id)
├── components/ui/       # shadcn 컴포넌트
├── styles/
└── types/               # platform.ts (PlatformId/Accounts/LastSubmitFieldsByPlatform), github.ts, jira.ts, linear.ts, notion.ts 등
oauth-proxy/             # Cloudflare Worker — Atlassian /token + GitHub /github/{token,refresh} + Notion /notion/token 교환 (client_secret 서버 보관, Linear는 PKCE라 proxy 불필요)
docs/
├── STORE_DEPLOY.md  # 웹스토어 배포 가이드
└── privacy.md       # 개인정보처리방침 (GitHub Pages)
```

## 아키텍처 원칙

### Side Panel은 탭 스코프

**활성화한 탭에서만 side panel이 보이고, 탭을 이동하면 자동으로 닫힌다.** 돌아오면 다시 열린다.

구현:
- `chrome.storage.session`의 `sidePanel:activated` 키에 활성화된 tabId 셋을 저장
- `chrome.action.onClicked`에서 해당 탭을 셋에 추가하고 `sidePanel.setOptions({tabId, enabled:true, path:...?tabId=X})` + `sidePanel.open({tabId})`
- `chrome.tabs.onActivated` / `onUpdated`에서 각 탭이 활성화 셋에 있으면 enable, 없으면 disable
- **manifest의 `side_panel.default_path`가 전역 fallback을 제공하므로** `onInstalled`/`onStartup`에서 `chrome.sidePanel.setOptions({ enabled: false })`로 전역 비활성화 필수

### user gesture 보존

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

### 편집 세션 영속화

- tabId별로 `chrome.storage.session`의 `editor:${tabId}` 키에 저장
- `useEditorSessionSync(tabId)` 훅이 hydration + debounced save(300ms) 담당 (zustand persist 미들웨어 대신 직접 구현 — tabId-scoped 키가 persist의 "one store, one key" 모델에 맞지 않음)
- origin 변경 시 해당 탭의 세션은 버림 (`clearIfOriginChanged` in `tab-bindings.ts`)
- 탭 닫히면 `onRemoved`에서 정리

### Jira 인증 (OAuth 3LO + API Token)

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

### GitHub 인증 (OAuth Web Flow + PAT)

Jira와 같은 모양으로 두 방식 동시 지원. 저장 형태는 discriminated union (`GithubAuth = GithubPatAuth | GithubOAuthAuth`).

- **PAT**: `Authorization: token <pat>` 헤더로 `api.github.com` 직접 호출. `repo` scope 필요.
- **OAuth Web Flow**: `chrome.identity.launchWebAuthFlow` → 인가 코드 → **oauth-proxy**(`/github/token`)에서 `client_secret`과 교환 → `Authorization: Bearer <accessToken>`로 호출. `Accept: application/vnd.github+json` + `X-GitHub-Api-Version: 2022-11-28` 헤더 고정. scope: `repo user:email` (email은 viewer 카드 desc 용).
- **dev/prod OAuth App 분리**: GitHub OAuth App은 callback URL을 1개만 등록 가능 → dev key extension ID와 스토어 ID가 달라서 두 App 동시 운영. proxy worker가 클라이언트가 보낸 `client_id`로 `GITHUB_CLIENT_{ID,SECRET}_{DEV,PROD}` 중 매칭되는 secret 선택 (화이트리스트 효과). vite.config.ts에서 `BUGSHOT_STORE_BUILD=1`이면 `VITE_GITHUB_CLIENT_ID_PROD`를 `VITE_GITHUB_CLIENT_ID`로 define-치환.

**토큰 갱신 — refresh hook 주입형**: `github-api.ts`는 `setGithubRefreshHook(hook)`을 export하고, `github-oauth.ts`가 모듈 로드 시 자동 등록(`refreshOnceWithLock`). 401 수신 시 hook이 있으면 1회 refresh 후 재시도. **GitHub OAuth App의 "Token expiration" 옵션이 OFF면 refresh token 자체가 발급되지 않으며**, 이 경우 `refreshGithubToken`은 즉시 `OAuthError(github.refreshUnavailable)` throw → 재인증 안내. PR 시점에 OAuth App을 만들 땐 만료 활성화 권장.

**환경 변수** (빌드 타임):
- `VITE_GITHUB_CLIENT_ID` — OAuth App client_id
- `VITE_OAUTH_PROXY_URL` — Atlassian과 공용 (proxy는 `/token`/`/github/token`/`/github/refresh` 3개 라우트)

`isGithubOAuthConfigured()` false면 IntegrationsTab의 [GitHub] sub-tab은 OAuth 버튼을 비활성화하고 PAT 섹션만 사용 가능.

### Linear 인증 (OAuth PKCE + API Key)

Jira·GitHub과 같은 모양으로 두 방식 동시 지원. 저장 형태는 discriminated union (`LinearAuth = LinearApiKeyAuth | LinearOAuthAuth`).

- **API Key**: `Authorization: <apiKey>` 헤더로 `api.linear.app/graphql` 직접 호출.
- **OAuth PKCE**: `chrome.identity.launchWebAuthFlow` → PKCE code_challenge → 인가 코드 → `api.linear.app/oauth/token`에 직접 교환 (public client — **proxy 불필요**). scope: `read write issues:create`.
- **dev/prod redirect URI**: Linear OAuth App은 redirect URI 다중 등록 가능 → App 1개에 dev/prod URL 둘 다 등록, 단일 `VITE_LINEAR_CLIENT_ID` 사용.

**토큰 갱신 — refresh hook 주입형**: GitHub과 동일 패턴. `linear-api.ts`의 `setLinearRefreshHook(hook)` + `linear-oauth.ts`가 모듈 로드 시 자동 등록. 401 수신 시 1회 refresh 후 재시도.

**GraphQL API**: Linear은 REST가 아닌 `api.linear.app/graphql` 단일 엔드포인트. `linear-api.ts`의 `linearGql<T>(auth, query, variables)` 제네릭 래퍼가 모든 호출을 처리.

**환경 변수** (빌드 타임):
- `VITE_LINEAR_CLIENT_ID` — OAuth App client_id

`isLinearOAuthConfigured()` false면 IntegrationsTab의 [Linear] sub-tab은 OAuth 버튼을 비활성화하고 API Key 섹션만 사용 가능.

### Notion 인증 (OAuth + Internal Integration Token)

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

### 플랫폼 어댑터 패턴 (Jira·GitHub·Linear·Notion 공용 골격)

어댑터 단위로 분리. `PlatformId = "jira" | "github" | "linear" | "notion"` union을 한 곳(`src/types/platform.ts`)에서 관리.

- **저장**: `useSettingsStore`의 `accounts: { jira?: JiraAccount; github?: GithubAccount; linear?: LinearAccount; notion?: NotionAccount }` dict + `lastSubmitFields: Record<PlatformId, ...>` + 전역 `titlePrefix: string`. `setAccount(platform, account)` / `removeAccount(platform)` / `updateJiraAccount(patch)` / `updateGithubAccount(patch)` / `updateLinearAccount(patch)` / `updateNotionAccount(patch)` API.
- **메시지**: bg는 `jira.*` / `github.*` / `linear.*` / `notion.*` 네 namespace로 분기. 새 플랫폼은 새 namespace 추가만. `BgRequest` discriminated union의 exhaustive switch가 누락 검증.
- **API 어댑터**: `{platform}-api.ts`에 fetch 래퍼 + 에러 클래스 + 순수 mapper export. 401 처리는 jira는 즉시 refresh 호출, github·linear는 hook 주입형(서비스 워커 재시작 후에도 module side-effect로 재등록), notion은 refresh가 없어 즉시 `notion.oauthExpired` throw.
- **이슈 entry**: `IssueRecord.platform: PlatformId` 필수. v3→v4 migrate가 기존 entry를 `"jira"`로 채움. UI 분기는 `entry.platform`로. github 한정 메타(`githubOwner`/`githubRepo`/`githubLabels`), linear 한정 메타(`linearTeamKey`/`linearTeamId` 등), notion 한정 메타(`notionPageId`/`notionDatabaseId`/`notionDatabaseTitle`/`notionStatusOption`)는 optional — 등록 시 채우고, refresh fetch 응답으로 갱신.
- **본문 빌더**: `buildIssueAdf`(Jira용 ADF), `buildIssueMarkdown`/`buildIssueHtml`(클립보드 복사 공용), `buildGithubIssueBody`(GitHub MD), `buildLinearIssueBody`(Linear MD), `buildNotionIssueBody`(Notion blocks: heading_2/paragraph/bulleted_list_item/code/image/video/table). 모두 `MarkdownContext`를 입력으로 받는다. submit 결과는 `NormalizedSubmitResult { key, url }`로 통일 (Jira `BUG-1` / GitHub `#42` / Linear `TEAM-123` / Notion 페이지 ID hex 첫 8자) — `submitToGithub` / `submitToLinear` / `submitToNotion` 헬퍼.
- **AI/디버그 메타 첨부**: `buildAiMetaAttachment(ctx)` 단일 헬퍼가 마크다운을 만들어 `data:text/markdown;base64,...`로 반환. filename은 `bugshot.md` 고정(`AI_META_FILENAME` 상수, placeholder 없음 — Jira/Linear/Notion 공통). Jira는 `submitIssue` 핸들러가 `attachments[0]`로 받고, Linear/Notion은 본문에 인라인하지 않고 createIssue/createPage 후(또는 페이로드의 attachments 큐) **별도 첨부**로 보낸다 (Linear: `createAttachment`, Notion: 첨부 섹션 file 블록 = log 카테고리). GitHub은 Issues API에 attachments 필드가 없어 의도적으로 제외.
- **다이얼로그**: `SubmitFieldsDialog`가 IssueCreateModal과 DraftDetailDialog 양쪽에서 공유. 연결 1개=Tab 숨김 자동, 2개 이상=shadcn Tabs로 platform 선택. 선택 시 `editor-store.setTargetPlatform` + `issuesStore.patchIssue`로 IssueRecord.platform 동기. default platform은 `pickInitialPlatform(accounts, lastSubmittedPlatform)` (직전 제출 → jira → github → linear → notion 순). prefill effect deps는 `[open, issue?.id]`만 — issue.platform 변경(사용자 Tab 클릭 결과)에 effect 재발화 시 SubmitFieldsDialog가 강제로 닫히는 버그 회피.
- **OAuth 에러 분기**: `OAuthError`는 `{ platform, cancelled }` 옵션을 가지며 BG가 `body.platform` / `body.oauthCancelled` / `body.oauthRefreshFailed` 플래그로 직렬화. 정규식 메시지 매칭 금지 — UI는 `isOAuthCancelled` / `getOAuthErrorPlatform` 헬퍼로 분기. cancel 코드는 `isAtlassianCancellationCode` / `isGithubCancellationCode` / `isLinearCancellationCode` / `isNotionCancellationCode` 화이트리스트.

### 토큰 체인 resolve 룰

picker의 `resolveVarChain`은 `var()` 체인을 따라가며 어느 이름에서 멈출지 결정한다. 원칙: **디자인 토큰 이름은 보존, 컴포넌트 내부 alias는 펼침**.

- **공용(public) 토큰** (`--radius-xxl`, `--color-text-semantic`, `--spacing-14` 등): 처음 만나는 이름에서 멈춘다. 원시 > 시맨틱 구조에서 시맨틱이 원시를 참조해도(`--color-text-semantic: var(--color-gray-scale-900)`) 시맨틱 이름이 그대로 노출된다.
- **private alias** (`--_xxx` 언더스코어 prefix 컨벤션): 리터럴까지 끝까지 펼친다. 컴포넌트 내부 임시변수(`--_padding: var(--spacing-14)`, `--_size: 40px`)는 실제 참조 토큰/값으로 대체.

조합 예:
- `padding: var(--_padding)` + `--_padding: var(--spacing-14)` → 노출: `var(--spacing-14)`
- `color: var(--color-text-semantic)` + `--color-text-semantic: var(--color-gray-scale-900)` → 노출: `var(--color-text-semantic)`
- fallback `var(--x, var(--y))` — primary 정의 없으면 fallback의 이름으로 resolve 시도, 규칙은 동일.

### CSSOM shorthand 한계 우회 (Raw CSS Cache)

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

### DOM 트리 Lazy Load

DOM 트리 Dialog(`IssueTab.tsx`의 `DomTree`)는 큰 페이지에서 전체 DOM을 한 번에 직렬화하면 프리즈된다. 그래서 두 단계로 동작:

1. **초기 트리 (`picker.describeInitial`)**: `body`부터 현재 선택된 요소까지의 **조상 경로**와 각 레벨의 **sibling**만 내려준다. `{ tree, ancestorPath[] }`.
2. **자식 온디맨드 (`picker.describeChildren`)**: 유저가 노드를 펼칠 때 `{ selector }`로 요청, 해당 노드의 자식만 추가 로드 → `injectChildren`으로 트리에 머지.

노드의 `childCount > 0 && children === undefined`면 "아직 안 불러온 상태"로 간주하고 토글 시 fetch. 한 번 로드한 자식은 캐시.

### 마크다운 복사 (Preview)

Jira는 마크다운 원본을 파싱하지 않고, 붙여넣기는 **ProseMirror가 HTML을 해석**한다. 그래서 `ClipboardItem`으로 `text/plain` + `text/html` **둘 다** 쓴다.

- `text/plain`: GFM 파이프 테이블 포함 MD (Slack/Gmail fallback)
- `text/html`: `<h1>/<h2>/<p>/<table>` — Jira·Notion·Confluence가 네이티브 테이블로 변환
- base64 이미지는 Jira가 sanitize하므로 클립보드 출력에서 **제외**

구현: `src/sidepanel/lib/buildIssueMarkdown.ts` — `buildIssueMarkdown()` + `buildIssueHtml()` 페어.

### 이슈 섹션 구성 (설정 탭 → 이슈 설정)

사용자 입력 섹션은 **설정 탭에서 on/off 가능**한 4종 빌트인. `settings-ui-store`의 `IssueSection[]` (`DEFAULT_ISSUE_SECTIONS`) 배열 순서가 곧 출력 순서.

| id | 기본 enabled | renderAs |
|---|---|---|
| `description` (발생 현상) | ✅ | paragraph |
| `stepsToReproduce` (재현 과정) | ✅ | orderedList |
| `expectedResult` (기대 결과) | ✅ | paragraph |
| `notes` (비고) | ⬜ | paragraph |

draft 데이터 모델은 `{ title, sections: Record<string, string> }`. 섹션 마다 newline-joined 평문. `stepsToReproduce`는 줄별 Input + Trash2 IconButton의 `OrderedListEditor` 전용 UI; 그 외는 plain Textarea.

**자동 메타 위치**: `POST_MEDIA_SECTION_IDS = {"expectedResult","notes"}` — enabled iterate 중 첫 POST_MEDIA 섹션을 만나면 그 직전에 media/styleChanges 블록 emit. 둘 다 disabled면 모든 섹션 끝에 emit. `buildIssueMarkdown` / `buildIssueHtml` / `buildIssueAdf` / `DraftingPanel` / `PreviewPanel` / `DraftDetailDialog` 5곳에서 동일 룰. 라벨 i18n 헬퍼는 `sectionLabelKey` / `sectionMdLabelKey` / `sectionPlaceholderKey` / `sectionHelpKey` (`settings-ui-store`).

**마이그레이션 3중 가드**: `issues-store` v3, `settings-ui-store` v2, `useEditorSessionSync.migrateLegacyDraft` — 세 곳 모두 `if (legacy.sections)` 멱등 가드 + sparse 저장(빈 legacy 값은 sections에 키 추가 안 함). 빈 paragraph 섹션 출력은 마크다운/HTML/ADF 모두 `(없음)` (`md.noValue`)로 통일.

**플랫폼 마이그레이션** (별도 트랙):
- `settings-store` v2→v3: `jiraConfig` → `accounts: { jira?, github? }` + `lastSubmitFields` → `Record<PlatformId, ...>`. `migrateV2ToV3` pure helper export — 단위 테스트 표적. 멱등 가드.
- `settings-store` v3/v4→v5: 각 플랫폼 account에 있던 `titlePrefix`를 전역 `titlePrefix: string`으로 승격. `migrateToV5` pure helper export. jira → github → linear 순 우선순위로 기존 값 추출, 없으면 빈 문자열.
- `settings-store` v5→v6: notion 플랫폼 추가 마커. `accounts.notion` / `lastSubmitFields.notion`은 모두 optional이라 데이터 마이그레이션 불필요 — 버전만 bump.
- `issues-store` v3→v4: `IssueRecord`에 `platform: PlatformId` 필수 추가. 기존 entry는 `"jira"`로 채움. `migrateIssueToV4`는 `issues-migrations.ts`로 분리(테스트가 issues-store 본체를 import하면 picker-control→i18n→settings-ui-store→navigator 트랜시티브 로드 발생 — pure helper 분리로 회피).
- `issues-store` v4→v5: notion 한정 optional 메타(`notionPageId`/`notionDatabaseId`/`notionDatabaseTitle`/`notionStatusOption`) 추가 마커. 데이터 마이그레이션 불필요.

## 릴리스 & 버전

### 버전 체계

semver(`MAJOR.MINOR.PATCH`). `package.json`의 `version`이 manifest에 자동 반영된다. Chrome 웹스토어는 업로드마다 버전이 올라가야 하므로 **`/merge` 단계에서 dev에 bump 커밋을 얹어 PR에 포함**시키고, squash로 main에 들어간 뒤 `/deploy`가 그 버전을 가리키는 tag만 별도 push한다.

```bash
pnpm version patch --no-git-tag-version   # 1.0.0 → 1.0.1 (버그 수정)
pnpm version minor --no-git-tag-version   # 1.0.0 → 1.1.0 (기능 추가)
pnpm version major --no-git-tag-version   # 1.0.0 → 2.0.0 (Breaking change)
```

`--no-git-tag-version`이 핵심. 자동 commit/tag를 막고 직접 commit 메시지를 통제하며, tag는 **dev HEAD가 아닌 main의 squash 커밋을 가리켜야 의미가 있으므로** `/deploy`에서 찍는다.

### 브랜치 정책

- 작업 브랜치: **`dev`** — 자유롭게 push (force push 허용).
- 메인 브랜치: **`main`** — 브랜치 프로텍션 적용. 직접 push 금지, PR squash 머지만 허용(linear history 강제). approval 0이라 1인 셀프 머지 OK. 버전 commit은 PR을 통해 들어오고 tag push는 ref 종류가 달라 보호 규칙과 무관하므로, **보호 우회가 필요한 시점이 없다**.

### 워크플로우 (스킬 라인업)

```
/feature     → 기능 아이디어 → PRD·기술 설계·태스크 문서 산출 (코딩 안 함)
/tdd         → 테스트만 작성 (구현·픽스·커밋 안 함). interface 모드(신규 헬퍼 시그니처) / regression 모드(리뷰 발견 회귀 테스트)
/pull        → dev 최신 받고 작업 맥락 브리핑
/build       → pnpm build + 테스트 체크리스트 (작업 중 검증)
/code-review → origin/main 대비 변경 코드 시급도별 리포트 (리포트 전용, fix·빌드·커밋 안 함)
/push        → dev push (main에서 호출 차단)
/merge       → dev에서 버전 bump 커밋 + dev → main squash PR 생성 + 자동 머지
/deploy      → main 한정. tag push → 스토어 빌드 → zip → GitHub Release draft → 심사 요청 안내
/sync        → dev를 origin/main으로 hard reset + force push (배포/머지 후)
```

권장 흐름: `/feature` → `/tdd interface` → 구현 → `/code-review` → `/tdd regression` → 픽스/리팩터 → `/push`. `/tdd` 분류표(스킬 정의 안)에 따라 컴포넌트·OAuth·DOM 측정 같은 영역은 스킵 OK.

각 단계 게이트는 `.claude/commands/` 스킬 정의에 명시.

### 문서 신선도

`/push`는 항상 README / CLAUDE.md 신선도 검사를 거친다. 아래 중 하나라도 해당하면 문서 갱신을 별도 커밋(`docs(CLAUDE): ...` / `docs(README): ...`)으로 묶어 함께 푸시:

- 새 디렉터리·파일 추가/삭제 (특히 `src/` 하위 구조 변화)
- `package.json` scripts 변경
- `manifest.config.ts` 변경 (권한·명령어·스킴)
- 새 하위 시스템·아키텍처 핵심 파일 큰 변경
- 새 컨벤션·게이트웨이 도입
- 기능 추가/삭제로 README의 사용법·기능 설명이 어긋남
- 워크플로우/스킬 라인업 변경

## 코드 컨벤션

- 스타일: `src/components/ui/` 이외에 주석 최소화. WHY가 비자명할 때만 한 줄.
- 경로: `@/` → `src/`
- **UI 컴포넌트**: 직접 스타일링 금지. shadcn/ui 컴포넌트를 우선 사용하고, 없으면 `npx shadcn@latest add <component>`로 설치해서 사용. 설치 후 `src/components/ui/`에 위치 확인 필수 (shadcn이 `@/` 루트에 생성할 수 있음)
- Tailwind: shadcn CSS 변수 사용, 커스텀 색상 남발 금지
- 버튼 사이즈: CTA는 `default`(h-9) 통일. `xl`(`h-11 px-10 text-base`)은 랜딩/온보딩 등 특수 CTA 전용
- 커밋 메시지·PR title/body·GitHub Release notes는 **영문**으로 작성
- IconButton 사이즈: 패널/섹션 헤더·액션은 `h-8 w-8` (32px), Input·Textarea 우측에 직접 붙는 경우(LinkToggle, OrderedListEditor 행 삭제 등)만 `h-9 w-9` (36px, 필드 높이와 맞춤). 일관성 위해 새로 추가 시 동일하게.
- 탭 컨텐츠: `data-[state=inactive]:hidden` 필수 (비활성 탭 동시 렌더 버그 방지)
- **테스트**: 코드 변경 시 관련 순수 함수의 단위 테스트 작성 + `pnpm test` 통과 확인 필수. 테스트 파일은 대상과 같은 디렉터리의 `__tests__/*.test.ts`에 위치. Vitest 사용.

## 게이트웨이 (알아두면 유용)

- 매니페스트 `minimum_chrome_version: "116"` — sidePanel API 요구사항
- 지원 URL: `http:`, `https:`, `file:` 스킴만. 추가로 `chromewebstore.google.com` 전체와 `chrome.google.com/webstore/*` 트리는 Chrome이 content script 주입을 차단해서 `src/lib/url-support.ts`의 `isSupportedUrl()`이 미지원으로 처리. 그 외 페이지에서는 side panel을 enable하지 않고, 사용 중 race로 unsupported로 진입하면 picker가 `onPickerUnavailable` 이벤트를 발화해 안내 다이얼로그 노출.
- iframe 제약: content script가 `all_frames=false`라 iframe 내부 DOM은 picker로 선택 불가. iframe 박스 자체를 클릭하면 `picker.iframeUnsupported` → `onPickerIframeUnsupported` 이벤트로 안내 다이얼로그 노출 + picker 즉시 idle 복귀 (cross-document 경계 + 빈 결과로 인한 콘솔 에러 누적 방지).
- 단축키: `Cmd+Shift+E` (mac) / `Ctrl+Shift+E` (default) — `_execute_action`
- permissions: `sidePanel`, `activeTab`, `scripting`, `storage`, `commands`, `contextMenus`, `identity`, `tabCapture`
- host_permissions: `*.atlassian.net` (Jira REST), `api.atlassian.com` (OAuth gateway), `auth.atlassian.com` (authorize), `api.github.com` (GitHub REST), `api.linear.app` (Linear GraphQL + OAuth token), `api.notion.com` (Notion REST + OAuth token), + `VITE_OAUTH_PROXY_URL` origin (빌드 타임 주입)
- OAuth 관련 env: `VITE_ATLASSIAN_CLIENT_ID`, `VITE_GITHUB_CLIENT_ID` (dev), `VITE_GITHUB_CLIENT_ID_PROD` (store build 시 치환), `VITE_LINEAR_CLIENT_ID` (dev), `VITE_LINEAR_CLIENT_ID_PROD` (store build 시 치환), `VITE_NOTION_CLIENT_ID`, `VITE_OAUTH_PROXY_URL` — 누락 시 해당 플랫폼 OAuth UI 자동 비활성화 (`isOAuthConfigured()` / `isGithubOAuthConfigured()` / `isLinearOAuthConfigured()` / `isNotionOAuthConfigured()`)
- `BUGSHOT_STORE_BUILD=1`: 스토어 업로드용 빌드 (manifest `key` 제거)

## 메모리 & 참고 문서

- `docs/privacy.md` — 개인정보처리방침 (GitHub Pages로 공개)
- 사용자 개인 메모리: `~/.claude/projects/-Users-sinhyeokkang-code-bugshot-2/memory/`에 있음 (머신 로컬, git에 안 올라감)
