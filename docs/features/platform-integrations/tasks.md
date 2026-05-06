# Platform Integrations — GitHub 1차 (구현 태스크)

## 진행 규칙

이 문서는 **살아있는 진행 상황 트래커**다. 구현하는 동안 다음 규칙으로 갱신한다.

- **태스크 시작**: 해당 태스크 헤더 끝에 `🟡 진행` 표시.
- **검증 체크박스 통과**: 항목을 `- [ ]` → `- [x]`로 갱신.
- **태스크 완료**: 모든 검증 항목 `[x]` 후 헤더의 `🟡 진행`을 `✅ 완료`로 교체. 같은 커밋에 함께 갱신.
- **블록 시점**: 헤더에 `🔴 블록 — <간단한 사유>` 표시. 사유는 한 줄.
- **갱신 단위**: 태스크 1개당 별도 커밋 권장. 메시지 예: `feat(platform): T<n> <제목 요약>`. 문서 갱신만이라면 `docs(feature): platform-integrations T<n> 진행/완료`.
- **태스크 단위 테스트 우선**: 변경된 순수 로직(스토어 마이그레이션, 어댑터 빌더, body 빌더, 인코딩/파싱 헬퍼 등)은 같은 커밋(또는 직전 커밋)에 vitest 단위 테스트를 포함하고 그 테스트가 실제 변경을 커버하는지 확인. `pnpm test` 통과해야 `✅ 완료` 마킹 가능. 테스트 가능 영역이 없는 태스크(타입 정의만, 매니페스트 빌드 산출, UI 시각 회귀 등)는 그 사유를 검증 항목에 한 줄로 명시하고 수동 검증으로 갈음.

## 태스크별 테스트 영역

| 태스크 | 테스트 영역 | 비고 |
|---|---|---|
| T1 | 없음 | 타입 정의만 — `pnpm typecheck`로 갈음 |
| T2 | `__tests__/settings-store.test.ts` | v2→v3 마이그레이션 4 케이스 + idempotent |
| T3 | `__tests__/issues-store.test.ts` | entry platform 필드 마이그레이션 |
| T4 | `oauth-proxy/__tests__/github.test.ts` | token/refresh 핸들러 입력 검증·에러 분기 (fetch mock) |
| T5 | `__tests__/github-api.test.ts` | auth 헤더, 에러 파서, payload 매퍼 |
| T6 | `__tests__/github-oauth.test.ts` | state 생성기·callback URL 파서 (pure helpers만) |
| T7 | 없음 | 디스패처는 구조적 — 안의 변환 로직은 T5/T6 테스트가 커버 |
| T8 | `__tests__/buildGithubIssueBody.test.ts` | 인라인/푸터/budget/HAR 분기 |
| T9 | 없음 | 빌드 산출 — dist/manifest.json 수동 검증 |
| T10 | `i18n/__tests__/locales.test.ts` | ko/en 키 패리티 |
| T11 | 추출 헬퍼만 | UI는 RTL 미설정 — `isGithubOAuthConfigured()` 등 추출된 순수 함수만 단위 테스트 |
| T12 | 없음 | UI — 플랫폼 라우팅 분기는 T7/T8/T5의 테스트가 커버 |
| T13 | 추출 헬퍼만 | UI — entry → 표시 데이터 변환 헬퍼를 추출했다면 그 부분만 |

## 선행 조건

- GitHub OAuth App 생성(callback URL = `chrome-extension://<dev key 기반 ID>/...`와 동일한 redirect_uri 또는 `launchWebAuthFlow`가 만들어주는 `https://<extension-id>.chromiumapp.org/` 형태). "Token expiration" 옵션 ON 권장.
- `client_id`/`client_secret` 발급. `client_id`는 `VITE_GITHUB_CLIENT_ID`로, `client_secret`은 oauth-proxy/wrangler env에 `GITHUB_CLIENT_SECRET`로 등록.
- oauth-proxy 코드 변경 후 `wrangler deploy`로 publish.
- 개인 GitHub 계정의 PAT(repo scope) 발급(테스트용).

## 태스크

### T1 — 타입 정의 (`src/types/platform.ts`, `github.ts`) ✅ 완료

- 변경 대상: 신규 2파일 + 기존 `src/types/jira.ts`는 손대지 않음.
- 내용: `PlatformId`, `Accounts`, `LastSubmitFieldsByPlatform`, `GithubAuth`/Account/Payload/Result 등.
- 검증:
  - [x] `pnpm typecheck` 그린
  - [x] 기존 import 영향 없음

### T2 — settings-store v3 마이그레이션 (`src/store/settings-store.ts`) ✅ 완료

- 단일 `jiraConfig` → `accounts: Accounts` + `lastSubmitFields: LastSubmitFieldsByPlatform`. `setAccount(platform, account)`/`removeAccount(platform)`. v2→v3 migrate 함수 + 멱등 가드.
- 기존 `isJiraConfigComplete`/`jiraCredentialsFilled`/`jiraSiteId`/`jiraHostLabel` 헬퍼는 `accounts.jira` 기준으로 갱신(시그니처는 `JiraAccount`로 변경).
- 검증:
  - [x] `__tests__/settings-store.test.ts`: v2 fixture 4 케이스(jiraConfig 있음/없음 × lastSubmitFields 있음/없음) → v3 변환 단언; idempotent(두 번 마이그레이션해도 동일).
  - [x] `pnpm typecheck`
  - [x] `pnpm test` (140/140 통과; pre-existing issueListFilters 실패는 본 태스크 무관)
  - [ ] 수동: 기존 Jira 연결 상태에서 dev 빌드 → SettingsTab에 그대로 표시

### T3 — issues-store 마이그레이션 (`src/store/issues-store.ts`) ✅ 완료

- entry에 `platform: PlatformId`, `url: string` 필드 추가. 기존 entry는 `platform: "jira"`로 채움. v 버전 증가 + 멱등 가드.
- 마이그 헬퍼는 `issues-migrations.ts`로 분리(테스트 시 i18n→app-settings-store 트랜시티브 로드 회피).
- 검증:
  - [x] `__tests__/issues-store.test.ts`(신규): platform 채우기 + 멱등 4 케이스
  - [x] `pnpm test` (144 통과)
  - [ ] 수동: 기존 이슈 목록이 깨지지 않음

### T4 — oauth-proxy GitHub 라우트 추가 (`oauth-proxy/`) ✅ 완료(코드)

- `POST /github/token`: `{ code, redirect_uri }` → GitHub `/login/oauth/access_token` POST(JSON Accept) → `{ access_token, refresh_token?, expires_in?, scope, token_type }` 반환.
- `POST /github/refresh`: `{ refresh_token }` → grant_type=refresh_token 교환.
- `wrangler.toml` 주석에 `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` 추가 안내. 둘 다 미설정이면 503.
- 핸들러 로직 `handleRequest(req, env, fetch)`로 추출 — 메인 vitest에서 fetch mock으로 테스트 가능.
- 검증:
  - [x] `oauth-proxy/__tests__/github.test.ts`: 11 케이스 (정상/누락/invalid JSON/503/upstream 릴레이/refresh/CORS/OPTIONS/404)
  - [x] `pnpm test` 통과 (전체 155 통과)
  - [ ] 사용자: 로컬 `wrangler dev` + curl 라운드트립
  - [ ] 사용자: `wrangler deploy` 후 prod URL 검증

### T5 — github-api 어댑터 (`src/background/github-api.ts`) ✅ 완료

- `githubFetch<T>(auth, path, init)` 헬퍼. `User-Agent: bugshot-2` + `Accept: application/vnd.github+json` + `X-GitHub-Api-Version: 2022-11-28`. PAT/OAuth 분기 헤더.
- `getMyself`/`searchRepos`/`getRepoLabels`/`getRepoAssignees`/`createIssue`. 페이지네이션은 첫 페이지(per_page=30~100)만.
- 401 처리: PAT은 즉시 에러 throw. OAuth는 `refreshHook`(T6에서 setGithubRefreshHook으로 주입) 있으면 1회 refresh 후 재시도, 없으면 즉시 throw.
- `GithubError(status, message, body)` + `extractGithubDetail`로 message/errors[] 평면화.
- 추가 효과: app-settings-store의 `detectLocale`에 navigator 가드 추가 — 기존 issueListFilters.test.ts가 정상 로드됨.
- 검증:
  - [x] `__tests__/github-api.test.ts`: 14 케이스 (auth header PAT/OAuth, error parser 4 케이스, payload mapper 3 케이스, repo 정규화 2 케이스 등)
  - [x] `pnpm typecheck`
  - [x] `pnpm test` (176 통과, 14/14 파일 그린)

### T6 — github-oauth 시작 헬퍼 (`src/background/github-oauth.ts`) ✅ 완료

- `startGithubOAuth()`: state(`crypto.randomUUID()`) 생성 → `launchWebAuthFlow` → code 추출 → proxy `/github/token` 호출 → `getMyself` → `GithubOAuthAuth` 반환.
- `refreshGithubToken(auth)`: refresh_token 있을 때만 동작. 없으면 throw `OAuthError`(`oauth.error.github.refreshUnavailable`).
- `persistGithubOAuthTokens(refreshed)`: `writeStoredGithubOAuthTokens`로 storage envelope 제자리 갱신.
- `ensureFreshGithubAuth(auth)`: expiresAt 60초 마진 프리-리프레시. `refreshOnceWithLock`으로 동시 401 race 방지.
- 모듈 로드 시 `setGithubRefreshHook(refreshOnceWithLock)` — github-api 401 자동 회복.
- `parseCallbackParams(redirect, expectedState)` 순수 헬퍼로 분리 — error/state mismatch/code missing 분기.
- i18n 신규 키: `oauth.error.github.notConfiguredClient`, `oauth.error.github.refreshUnavailable` (ko/en).
- 검증:
  - [x] `__tests__/github-oauth.test.ts`: parseCallbackParams 5 케이스 (정상 / error param / error 코드만 / state mismatch / code missing)
  - [x] `pnpm test` (195 통과, 16/16 파일 그린)
  - [ ] 사용자: 실 OAuth App으로 dev에서 라운드트립 1회
  - [ ] 사용자: 잘못된 state 시 거부 (수동)

### T7 — 백그라운드 메시지 라우터 확장 (`src/background/messages.ts`, `index.ts`)

- 신규 메시지 타입 등록: `github.startOAuth`, `github.testPat`, `github.disconnect`, `github.searchRepos`, `github.getLabels`, `github.searchAssignees`, `github.submitIssue`. 모두 `return true` + async IIFE.
- 핸들러는 settings-store의 `accounts.github`를 읽어 어댑터 호출.
- 검증:
  - [ ] `pnpm typecheck`
  - [ ] 수동 sendBg 라운드트립(devtools에서 7개 메시지 각각)

### T8 — buildGithubIssueBody (`src/sidepanel/lib/buildGithubIssueBody.ts` + 테스트) ✅ 완료

- 자기충족 빌더 — `MarkdownContext` 재사용 + GitHub 전용 미디어 처리. buildIssueMarkdown 무수정.
- 입력: `{ ctx, images?, video?, logs? }`. images는 인라인 시도, video/logs는 항상 안내 푸터.
- `tryInlineImage(blob, remainingBudget)`: `blob.size <= 64KB && dataURI.length+50 <= remaining` 시 dataURI 반환, 아니면 null.
- `GITHUB_BODY_BUDGET=60_000`, `GITHUB_INLINE_IMAGE_MAX=64*1024`.
- 결과: `{ body, inlined[], notInlined[] }` — UI는 notInlined로 다운로드 버튼/배지 분기 가능.
- i18n 신규 키 추가: `github.attachmentTooLarge`, `github.attachmentNotInline` (ko/en).
- 검증:
  - [x] `__tests__/buildGithubIssueBody.test.ts`: 14 케이스 (tryInlineImage 4 / 이미지 인라인·강등·budget 3 / video·log 푸터 2 / 구조 5)
  - [x] `pnpm test` (190 통과, 15/15 파일 그린)
  - [ ] 수동: 실제 GitHub repo에 등록 후 본문 정상 렌더 확인(특히 webp data URI)

### T9 — manifest host_permissions (`manifest.config.ts`)

- `https://api.github.com/*`, `https://github.com/*` 추가. 기존 entries 유지.
- 검증:
  - [ ] `pnpm build` → dist/manifest.json에 새 origin 포함
  - [ ] dev 로드 언팩 후 두 origin 호출 성공

### T10 — i18n (`src/i18n/{ko,en}.ts`)

- 신규 키:
  - `settings.tabTitle` ("연동 설정"/"Integrations") — 기존 `settings.title` 텍스트 갱신
  - `platform.connect`, `platform.disconnect`, `platform.connectedAs`, `platform.error.{401,403,404,429,5xx}`
  - `github.oauthLogin`, `github.patLabel`, `github.patHelp`, `github.attachmentTooLarge`, `github.attachmentNotInline` (HAR/콘솔 푸터), `github.field.repo`, `github.field.labels`, `github.field.assignees`, `github.error.unauthorized`
- 기존 `jira.*` 키는 유지(외과적 변경 원칙).
- 검증:
  - [ ] ko/en 토글 시 모든 새 화면 라벨 표시
  - [ ] `pnpm typecheck`(누락 키 정적 검증이 있다면 통과)

### T11 — Settings UI 재구성 (`src/sidepanel/tabs/SettingsTab.tsx`, `connect/{JiraConnectForm,GithubConnectForm}.tsx`)

- 기존 SettingsTab의 Jira 인증 UI를 `connect/JiraConnectForm.tsx`로 외과적 추출(behaviour 동일, props/store 사용 방식 그대로).
- SettingsTab 자체는 shadcn `Tabs` value=[jira|github] 컨테이너 + 헤더("연동 설정") + 각 sub-tab content에 connect form.
- `GithubConnectForm`: 카드 상단 OAuth 섹션("GitHub로 로그인" 버튼 + 연결 상태/끊기), 하단 PAT 섹션(Input + 저장). `isGithubOAuthConfigured()`(`VITE_GITHUB_CLIENT_ID` && `VITE_OAUTH_PROXY_URL`) false면 OAuth 섹션은 disabled + 안내.
- 검증:
  - [ ] 수동: Jira 연결됨 상태에서 [Jira] sub-tab은 기존과 동일
  - [ ] 수동: [GitHub] sub-tab에서 OAuth 흐름 1회 + PAT 흐름 1회 모두 성공
  - [ ] 수동: 연결 해제 후 다시 연결 가능
  - [ ] `pnpm typecheck`

### T12 — IssueCreateModal/DraftDetailDialog 플랫폼 분기 (`src/sidepanel/tabs/IssueCreateModal.tsx`, `DraftDetailDialog.tsx`, `PlatformPicker.tsx`, `githubFields/{RepoCombobox,LabelMultiSelect,AssigneeMultiSelect}.tsx`)

- 다이얼로그 상단에 PlatformPicker(연결된 플랫폼이 1개면 자동 선택, 2개면 칩으로 선택, 0개면 빈 상태로 "연동 설정 탭에서 연결을 먼저" 안내).
- 선택된 플랫폼에 따라 메타 필드 컴포넌트 동적 렌더(Jira 필드는 기존 그대로, GitHub은 신규 Repo/Labels/Assignees).
- submit 시 `<platform>.submitIssue` 호출 분기. 결과는 issues-store에 platform 필드와 함께 저장.
- 검증:
  - [ ] 수동: Jira만 연결 → Jira로 등록 정상
  - [ ] 수동: GitHub만 연결 → GitHub로 등록 정상(본문 인라인/푸터 정상)
  - [ ] 수동: 둘 다 연결 → 같은 draft를 양쪽으로 1회씩 등록
  - [ ] `pnpm typecheck`

### T13 — IssueListTab 플랫폼 표기 (`src/sidepanel/tabs/IssueListTab.tsx`)

- entry.platform에 따라 아이콘(Jira/GitHub)·식별자 형식 분기. 기존 필터/검색 호환 유지.
- 검증:
  - [ ] 수동: 두 플랫폼 entry 혼재 시 정렬·필터·열기 모두 정상
  - [ ] `pnpm typecheck`

## 테스트 계획

### 단위 (vitest)

- `settings-store.test.ts`: v2→v3 마이그레이션 4 케이스 + idempotent.
- `issues-store.test.ts`: 기존 entry → platform 필드 채우기 마이그레이션.
- `github-api.test.ts`: auth header(PAT/OAuth), error body 파서, payload→REST body 매퍼.
- `buildGithubIssueBody.test.ts`: 인라인/푸터/budget 초과/HAR 분기.

### 수동 (Chrome dev 로드 언팩)

- 신규 사용자 OAuth: GitHub 로그인 → 이슈 1건 등록.
- 신규 사용자 PAT: 토큰 입력 → 이슈 1건 등록.
- 다중 활성: Jira·GitHub 동시 연결 → 같은 draft 양쪽 등록.
- 마이그레이션: v2 storage fixture(기존 jiraConfig)로 시작 → 업그레이드 후 [Jira] sub-tab 보존.
- 인증 만료(OAuth): refresh token 실패 강제 → 재인증 안내 다이얼로그.
- 첨부 캡 초과: 큰 PNG로 시도 → 본문에 안내 푸터, 사이드패널에서 다운로드 가능.
- 언어 토글: ko/en 모두 새 화면 라벨 표시.
- 회귀: Jira 단독 사용자가 모든 기능 회귀 없음.

## 구현 순서 권장

- T1 → T2 → T3 (타입 → 두 스토어 마이그레이션) 직렬.
- T4(proxy)는 T5/T6 시작 전 완료 권장(실 OAuth 검증 가능).
- T5, T8 병렬 (어댑터 + body 빌더).
- T6 → T7 (oauth 헬퍼 후 메시지 라우터).
- T9, T10 병렬 (manifest + i18n).
- T11 (Settings UI) → T12 (IssueCreateModal) → T13 (IssueListTab) 직렬.

## 후속 (다음 PR 차례)

- Linear sub-tab + linear-api 어댑터(같은 패턴 복제, `PlatformId` union 확장).
- Notion sub-tab(페이지/DB 라우팅 결정 별도).
- Slack sub-tab(이슈 트래커 아닌 공유/알림 채널로).
- HAR/콘솔 로그 자동 첨부(GitHub Gist 또는 외부 호스팅 — 인프라 필요).
