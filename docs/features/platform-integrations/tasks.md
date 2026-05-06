# Platform Integrations — GitHub 1차 (구현 태스크)

## 진행 규칙

이 문서는 **살아있는 진행 상황 트래커**다. 구현하는 동안 다음 규칙으로 갱신한다.

- **태스크 시작**: 해당 태스크 헤더 끝에 `🟡 진행` 표시.
- **검증 체크박스 통과**: 항목을 `- [ ]` → `- [x]`로 갱신.
- **태스크 완료**: 모든 검증 항목 `[x]` 후 헤더의 `🟡 진행`을 `✅ 완료`로 교체. 같은 커밋에 함께 갱신.
- **블록 시점**: 헤더에 `🔴 블록 — <간단한 사유>` 표시. 사유는 한 줄.
- **갱신 단위**: 태스크 1개당 별도 커밋 권장. 메시지 예: `feat(platform): T<n> <제목 요약>`. 문서 갱신만이라면 `docs(feature): platform-integrations T<n> 진행/완료`.

## 선행 조건

- GitHub OAuth App 생성(callback URL = `chrome-extension://<dev key 기반 ID>/...`와 동일한 redirect_uri 또는 `launchWebAuthFlow`가 만들어주는 `https://<extension-id>.chromiumapp.org/` 형태). "Token expiration" 옵션 ON 권장.
- `client_id`/`client_secret` 발급. `client_id`는 `VITE_GITHUB_CLIENT_ID`로, `client_secret`은 oauth-proxy/wrangler env에 `GITHUB_CLIENT_SECRET`로 등록.
- oauth-proxy 코드 변경 후 `wrangler deploy`로 publish.
- 개인 GitHub 계정의 PAT(repo scope) 발급(테스트용).

## 태스크

### T1 — 타입 정의 (`src/types/platform.ts`, `github.ts`)

- 변경 대상: 신규 2파일 + 기존 `src/types/jira.ts`는 손대지 않음.
- 내용: `PlatformId`, `Accounts`, `LastSubmitFieldsByPlatform`, `GithubAuth`/Account/Payload/Result 등.
- 검증:
  - [ ] `pnpm typecheck` 그린
  - [ ] 기존 import 영향 없음

### T2 — settings-store v3 마이그레이션 (`src/store/settings-store.ts`)

- 단일 `jiraConfig` → `accounts: Accounts` + `lastSubmitFields: LastSubmitFieldsByPlatform`. `setAccount(platform, account)`/`removeAccount(platform)`. v2→v3 migrate 함수 + 멱등 가드.
- 기존 `isJiraConfigComplete`/`jiraCredentialsFilled`/`jiraSiteId`/`jiraHostLabel` 헬퍼는 `accounts.jira` 기준으로 갱신(시그니처는 `JiraAccount`로 변경).
- 검증:
  - [ ] `__tests__/settings-store.test.ts`: v2 fixture 4 케이스(jiraConfig 있음/없음 × lastSubmitFields 있음/없음) → v3 변환 단언; idempotent(두 번 마이그레이션해도 동일).
  - [ ] `pnpm typecheck`
  - [ ] `pnpm test`
  - [ ] 수동: 기존 Jira 연결 상태에서 dev 빌드 → SettingsTab에 그대로 표시

### T3 — issues-store 마이그레이션 (`src/store/issues-store.ts`)

- entry에 `platform: PlatformId`, `url: string` 필드 추가. 기존 entry는 `platform: "jira"`로 채움. v 버전 증가 + 멱등 가드.
- 검증:
  - [ ] `__tests__/issues-store.test.ts`(있으면 확장; 없으면 신규)
  - [ ] `pnpm test`
  - [ ] 수동: 기존 이슈 목록이 깨지지 않음

### T4 — oauth-proxy GitHub 라우트 추가 (`oauth-proxy/`)

- `POST /github/token`: `{ code, redirect_uri }` → GitHub `/login/oauth/access_token` POST(JSON Accept) → `{ access_token, refresh_token?, expires_in?, scope, token_type }` 반환.
- `POST /github/refresh`: `{ refresh_token }` → grant_type=refresh_token 교환.
- `wrangler.toml`/secret에 `GITHUB_CLIENT_SECRET` 추가 안내.
- 검증:
  - [ ] 로컬 `wrangler dev` + curl로 두 엔드포인트 라운드트립
  - [ ] `wrangler deploy` 후 prod URL에서 동일 검증
  - [ ] 잘못된 code/refresh_token에 4xx 정상 반환

### T5 — github-api 어댑터 (`src/background/github-api.ts`)

- `githubFetch<T>(auth, path, init)` 헬퍼. `User-Agent: bugshot-2/<version>` + `Accept: application/vnd.github+json`. PAT/OAuth 분기 헤더.
- `getMyself`/`searchRepos`/`getRepoLabels`/`getRepoAssignees`/`createIssue`. 페이지네이션은 첫 페이지(per_page=100)만.
- 401 처리: PAT은 즉시 에러 throw; OAuth는 (refreshToken 존재 시) refresh 1회 후 재시도, 실패 시 OAuthError throw.
- 에러 클래스 `GithubError(status, message, body)`.
- 검증:
  - [ ] `__tests__/github-api.test.ts`: auth header 빌더, error body 파서, payload→REST body 매퍼.
  - [ ] `pnpm typecheck`
  - [ ] `pnpm test`

### T6 — github-oauth 시작 헬퍼 (`src/background/github-oauth.ts`)

- `startGithubOAuth()`: state(`crypto.randomUUID()`) 생성 → `launchWebAuthFlow` → code 추출 → proxy `/github/token` 호출 → `getMyself` → `GithubOAuthAuth` 반환.
- `refreshGithubToken(auth)`: refresh_token 있을 때만 동작. 없으면 throw `OAuthError`로 즉시 재인증 안내.
- `persistGithubOAuthTokens(refreshed)`: settings-store의 github account auth 갱신.
- 검증:
  - [ ] 수동: 실 OAuth App으로 dev에서 라운드트립 1회
  - [ ] 수동: 잘못된 state 시 거부

### T7 — 백그라운드 메시지 라우터 확장 (`src/background/messages.ts`, `index.ts`)

- 신규 메시지 타입 등록: `github.startOAuth`, `github.testPat`, `github.disconnect`, `github.searchRepos`, `github.getLabels`, `github.searchAssignees`, `github.submitIssue`. 모두 `return true` + async IIFE.
- 핸들러는 settings-store의 `accounts.github`를 읽어 어댑터 호출.
- 검증:
  - [ ] `pnpm typecheck`
  - [ ] 수동 sendBg 라운드트립(devtools에서 7개 메시지 각각)

### T8 — buildGithubIssueBody (`src/sidepanel/lib/buildGithubIssueBody.ts` + 테스트)

- `buildIssueMarkdown(ctx)` 베이스. media placeholder 토큰을 base64 인라인 이미지(webp) 또는 안내 푸터로 치환. 본문 누적 사이즈 budget(60,000 byte) 추적.
- 캡 헬퍼 `tryInlineImage(blob, remainingBudget)`: `blob.size <= 64*1024 && remainingBudget >= base64Size` 시 dataURI 반환, 아니면 null.
- HAR/console JSON은 무조건 본문 미포함, 안내 푸터에 한 줄.
- 검증:
  - [ ] `__tests__/buildGithubIssueBody.test.ts`: 작은 이미지 1장(인라인됨), 큰 이미지 1장(푸터로 강등됨), 누적 budget 초과(중간부터 푸터), HAR 첨부(항상 푸터), 빈 ctx.
  - [ ] `pnpm test`
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
