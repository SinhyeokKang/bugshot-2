# Platform Integrations — Linear 2차 (구현 태스크)

## 진행 규칙

GitHub 1차와 동일:
- **태스크 시작**: 헤더 끝에 `🟡 진행` 표시.
- **검증 체크박스 통과**: `- [ ]` → `- [x]`.
- **태스크 완료**: 모든 검증 `[x]` 후 `✅ 완료` 교체.
- **블록**: `🔴 블록 — <사유>`.
- **갱신 단위**: 태스크 1개당 커밋 권장. 메시지: `feat(platform): T<n> <summary>`.
- **테스트 우선**: 순수 로직 변경은 같은 커밋에 vitest 단위 테스트 포함. `pnpm test` 통과해야 `✅ 완료`.

## 태스크별 테스트 영역

| 태스크 | 테스트 영역 | 비고 |
|---|---|---|
| T1 | 없음 | 타입 정의만 — `pnpm typecheck` |
| T2 | `__tests__/settings-store.test.ts` | v3→v4 멱등 + linear account lifecycle |
| T3 | `__tests__/messages.test.ts` | `getOAuthErrorPlatform("linear")` |
| T4 | `__tests__/linear-api.test.ts` | auth header, GraphQL error parser, 쿼리 매퍼 |
| T5 | `__tests__/linear-oauth.test.ts` | PKCE challenge, callback parser |
| T6 | 없음 | 디스패처 — 내부 로직은 T4/T5 테스트가 커버 |
| T7 | `__tests__/buildLinearIssueBody.test.ts` | body 구조, 첨부 섹션, 푸터 |
| T8 | 없음 | 빌드 산출 — dist/manifest.json 수동 검증 |
| T9 | `i18n/__tests__/locales.test.ts` | ko/en 키 패리티(기존 테스트가 신규 키 커버) |
| T10 | 추출 헬퍼만 | `isLinearOAuthConfigured()` 등 |
| T11 | 추출 헬퍼만 | `initialLinearFields` + 필드 merge |
| T12 | 추출 헬퍼만 | `resolveLinearCoords`, 상태 표시 |

## 선행 조건

- Linear OAuth Application 생성: `https://linear.app/settings/api/applications/new`. Callback URL = `chrome.identity.getRedirectURL()` (형식: `https://<extension-id>.chromiumapp.org/`).
- `VITE_LINEAR_CLIENT_ID`를 `.env.local`에 설정.
- 테스트용 Linear Personal API Key 발급 (Settings > Account > Security & Access > Personal API keys).

## 태스크

### T1 — 타입 정의 (`src/types/linear.ts`, `platform.ts` 변경) ✅ 완료

- 신규: `src/types/linear.ts` — `LinearAuth`, `LinearAccount`, `LinearDefaults`, `LinearMyself`, `LinearTeam`, `LinearProject`, `LinearLabel`, `LinearUser`, `LinearCreateIssuePayload`, `LinearCreateIssueResult`, `LinearIssueStatus`.
- 변경: `src/types/platform.ts` — `PlatformId`에 `"linear"` 추가, `Accounts.linear?`, `LinearLastSubmitFields`, `LastSubmitFieldsByPlatform.linear?`.
- 검증:
  - [x] `pnpm typecheck` 그린
  - [x] 기존 import 영향 없음

### T2 — settings-store v4 마이그레이션 (`src/store/settings-store.ts`) ✅ 완료

- `SETTINGS_STORE_VERSION` 3 → 4.
- `updateLinearAccount(patch)` 액션 추가 (`updateGithubAccount`와 동일 패턴).
- `pickInitialPlatform` fallback 순서에 `"linear"` 추가.
- v3→v4 마이그레이션: 멱등 가드. `accounts` 딕트 존재 시 그대로 통과(데이터 변환 없음).
- `isLinearAccountComplete(acc)` 헬퍼 추가.
- 검증:
  - [x] `__tests__/settings-store.test.ts`: v3 fixture → v4 passthrough(멱등), linear account set/remove round-trip
  - [x] `pnpm typecheck`
  - [x] `pnpm test`
  - [ ] 수동: 기존 Jira/GitHub 연결 보존

### T3 — issues-store + messages.ts 확장 ✅ 완료

- `IssueRecord`에 `linearIdentifier?`, `linearTeamKey?`, `linearLabelName?` optional 필드 추가. 버전 증가 불필요.
- `src/types/messages.ts`:
  - Linear 타입 re-export 추가.
  - `BgRequest` union에 `linear.*` 11개 멤버 추가.
  - `getOAuthErrorPlatform`에 `"linear"` 인식 추가.
- 검증:
  - [x] `pnpm typecheck`(T6에서 exhaustive switch 해소)
  - [x] `__tests__/messages.test.ts` 갱신: `getOAuthErrorPlatform("linear")` 반환 검증

### T4 — linear-api 어댑터 (`src/background/linear-api.ts`) ✅ 완료

- `LinearError` 에러 클래스.
- `buildLinearAuthHeader(auth)` — API Key: `${apiKey}`, OAuth: `Bearer ${accessToken}`.
- `linearGraphQL<T>(auth, query, variables)` — `https://api.linear.app/graphql` POST. HTTP 에러 + GraphQL errors 양쪽 핸들링.
- `setLinearRefreshHook(hook)` / `ensureFresh(auth)` — github-api.ts와 동일 refresh hook 패턴.
- 쿼리 함수: `getMyself`, `getTeams`, `getProjects(teamId)`, `getLabels(teamId)`, `getMembers(teamId)`, `createIssue(payload)`, `getIssueStatus(issueId)`.
- `extractLinearErrors(errors)` / `messageForLinearStatus(status)` 순수 헬퍼.
- 검증:
  - [x] `__tests__/linear-api.test.ts`: auth header(API Key vs OAuth), GraphQL error parser(200+errors, HTTP errors), 쿼리 결과 매핑, `extractLinearErrors`
  - [x] `pnpm typecheck`
  - [x] `pnpm test`

### T5 — linear-oauth PKCE 헬퍼 (`src/background/linear-oauth.ts`) ✅ 완료

- `isLinearOAuthConfigured()` — `!!LINEAR_CLIENT_ID` (proxy 체크 없음).
- `generatePkceChallenge()` — `code_verifier` + `code_challenge` 생성. 순수 함수.
- `startLinearOAuth()` — PKCE flow + `chrome.identity.launchWebAuthFlow` + **직접** 토큰 교환.
- `refreshLinearToken(auth)` — **직접** refresh, proxy 없음.
- `parseLinearCallbackParams(redirect, expectedState)` — 순수 헬퍼.
- `refreshOnceWithLock` + `setLinearRefreshHook(refreshOnceWithLock)` 모듈 사이드 이펙트.
- `src/lib/settings-storage.ts`에 `readStoredLinearAuth()` + `writeStoredLinearOAuthTokens()` 추가.
- 검증:
  - [x] `__tests__/linear-oauth.test.ts`: `parseLinearCallbackParams` 5 케이스 (정상 / error param / state mismatch / code missing / cancel), `generatePkceChallenge` (verifier 길이, challenge 포맷)
  - [x] `pnpm test`
  - [ ] 수동: 실 OAuth App으로 라운드트립 1회

### T6 — 백그라운드 메시지 라우터 (`src/background/messages.ts`, `index.ts`) ✅ 완료

- `linear-api` 함수 import + `linear-oauth` 모듈 import (사이드 이펙트 hook 등록).
- `loadLinearAuth()` 헬퍼 (`readStoredLinearAuth`로 envelope에서 직접 읽음).
- `handleMessage` exhaustive switch에 `linear.*` 11개 case 추가.
- `index.ts`에 `LinearError` 에러 직렬화 추가.
- `BG_REQUEST_TYPES` 셋에 `linear.*` 타입 추가.
- 검증:
  - [x] `pnpm typecheck` 그린 (exhaustive switch 통과)
  - [x] `pnpm test`
  - [ ] 수동: devtools sendBg로 각 메시지 라운드트립

### T7 — buildLinearIssueBody (`src/sidepanel/lib/buildLinearIssueBody.ts` + 테스트) ✅ 완료

- 자기충족 빌더 — `MarkdownContext` 재사용.
- GitHub과 동일 구조: 환경 섹션, 사용자 섹션(description/steps/expected/notes), 스타일 변경 표, 첨부 목록, 로그 요약, 푸터.
- `## Attachments` 섹션에 파일명 나열 + `linear.attachmentNotInline` 안내.
- base64 인라인 시도 없음 — 출력: `{ body: string }`.
- i18n: `linear.attachmentNotInline` 키.
- 검증:
  - [x] `__tests__/buildLinearIssueBody.test.ts`: body 구조(환경 섹션, 사용자 섹션, 첨부, 푸터), 로그 핸들링
  - [x] `pnpm test`

### T8 — manifest + 환경 (`manifest.config.ts`) ✅ 완료

- `host_permissions`에 `"https://api.linear.app/*"` 추가. `https://linear.app/*`는 불필요(`launchWebAuthFlow`가 authorize URL 처리).
- `.env.local`에 `VITE_LINEAR_CLIENT_ID=` 추가 (PKCE 설명 주석).
- 검증:
  - [x] `pnpm typecheck`
  - [x] 수동: `pnpm build` → dist/manifest.json에 `api.linear.app` 포함 확인
  - [ ] 수동: dev 로드 언팩 후 Linear API 호출 성공

### T9 — i18n (`src/i18n/{ko,en}.ts`) ✅ 완료

- 전체 `linear.*` 키 추가(T4~T7에서 점진 추가 + T9에서 UI 키 마무리):
  - `platform.tab.linear`
  - 연결: `linear.onboarding.{title,body}`, `linear.oauthLogin`, `linear.connecting`, `linear.apiKeyButton`, `linear.apiKeyDialog.{title,body}`, `linear.apiKeyLabel`, `linear.apiKeyPlaceholder`
  - 필드: `linear.field.{team,project,labels,assignee,priority}` + placeholder/empty/search/select 등
  - 섹션: `linear.section.{connection,team,issueSettings}`
  - 에러: `linear.error.{401,403,404,429,5xx,generic,graphql}`
  - OAuth: `linear.oauth.notConfigured`
  - 기타: `linear.viewerLogin`, `linear.attachmentNotInline`, `linear.field.requireTeam`
  - 이슈 목록 상태: `issueList.linear.{backlog,unstarted,started,completed,cancelled}`
- 검증:
  - [x] `i18n/__tests__/locales.test.ts` 통과 (ko/en 키 패리티)
  - [x] `pnpm typecheck`
  - [ ] 수동: ko/en 토글 시 모든 새 라벨 표시

### T10 — Settings UI (`SettingsTab.tsx`, `connect/LinearConnectForm.tsx`) ✅ 완료

- 신규: `src/sidepanel/tabs/connect/LinearConnectForm.tsx`. GithubConnectForm.tsx와 동일 구조.
  - 온보딩: `SiLinear` 아이콘, OAuth 버튼, API Key 버튼/다이얼로그.
  - 연결됨: 뷰어 카드, 기본 Team/Project 셀렉터, title prefix, Disconnect.
- 변경: `SettingsTab.tsx` — `grid-cols-2` → `grid-cols-3`, Linear 탭 trigger + content 추가.
- 검증:
  - [x] `pnpm typecheck`
  - [x] `pnpm test`
  - [ ] 수동: [Linear] sub-tab 온보딩 노출
  - [ ] 수동: OAuth + API Key 각 1회 성공
  - [ ] 수동: 연결됨 상태에서 뷰어 정보 + defaults 설정
  - [ ] 수동: 연결 해제 후 재연결

### T11 — IssueCreateModal/DraftDetailDialog Linear 라우팅 ✅ 완료

- 신규: `src/sidepanel/tabs/linearFields/` 6파일 — `LinearIssueFields.tsx`, `TeamCombobox.tsx`, `ProjectCombobox.tsx`, `LabelCombobox.tsx`, `AssigneeCombobox.tsx`, `PrioritySelect.tsx`.
- 신규: `src/sidepanel/lib/submitToLinear.ts`.
- 변경: `IssueCreateModal.tsx`:
  - `SubmitFieldsDialogProps`에 `linearFields`, `setLinearFields` 추가.
  - `SubmitFieldsDialog`: TabsList `grid-cols` 동적 전환(`availablePlatforms.length`), Linear trigger + content 추가.
  - `platformConfigured`/`canSubmit` 조건: `"linear"` 분기(`teamId` 필수).
  - `handleLinearSubmit` + submit 라우팅.
- 변경: `DraftDetailDialog.tsx`: 동일 추가.
- 변경: `App.tsx`: `oauthExpiredPlatform` 레이블에 `"linear"` 추가.
- 검증:
  - [x] `pnpm typecheck`
  - [x] `pnpm test`
  - [ ] 수동: Jira만 연결 → Jira 등록 정상
  - [ ] 수동: GitHub만 연결 → GitHub 등록 정상
  - [ ] 수동: Linear만 연결 → Linear 등록 정상
  - [ ] 수동: 세 플랫폼 연결 → 3-tab 전환 후 각각 등록
  - [ ] 수동: Team 변경 시 Project/Label/Assignee 리셋

### T12 — IssueListTab Linear 표시 + 상태 ✅ 완료

- `PlatformChip`에 `"linear"` + `SiLinear` 아이콘.
- `SubmittedBadge`에 `"linear"` case: `linear.getIssueStatus` 호출, state type별 색상(backlog/unstarted=default, started=blue, completed=green, cancelled=gray).
- 카드 메타: `linearIdentifier` + label name 표시.
- `isRefreshable`에 `"linear"` 지원.
- 검증:
  - [x] `pnpm typecheck`
  - [x] `pnpm test`
  - [ ] 수동: 세 플랫폼 entry 혼재 시 정렬·필터·열기 정상
  - [ ] 수동: 새로고침 시 Linear 이슈 상태/제목/라벨 갱신

## 테스트 계획

### 단위 (vitest)

- `settings-store.test.ts`: v3→v4 멱등 + linear account lifecycle.
- `linear-api.test.ts`: auth header(API Key vs OAuth), GraphQL error parser, 쿼리 매퍼.
- `linear-oauth.test.ts`: PKCE challenge 생성기, callback 파서.
- `buildLinearIssueBody.test.ts`: body 구조, 첨부 섹션, 로그 요약.
- `messages.test.ts`: `getOAuthErrorPlatform("linear")` 반환 검증.
- `locales.test.ts`: ko/en 키 패리티(기존 테스트가 자동으로 신규 키 커버).

### 수동 (Chrome dev 로드 언팩)

- 신규 사용자 OAuth PKCE: Linear 로그인 → Team 선택 → 이슈 1건 등록.
- 신규 사용자 API Key: 키 입력 → 이슈 1건 등록.
- 3개 플랫폼 활성: Jira + GitHub + Linear → 같은 draft 세 곳 등록.
- 마이그레이션: v3 storage(Jira+GitHub) → 업그레이드 → [Linear] 탭 온보딩, 기존 연결 보존.
- 토큰 갱신: 24시간 후(또는 수동 무효화) → 자동 refresh.
- 토큰 만료: refresh 실패 강제 → 재인증 AlertDialog에 "Linear" 레이블.
- 이슈 목록: 세 플랫폼 entry 혼재 → filter/sort/refresh 정상.
- i18n: ko/en 토글 → 모든 새 라벨 표시.
- 회귀: Jira 단독 사용자 → 모든 기능 회귀 없음.
- 회귀: GitHub 단독 사용자 → 모든 기능 회귀 없음.

## 구현 순서 권장

```
T1 → T2 → T3  (타입 → 스토어 마이그레이션 → messages) 직렬
T4, T7         (API 어댑터 + body 빌더) 병렬
T5 → T6        (OAuth 헬퍼 → 메시지 라우터) 직렬
T8, T9         (manifest + i18n) 병렬
T10 → T11 → T12 (Settings UI → 등록 다이얼로그 → 이슈 목록) 직렬
```

## 후속 (이 트랙 완료 후)

- Notion sub-tab(페이지/DB 라우팅 결정 별도).
- Slack sub-tab(이슈 트래커 아닌 공유/알림 채널).
- 전체 플랫폼 공통: blob 자동 첨부 인프라 결정.
- CLAUDE.md 갱신: Linear 인증 섹션, 디렉터리 구조, 환경 변수, host_permissions.
