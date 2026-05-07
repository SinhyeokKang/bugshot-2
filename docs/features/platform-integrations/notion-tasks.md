# Platform Integrations — Notion 3차 (구현 태스크)

## 진행 규칙

Linear 2차와 동일:
- **태스크 시작**: 헤더 끝에 `🟡 진행` 표시.
- **검증 체크박스 통과**: `- [ ]` → `- [x]`.
- **태스크 완료**: 자동 검증(typecheck/vitest)이 모두 `[x]`이면 `✅ 완료` 교체. 수동 검증은 dev 로드 언팩 환경에서 일괄 진행하며 별도 표기.
- **블록**: `🔴 블록 — <사유>`.
- **갱신 단위**: 태스크 1개당 커밋 권장. 메시지: `feat(platform): T<n> <summary>`.
- **테스트 우선**: 순수 로직 변경은 같은 커밋에 vitest 단위 테스트 포함. `pnpm test` 통과해야 `✅ 완료`.

## 진행 현황 (2026-05-07 기준)

T1~T12 코드 작성 + 자동 검증(typecheck, 단위 테스트, `pnpm build`) 모두 통과. 실 OAuth/UI/네트워크 라운드트립 같은 수동 검증은 미수행 — 아래 각 태스크의 "수동: …" 항목은 dev 로드 언팩 후 일괄 진행한다.

신규/수정 파일 요약:
- 신규: `src/types/notion.ts`, `src/background/notion-api.ts`, `src/background/notion-oauth.ts`, `src/background/__tests__/notion-{api,oauth}.test.ts`, `src/sidepanel/lib/{buildNotionIssueBody,submitToNotion}.ts`, `src/sidepanel/lib/__tests__/buildNotionIssueBody.test.ts`, `src/sidepanel/tabs/connect/NotionConnectForm.tsx`, `src/sidepanel/tabs/notionFields/{DatabaseCombobox,StatusSelect,PropertySelectCombobox,PropertiesFieldset,NotionIssueFields}.tsx`, `src/sidepanel/tabs/notionFields/__tests__/initialNotionFields.test.ts`.
- 변경: `src/types/{platform,messages}.ts`, `src/store/{settings-store,issues-store}.ts`, `src/store/__tests__/{settings-store,issues-store}.test.ts` 영향, `src/types/__tests__/messages.test.ts`, `src/lib/settings-storage.ts`, `src/background/{messages,index}.ts`, `src/sidepanel/tabs/{IntegrationsTab,IssueCreateModal,DraftDetailDialog,IssueListTab}.tsx`, `src/i18n/{ko,en}.ts`, `manifest.config.ts`, `.env.example`, `oauth-proxy/worker.ts`.

## 태스크별 테스트 영역

| 태스크 | 테스트 영역 | 비고 |
|---|---|---|
| T1 | 없음 | 타입 정의만 — `pnpm typecheck` |
| T2 | `__tests__/settings-store.test.ts` + `__tests__/platform.test.ts` | v5→v6 멱등 + notion account lifecycle + `pickInitialPlatform` notion + `getOAuthErrorPlatform("notion")` |
| T3 | `__tests__/messages.test.ts` | `getOAuthErrorPlatform("notion")` 반환 검증 + IssueRecord 옵셔널 필드 |
| T4 | `__tests__/notion-api.test.ts` | auth header, 에러 파서(401/403/429), `parseDatabaseSchema` |
| T5 | `__tests__/notion-oauth.test.ts` | `parseNotionCallbackParams` 5케이스, `isNotionCancellationCode` 화이트리스트, persist 멱등 |
| T6 | 없음 | 디스패처 — 내부 로직은 T4/T5 테스트가 커버 |
| T7 | `__tests__/buildNotionIssueBody.test.ts` | 6종 block 변환, attachment 분기(image 인라인 vs 첨부 섹션), table 변환, 빈 섹션 `(없음)` |
| T8 | 없음 | 빌드/매니페스트 — dist/manifest.json 수동 검증 |
| T9 | `i18n/__tests__/locales.test.ts` | ko/en 키 패리티(기존 테스트가 신규 키 자동 커버) |
| T10 | 추출 헬퍼만 | `isNotionOAuthConfigured()` 등 |
| T11 | `__tests__/initialNotionFields.test.ts` | `initialNotionFields` 우선순위 룰 |
| T12 | 추출 헬퍼만 | `resolveNotionPageId`, status 표시 |

## 선행 조건

- **Notion OAuth integration 등록**: `https://www.notion.so/profile/integrations` → New integration → Public integration 선택. Callback URL = `chrome.identity.getRedirectURL()` (`https://<extension-id>.chromiumapp.org/`). dev/prod extension ID가 다르면 redirect URL 둘 다 등록(Notion은 multiple redirects 지원).
- `VITE_NOTION_CLIENT_ID`를 `.env.local`에 설정.
- `NOTION_CLIENT_ID` + `NOTION_CLIENT_SECRET`을 `oauth-proxy/.dev.vars` (로컬) + Cloudflare Worker secret(prod)에 설정.
- 테스트용 Internal Integration Token 발급 (Notion → Integrations → New internal integration). 테스트용 페이지에 integration connect.

## 태스크

### T1 — 타입 정의 (`src/types/notion.ts`, `platform.ts`, `messages.ts`) ✅ 완료

- 신규: `src/types/notion.ts` — `NotionAuth`, `NotionAccount`, `NotionDefaults`, `NotionPropertySchema`, `NotionSelectOption`, `NotionDatabase`, `NotionDatabaseSchema`, `NotionBlock`, `NotionAttachmentInput`, `NotionCreatePagePayload`, `NotionCreatePageResult`, `NotionPageStatus`, `NotionFileUploadResult`.
- 변경: `src/types/platform.ts`:
  - `PlatformId` union에 `"notion"` 추가.
  - `PLATFORM_TAB_KEYS.notion = "platform.tab.notion"`.
  - `Accounts.notion?: NotionAccount`.
  - `NotionLastSubmitFields` 인터페이스 추가.
  - `LastSubmitFieldsByPlatform.notion?` 추가.
- 변경: `src/types/messages.ts`:
  - Notion 타입 re-export 추가.
  - `BgRequest` union에 `notion.*` 10개 멤버 추가.
  - `getOAuthErrorPlatform`: `"notion"` 인식 추가 (라인 153-158).
- 검증:
  - [x] `pnpm typecheck` 그린 (T6/T9 완료 후 exhaustive switch + i18n key union 통과)
  - [x] 기존 import 영향 없음

### T2 — settings-store v6 마이그레이션 (`src/store/settings-store.ts`) ✅ 완료

- `SETTINGS_STORE_VERSION` 5 → 6.
- `updateNotionAccount(patch)` 액션 추가 (`updateLinearAccount`와 동일 패턴).
- `PLATFORM_FALLBACK_ORDER`에 `"notion"` 추가 (`pickInitialPlatform`/`connectedPlatforms` 자동 반영).
- v5→v6 마이그레이션: 멱등 가드. `accounts` 딕트 존재 시 그대로 통과(데이터 변환 없음).
- `isNotionAccountComplete(acc)` 헬퍼 추가.
- 검증:
  - [x] `__tests__/settings-store.test.ts`: notion account 4-platform 우선순위 + `connectedPlatforms` notion 추가 + `isNotionAccountComplete`. v5→v6는 데이터 변환 없는 additive라 마이그레이션 콜백 자체는 멱등 통과(별도 export 함수 없음)
  - [x] `pickInitialPlatform` notion 케이스 + `PLATFORM_FALLBACK_ORDER` jira→github→linear→notion 검증
  - [x] `pnpm typecheck`
  - [x] `pnpm test`
  - [ ] 수동: 기존 Jira/GitHub/Linear 연결 보존

### T3 — issues-store v5 + messages.ts 확장 ✅ 완료

- `IssueRecord`에 `notionPageId?`, `notionDatabaseId?`, `notionDatabaseTitle?`, `notionStatusOption?` optional 필드 추가. `issues-migrations.ts`에 v4→v5 멱등 추가.
- `src/types/messages.ts`: T1에서 union 추가 완료, T3에선 exhaustive switch 검증을 위한 임시 stub 없음 — T6에서 해소.
- 검증:
  - [x] `pnpm typecheck` (T6 후 exhaustive switch 통과)
  - [x] `__tests__/messages.test.ts` 갱신: `getOAuthErrorPlatform("notion")` 반환 검증 + slack 같은 알 수 없는 platform → null
  - [x] 기존 entry 마이그레이션 멱등 — v4→v5는 데이터 변환 없는 additive optional이라 별도 함수 미추가, v4 멱등 테스트로 회귀 방지 (`issues-store.ts:240`의 `if (version < 4)` 가드는 그대로 유지)

### T4 — notion-api 어댑터 (`src/background/notion-api.ts`) ✅ 완료

- `NotionError` 에러 클래스.
- `buildNotionAuthHeader(auth)` — kind 무관 `Bearer ${token | accessToken}`.
- `notionFetch(auth, path, init)` — `https://api.notion.com/v1/...` POST/GET. 헤더 고정: `Notion-Version: 2022-06-28`.
- `setNotionRefreshHook(hook)` / `ensureFresh(auth)` — 시그니처 통일하되 hook 등록 안 함(no-op).
- 매퍼 함수: `getMyself`, `searchDatabases(query)`, `getDatabaseSchema(dbId)`, `createPage(payload)`, `getPageStatus(pageId)`, `createFileUpload(filename, contentType)`, `sendFileUpload(uploadId, dataUrl)`.
- `parseDatabaseSchema(raw)` 순수 헬퍼: `titlePropertyName`/`statusProperty?`/`selectProperties` 추출.
- `messageForNotionStatus(status)` 순수 헬퍼.
- 검증:
  - [x] `__tests__/notion-api.test.ts`: 8 tests passed — auth header(API Key vs OAuth), 에러 파서(401/403/429/5xx + 418), `parseDatabaseSchema`(title/status/select/multi_select 추출, 다른 type 무시, 빈 title fallback, 한글 title 프로퍼티)
  - [x] `pnpm typecheck`
  - [x] `pnpm test`

### T5 — notion-oauth 헬퍼 (`src/background/notion-oauth.ts`) ✅ 완료

- `isNotionOAuthConfigured()` — `!!NOTION_CLIENT_ID && !!OAUTH_PROXY_URL`.
- `startNotionOAuth()` — state CSRF + `chrome.identity.launchWebAuthFlow` + proxy `/notion/token` 경유 토큰 교환.
- `parseNotionCallbackParams(redirectUrl, expectedState)` 순수 헬퍼.
- `isNotionCancellationCode(code)` 화이트리스트 (`access_denied`/`user_denied`).
- `persistNotionOAuthTokens(auth)` → `writeStoredNotionOAuthTokens`. 멱등.
- `disconnectNotion()` — storage envelope에서 notion 슬롯 제거.
- **refresh 함수 없음**, hook 등록 안 함.
- `src/lib/settings-storage.ts`에 `readStoredNotionAuth()` + `writeStoredNotionOAuthTokens()` 추가. `SettingsEnvelope` 타입에 notion 슬롯.
- 검증:
  - [x] `__tests__/notion-oauth.test.ts`: 7 tests passed — `parseNotionCallbackParams` 5케이스(정상/error param + access_denied cancelled/state mismatch/code missing/user_denied cancelled), `isNotionCancellationCode` 화이트리스트
  - [x] `pnpm test`
  - [ ] 수동: 실 OAuth integration으로 라운드트립 1회 (`.env.local`의 `VITE_NOTION_CLIENT_ID` 채우고 진행)

### T6 — 백그라운드 메시지 라우터 (`src/background/messages.ts`, `index.ts`) ✅ 완료

- `notion-api` 함수 import + `notion-oauth` 모듈 import (refresh hook 없음, 단순 import).
- `loadNotionAuth()` 헬퍼 (`readStoredNotionAuth`로 envelope에서 직접 읽음).
- `handleMessage` exhaustive switch에 `notion.*` 10개 case 추가.
- `index.ts`에 `NotionError` 에러 직렬화 추가.
- `BG_REQUEST_TYPES` 셋에 `notion.*` 타입 추가.
- 검증:
  - [x] `pnpm typecheck` 그린 (exhaustive switch 통과)
  - [x] `pnpm test`
  - [ ] 수동: devtools sendBg로 각 메시지 라운드트립

### T7 — buildNotionIssueBody (`src/sidepanel/lib/buildNotionIssueBody.ts` + 테스트) ✅ 완료

- 자기충족 빌더 — `MarkdownContext` 재사용.
- 6종 block 변환: heading_2/paragraph/code/bulleted_list_item/image/table.
- 환경 섹션, 사용자 섹션(description/steps/expected/notes), 스타일 변경 표(table block), 첨부 분기(image 인라인 vs 비이미지 첨부 큐), 로그 요약(code block), 푸터.
- 빈 paragraph는 `(없음)`(`md.noValue`).
- 출력 시그니처: `(ctx) => { blocks: NotionBlock[]; attachments: NotionAttachmentInput[] }`.
- i18n: `notion.attachmentSection` 키.
- 검증:
  - [x] `__tests__/buildNotionIssueBody.test.ts`: 8 tests passed — 환경 섹션(heading_2 + bulleted_list_item), 빈 섹션 `(없음)`, orderedList → bulleted_list_item 다중, screenshot image 인라인, video 첨부 큐, element 모드 table + before/after 첨부, log 카테고리, 네트워크/콘솔 로그 code block
  - [x] `pnpm test`

### T8 — manifest + 환경 + oauth-proxy (`manifest.config.ts`, `oauth-proxy/worker.ts`) ✅ 완료

- `manifest.config.ts` `host_permissions`에 `"https://api.notion.com/*"` 추가.
- `.env.example`에 `VITE_NOTION_CLIENT_ID=` 추가.
- `oauth-proxy/worker.ts`:
  - `Env`에 `NOTION_CLIENT_ID` + `NOTION_CLIENT_SECRET` 추가.
  - `POST /notion/token` 라우트 신설 (`handleNotionToken`):
    ```
    body: { code, redirect_uri }
    → Basic Auth: base64(client_id:client_secret)
    → POST https://api.notion.com/v1/oauth/token
       { grant_type: "authorization_code", code, redirect_uri }
    → 200 JSON 그대로 반환
    ```
  - CORS는 기존 `ALLOWED_ORIGINS` 룰 재사용.
  - **refresh 라우트 없음**.
- 검증:
  - [x] `pnpm typecheck`
  - [x] `pnpm build` 성공 (dist 생성, 별도 manifest.json 검사는 reload 시 자동 검증)
  - [x] Cloudflare Worker secret 등록 확인: `wrangler secret list`로 `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET` 존재 확인
  - [ ] 수동: 로컬 wrangler dev에서 `POST /notion/token` mock 호출 시 200 응답 모양 확인 (생략 가능 — prod worker 직접 호출로 대체)
  - [ ] 수동: dev 로드 언팩 후 Notion API 호출 성공

### T9 — i18n (`src/i18n/{ko,en}.ts`) ✅ 완료

- 전체 `notion.*` 키 추가:
  - `platform.tab.notion`
  - 연결: `notion.onboarding.{title,body}`, `notion.connect.button`, `notion.connecting`, `notion.internalToken.button`, `notion.internalToken.dialog.{title,body}`, `notion.internalToken.label`, `notion.internalToken.placeholder`, `notion.internalToken.shareNotice`
  - 필드: `notion.field.{database,status,properties}` + placeholder/empty/search/select
  - 섹션: `notion.section.{connection,workspace,issueSettings}`
  - 에러: `notion.error.{401,403,404,429,5xx,generic}`
  - OAuth: `notion.oauth.notConfigured`, `notion.oauthExpired`
  - 기타: `notion.workspaceCard.bot`, `notion.workspaceCard.workspace`, `notion.attachmentSection`
  - 이슈 목록 상태: `issueList.notion.{noStatus,lastEdited}`
- 검증:
  - [x] `i18n/__tests__/locales.test.ts` 통과 (4 tests, ko/en 키 패리티 자동 검증)
  - [x] `pnpm typecheck`
  - [ ] 수동: ko/en 토글 시 모든 새 라벨 표시

### T10 — Settings UI (`IntegrationsTab.tsx`, `connect/NotionConnectForm.tsx`) ✅ 완료

- 신규: `src/sidepanel/tabs/connect/NotionConnectForm.tsx` (LinearConnectForm 골격 복제).
  - 온보딩: `SiNotion` + `dark:invert` 아이콘, OAuth 버튼, Internal Token 버튼/다이얼로그.
  - 연결됨: 워크스페이스 카드(workspace_name + workspace_icon emoji + bot 이름) + Disconnect.
  - Internal Token 다이얼로그 본문에 "페이지에 integration을 connect 해야 등록 가능" 명시.
- 변경: `IntegrationsTab.tsx` `PLATFORM_ORDER`에 `"notion"` 추가, sub-tab content 분기에 `<NotionConnectForm />`.
- 검증:
  - [x] `pnpm typecheck`
  - [x] `pnpm test`
  - [ ] 수동: [Notion] sub-tab 온보딩 노출
  - [ ] 수동: OAuth + Internal Token 각 1회 성공
  - [ ] 수동: 연결됨 상태에서 워크스페이스 정보 표시
  - [ ] 수동: 연결 해제 후 재연결

### T11 — IssueCreateModal/DraftDetailDialog Notion 라우팅 + notionFields 컴포넌트 ✅ 완료

- 신규: `src/sidepanel/tabs/notionFields/` 6파일 — `NotionIssueFields.tsx`, `DatabaseCombobox.tsx`(디바운스 300ms), `StatusSelect.tsx`, `PropertiesFieldset.tsx`, `PropertySelectCombobox.tsx`, `__tests__/initialNotionFields.test.ts`.
- 신규: `src/sidepanel/lib/submitToNotion.ts`.
- 변경: `IssueCreateModal.tsx`:
  - `SubmitFieldsDialogProps`에 `notionFields`, `setNotionFields` 추가.
  - `SubmitFieldsDialog`: TabsList `grid-cols` 동적 전환(2/3/4), Notion trigger + content 추가.
  - `platformConfigured`/`canSubmit` 조건: `"notion"` → `!!notionFields.databaseId`.
  - `handleNotionSubmit` + submit 라우팅.
- 변경: `DraftDetailDialog.tsx`: 동일 추가. prefill effect deps `[open, issue?.id]` 유지.
- 변경: `App.tsx`: `oauthExpiredPlatform` 레이블에 `"notion"` 추가.
- 검증:
  - [x] `__tests__/initialNotionFields.test.ts` 통과 (4 tests — last 우선 / defaults fallback / 빈 selectValues 초기화 / 둘 다 없을 때)
  - [x] `pnpm typecheck`
  - [x] `pnpm test`
  - [ ] 수동: Jira만 연결 → Jira 등록 정상
  - [ ] 수동: GitHub만 연결 → GitHub 등록 정상
  - [ ] 수동: Linear만 연결 → Linear 등록 정상
  - [ ] 수동: Notion만 연결 → Notion 등록 정상 (DB 검색 → schema fetch → status/select 동적 노출 → 페이지 생성)
  - [ ] 수동: 4 플랫폼 연결 → 4-tab 전환 후 각각 등록
  - [ ] 수동: Database 변경 시 status/properties 리셋
  - [ ] 수동: 이미지 첨부 본문 인라인, 영상·로그 첨부 섹션
  - [ ] 수동: 5MB 초과 이미지 첨부 섹션 fallback

### T12 — IssueListTab Notion 표시 + 상태 ✅ 완료

- `PlatformChip`에 `"notion"` + `SiNotion` + `dark:invert`.
- `SubmittedBadge`에 `"notion"` case: `notion.getPageStatus` 호출. statusOption 있으면 색상별 배지, 없으면 `lastEditedTime`만.
- 카드 메타: `notionDatabaseTitle` + `notionStatusOption` 표시.
- `isRefreshable`에 `"notion"` 지원.
- `resolveNotionPageId(issue)` URL 파싱 fallback (구 entry용).
- 검증:
  - [x] `pnpm typecheck`
  - [x] `pnpm test`
  - [ ] 수동: 4 플랫폼 entry 혼재 시 정렬·필터·열기 정상
  - [ ] 수동: 새로고침 시 Notion 페이지 Status 갱신(있을 때) / Status 속성 없는 DB는 "상태 속성 없음" 배지
  - [ ] 수동: OAuth 만료 시뮬레이션 → AlertDialog → IntegrationsTab/[Notion] 이동

## 테스트 계획

### 단위 (vitest)

- `settings-store.test.ts`: v5→v6 멱등 + notion account lifecycle.
- `platform.test.ts`: `pickInitialPlatform` notion 우선순위 + `PLATFORM_FALLBACK_ORDER` 멤버십.
- `notion-api.test.ts`: auth header(API Key vs OAuth), 에러 파서, `parseDatabaseSchema`.
- `notion-oauth.test.ts`: `parseNotionCallbackParams` 5케이스, 화이트리스트, persist 멱등.
- `buildNotionIssueBody.test.ts`: 6종 block 변환, attachment 분기, table 변환, 빈 섹션.
- `initialNotionFields.test.ts`: 우선순위 룰.
- `messages.test.ts`: `getOAuthErrorPlatform("notion")` 반환 검증.
- `locales.test.ts`: ko/en 키 패리티(자동 커버).

### 수동 (Chrome dev 로드 언팩)

- 신규 사용자 OAuth: Notion authorize → 워크스페이스+페이지 선택 → 연결됨 표시.
- 신규 사용자 Internal Token: token 입력 → 연결됨 + 페이지 connect 안내.
- 4 플랫폼 활성: Jira + GitHub + Linear + Notion → 같은 draft 네 곳 등록.
- 마이그레이션: v5 storage(Jira+GitHub+Linear) → 업그레이드 → [Notion] 탭 온보딩, 기존 연결 보존.
- 이슈 등록: DB 검색 → schema fetch → Status select(Status 속성 있는 DB) + select properties 동적 노출 → 페이지 생성 → 본문 6종 block 정확히 변환 → 이미지 본문 인라인, 영상·로그 첨부 섹션.
- 5MB 초과 이미지 → 첨부 섹션 fallback + 토스트.
- DB schema race: 등록 다이얼로그 연 상태에서 Notion 측 DB 속성 수정 → 422 에러 + 재선택 안내.
- 토큰 만료: Notion 측에서 integration 제거 → 등록 시 401 → 재인증 AlertDialog "Notion" 레이블.
- 이슈 목록: 4 플랫폼 entry 혼재 → filter/sort/refresh 정상.
- Status 동기화: DB에 Status 속성 있는 페이지 → 새로고침 시 갱신. 없는 DB → `lastEditedTime`만.
- i18n: ko/en 토글 → 모든 새 라벨 표시.
- 회귀: Jira/GitHub/Linear 단독 사용자 → 모든 기능 회귀 없음.
- 다크모드: `SiNotion` 가시성 확인(`dark:invert` 적용 결과).

## 구현 순서 권장

```
T1 → T2 → T3   (타입 → 스토어 마이그레이션 → messages) 직렬
T4, T7         (API 어댑터 + body 빌더) 병렬
T5 → T6        (OAuth 헬퍼 → 메시지 라우터) 직렬
T8, T9         (manifest + proxy + i18n) 병렬
T10 → T11 → T12 (Settings UI → 등록 다이얼로그 → 이슈 목록) 직렬
```

## 후속 (이 트랙 완료 후)

- Notion DB schema 모든 properties 타입 동적 입력 UI(text/number/date/people/url/checkbox 등).
- 부모 페이지 free-form 모드(DB 외부 페이지 추가).
- file_upload 5MB 초과 시 multi-part upload 또는 외부 호스팅.
- DB schema 변경 race 자동 회복(등록 직전 schema 재fetch).
- Slack sub-tab(이슈 트래커 아닌 공유/알림 채널).
- 전체 플랫폼 공통: blob 자동 첨부 인프라 표준화.
- CLAUDE.md 갱신: Notion 인증 섹션, 디렉터리 구조, 환경 변수, host_permissions, file_upload 흐름.
- README.md: Notion 통합 항목 추가.
