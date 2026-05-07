# Platform Integrations — GitHub 1차 (구현 태스크) ✅ 완료 (2026-05-06)

T1~T13 코드 변경 모두 완료. T2~T13의 `[ ]` 수동 검증은 실 OAuth 라운드트립 시점에 사용자가 진행. Linear/Notion은 별도 트랙으로 분리 (각자 별 PRD/태스크 문서로 시작).

추가로 들어간 외과적 변경(이 문서 명시 외):
- GitHub `getIssueStatus` + `IssueRecord.{githubOwner, githubRepo, githubLabels}` — 새로고침 시 GitHub status/title/labels 갱신
- `IssueListTab` 카드 메타 재구성: `[플랫폼 chip] · 작성일 · 위치(host/repo) · 키 · 분류태그(issueType/labels)` (draft은 chip 빼고 `초안 · 작성일`)
- `buildGithubIssueBody` 인라인 폐기 → `## 첨부` 섹션 + `github.attachmentNotInline` 안내 (GitHub data: URI sanitize 한계 검증 결과)
- DraftDetailDialog의 platform Tab 전환 시 SubmitFieldsDialog가 닫히는 버그 fix (prefill effect deps 정정)
- github API fetch에 `cache: "no-cache"` (조건부 GET) — 새로고침 신선도 보장
- PreviewPanel guard 일반화 (`!jiraConfigured` → `connectedPlatforms === 0`) + 범용 `platform.empty.*` 문구
- IssueListTab/SettingsTab 헤더 패딩 통일 (`py-4`), DraftingPanel AI shimmer에 `backdrop-blur-[2px]` (Dialog/AlertDialog 패턴 적용)

후속 보류:
- GitHub blob 자동 첨부 — `PUT /repos/{o}/{r}/contents/{path}` + `raw.githubusercontent.com` 임베드 우회법 검토 결과 trade-off 큼. **Linear/Notion 끝낸 뒤 마지막에 결정.**

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

### T7 — 백그라운드 메시지 라우터 확장 (`src/background/messages.ts`, `index.ts`) ✅ 완료

- 신규 메시지 타입 등록 (총 9개): `github.oauth.available`, `github.startOAuth`, `github.testPat`, `github.disconnect`, `github.getMyself`, `github.searchRepos`, `github.getLabels`, `github.searchAssignees`, `github.submitIssue`. exhaustive switch — `_exhaustive: never` 가드 통과.
- 핸들러는 `loadGithubAuth()`(`readStoredGithubAuth`로 envelope에서 직접 읽음)로 인증 로드 후 어댑터 호출.
- `github-oauth.ts` import 자체로 `setGithubRefreshHook` 등록 (모듈 사이드 이펙트).
- types/messages.ts에 GithubCreateIssuePayload 등 7개 타입 re-export.
- i18n `github.notConnected` 추가 (ko/en).
- 검증:
  - [x] `pnpm typecheck` 그린 (exhaustive switch 통과)
  - [x] `pnpm test` 195 통과 (라우터 자체는 테스트 안 함 — 디스패처는 안의 변환 로직 T5/T6/T8 테스트가 커버)
  - [ ] 사용자: 실 OAuth deploy 후 9개 메시지 devtools sendBg 라운드트립

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

### T9 — manifest host_permissions (`manifest.config.ts`) ✅ 완료

- `https://api.github.com/*` (REST), `https://github.com/*` (OAuth authorize 페이지) 추가. 기존 atlassian entries + proxyMatch 유지.
- 검증:
  - [x] `pnpm typecheck` 그린
  - [ ] 사용자: `pnpm build` 후 dist/manifest.json에 새 origin 포함 확인
  - [ ] 사용자: dev 로드 언팩 후 두 origin 호출 성공

### T10 — i18n (`src/i18n/{ko,en}.ts`) ✅ 완료

- 추가 키 (T5/T6/T8/T9에서 점진 추가 + T10에서 UI 키 추가):
  - `app.tab.settings` 텍스트 변경: "Jira 연동" → "연동 설정" / "Jira" → "Integrations"
  - `platform.{tab.jira, tab.github, connect, disconnect, connectedAs, empty.title, empty.body}`
  - `github.{oauthLogin, connecting, patSection.title, patSection.help, patLabel, patPlaceholder, patSave, field.repo, field.repo.placeholder, field.labels, field.assignees, oauth.notConfigured, viewerLogin, attachmentTooLarge, attachmentNotInline, notConnected, error.401/403/404/422/429/5xx/generic}`
  - `oauth.error.github.{notConfiguredClient, refreshUnavailable}`
- 기존 `jira.*` 키 무수정.
- 검증:
  - [x] `__tests__/locales.test.ts` (신규): ko/en 키 패리티 + 빈 값 검사 + placeholder 토큰 일치 (4 케이스)
  - [x] `pnpm typecheck` 그린 (TranslationKey union이 정적으로 누락 검증)
  - [ ] 사용자: ko/en 토글 시 모든 새 화면 라벨 표시 확인

### T11 — Settings UI 재구성 (`src/sidepanel/tabs/SettingsTab.tsx`, `connect/{JiraConnectForm,GithubConnectForm}.tsx`) ✅ 완료

- `connect/JiraConnectForm.tsx`: 기존 SettingsTab의 Jira UI를 외과적 추출(behaviour 동일). PageShell 래퍼는 SettingsTab으로 이전, JiraConnectForm은 PageScroll/PageFooter만.
- `connect/GithubConnectForm.tsx`: 신규. OAuth + PAT 두 섹션을 단일 카드로. 빈 상태 → onboarding(OAuth 버튼 + PAT input + Save), 연결됨 → 뷰어 카드 + Disconnect.
  - `github.oauth.available` 메시지로 OAuth 사용 가능 여부 동적 체크 (env 미설정 시 OAuth 버튼 disabled + 안내)
  - PAT 저장 흐름: `github.testPat`로 viewer 검증 → setAccount("github", { auth: { kind: "pat", pat, viewerLogin } })
  - OAuth 흐름: `github.startOAuth` → GithubOAuthAuth 받아서 setAccount
  - DISMISS_PATTERNS로 사용자 취소는 에러 표시 안 함
- SettingsTab.tsx: shadcn `Tabs[jira|github]` 컨테이너 + PageShell 1회. data-[state=inactive]:hidden 적용.
- 검증:
  - [x] `pnpm typecheck` 그린
  - [x] `pnpm test` 199 통과 (UI는 RTL 미설정이라 단위 테스트 없음 — i18n 패리티 + store API + 메시지 라우팅으로 정합성 보장)
  - [ ] 사용자: Jira 연결됨 상태에서 [Jira] sub-tab은 기존과 동일 동작 확인
  - [ ] 사용자: [GitHub] sub-tab에서 OAuth + PAT 흐름 각 1회 성공
  - [ ] 사용자: 연결 해제 후 다시 연결 가능

### T12 — IssueCreateModal/DraftDetailDialog 플랫폼 분기 ✅ 완료

- 변경 대상: `IssueCreateModal.tsx`, `DraftDetailDialog.tsx`, `lib/submitToGithub.ts`(신규), `githubFields/{LabelMultiSelect,AssigneeMultiSelect,GithubIssueFields}.tsx`(신규/rename), `settings-store.ts`(`pickInitialPlatform`/`connectedPlatforms`/`lastSubmittedPlatform`).
- 다이얼로그 구성: 연결 1개 → 자동, 2개 → shadcn `Tabs`로 platform 선택. 0개 → [이슈 제출] 버튼 disabled (기존 게이트 일반화).
- 메타 필드: jira는 기존 IssueType/Assignee/Priority/Epic/Linked, github은 `GithubIssueFields`(Repo + Labels multi + Assignees multi). 라벨/담당자는 multi-select(`toggleLabel` 헬퍼 공유).
- submit 결과 통일: `NormalizedSubmitResult { key, url }` — Jira는 `BUG-1`, GitHub은 `#42`.
- prefill 룰: ghFields는 `lastSubmitFields.github` > `accounts.github.defaults` > 빈값. 다이얼로그 default platform은 `pickInitialPlatform(accounts, lastSubmittedPlatform)` (직전 제출 → jira → github 순).
- IssueCreateModal/DraftDetailDialog 모두 platform 변경 시 `patchIssue`로 `IssueRecord.platform` 갱신. submit 후 `setLastSubmittedPlatform`으로 다음 다이얼로그 default 결정.
- 검증:
  - [x] `pnpm typecheck`
  - [x] `pnpm test` 249 통과 (settings-store helper 7건, labelToggle 7건 등 신규 포함)
  - [ ] 수동: Jira만 연결 → Jira로 등록 정상
  - [ ] 수동: GitHub만 연결 → GitHub로 등록 정상(본문 인라인/푸터 정상)
  - [ ] 수동: 둘 다 연결 → Tabs로 전환 후 각각 1회씩 등록

### T13 — IssueListTab 플랫폼 표기 ✅ 완료

- 식별자 포맷 분기: Jira는 `[BUG-1]`(대괄호), GitHub은 `#42`(이미 # prefix가 키에 포함된 채로 저장). `formatIssueKey(issue)` 헬퍼로 추출.
- SubmittedBadge: jira는 jira.getIssueStatus 호출 + categoryKey 색상, github은 정적 "등록됨" 뱃지 (status 조회 미구현). refresh 카운트도 `i.platform === "jira"`만.
- 카드 아이콘 분기 등 추가 메타는 보류 — 키만으로 시각적 구분. 필요해지면 추가.
- 검증:
  - [x] `pnpm typecheck`
  - [x] `pnpm test` (formatIssueKey 3 케이스 + 기존 IssueList 필터 케이스)
  - [ ] 수동: 두 플랫폼 entry 혼재 시 정렬·필터·열기 모두 정상

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
