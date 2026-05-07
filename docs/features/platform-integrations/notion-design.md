# Platform Integrations — Notion 3차 (기술 설계)

## 개요

네 번째 플랫폼 어댑터. Linear와 구조는 동일하되 세 가지가 다르다: (1) **OAuth는 GitHub 패턴(proxy 경유, client_secret 보호)** — Notion은 PKCE 미지원. (2) **본문은 마크다운이 아니라 Notion blocks** — 6종(heading_2/paragraph/code/image/bulleted_list_item/table)으로 변환. (3) **첨부는 file_upload API 3-step 흐름** — 이미지는 본문 image block으로 인라인, 영상·로그·기타는 본문 끝 file block. 토큰은 long-lived bot token이라 refresh 라우트·hook 불필요.

## 변경 범위

### 신규 파일

- **`src/types/notion.ts`** — Notion 타입 정의.
  ```ts
  export interface NotionApiKeyAuth {
    kind: "apiKey";
    token: string;
    workspaceName?: string;     // /v1/users/me에서 추출 가능 시
    botName: string;
  }

  export interface NotionOAuthAuth {
    kind: "oauth";
    accessToken: string;
    botId: string;
    workspaceId: string;
    workspaceName: string;
    workspaceIcon?: string;
    ownerUserName?: string;
    botName: string;
    grantedAt: number;
    // refreshToken/expiresAt 없음 — Notion bot token은 long-lived
  }

  export type NotionAuth = NotionApiKeyAuth | NotionOAuthAuth;

  export interface NotionDefaults {
    databaseId?: string;
    databaseTitle?: string;
  }

  export interface NotionAccount extends PlatformAccountBase<"notion"> {
    auth: NotionAuth;
    defaults: NotionDefaults;
  }

  export interface NotionSelectOption { id: string; name: string; color: string; }

  export interface NotionPropertySchema {
    id: string;
    name: string;
    type:
      | "title" | "status" | "select" | "multi_select"
      | "rich_text" | "date" | "people" | "checkbox"
      | "number" | "url" | "email" | "phone_number"
      | "files" | "relation" | "formula" | "rollup"
      | "created_time" | "last_edited_time"
      | "created_by" | "last_edited_by";
    options?: NotionSelectOption[]; // status/select/multi_select 한정
  }

  export interface NotionDatabase {
    id: string;
    title: string;
    iconEmoji?: string;
  }

  export interface NotionDatabaseSchema {
    id: string;
    title: string;
    titlePropertyName: string;       // type === "title" 자동 추출
    statusProperty?: NotionPropertySchema;
    selectProperties: NotionPropertySchema[]; // type === "select" | "multi_select"
  }

  export type NotionBlock =
    | { type: "heading_2"; text: string }
    | { type: "paragraph"; text: string }
    | { type: "code"; language: string; text: string }
    | { type: "bulleted_list_item"; text: string }
    | { type: "image"; placeholderId: string }
    | { type: "table"; rows: string[][] };

  export interface NotionAttachmentInput {
    placeholderId: string;
    filename: string;
    contentType: string;
    dataUrl: string;
    category: "image" | "video" | "log" | "other";
  }

  export interface NotionCreatePagePayload {
    databaseId: string;
    title: string;
    statusOption?: { propertyName: string; optionName: string };
    selectValues: { propertyName: string; type: "select" | "multi_select"; options: string[] }[];
    blocks: NotionBlock[];
    attachments: NotionAttachmentInput[];
  }

  export interface NotionCreatePageResult {
    pageId: string;
    url: string;
  }

  export interface NotionPageStatus {
    pageId: string;
    url: string;
    statusOption?: { name: string; color: string };
    lastEditedTime: number;
  }

  export interface NotionFileUploadResult {
    fileUploadId: string;        // /v1/file_uploads create 응답
    expiresAt: number;
  }
  ```

- **`src/background/notion-api.ts`** — REST 래퍼.
  - `NotionError(status, message, body)` 에러 클래스.
  - `buildNotionAuthHeader(auth)`: 두 kind 모두 `Bearer ${token | accessToken}`.
  - `notionFetch(auth, path, init)`: `https://api.notion.com/v1/...` POST/GET. 헤더 고정: `Authorization`, `Notion-Version: 2022-06-28`, `Content-Type: application/json`.
  - `setNotionRefreshHook(hook)` / `ensureFresh(auth)` — 다른 플랫폼과 시그니처 통일하되 v1엔 hook 등록하지 않음(no-op). 만료 시 `OAuthError({ platform: "notion" })` 즉시 throw.
  - 매퍼 함수: `getMyself(auth)`, `searchDatabases(auth, query)`, `getDatabaseSchema(auth, dbId)`, `createPage(auth, payload)`, `getPageStatus(auth, pageId)`, `createFileUpload(auth, filename, contentType)`, `sendFileUpload(auth, uploadId, dataUrl)`.
  - `messageForNotionStatus(status)`: HTTP 상태 코드별 i18n 메시지 (401/403/404/429/5xx).
  - `parseDatabaseSchema(raw)`: `/v1/databases/{id}` raw 응답에서 `titlePropertyName`/`statusProperty`/`selectProperties` 추출하는 순수 헬퍼.

- **`src/background/notion-oauth.ts`** — Notion OAuth (proxy 경유).
  - `NOTION_CLIENT_ID = import.meta.env.VITE_NOTION_CLIENT_ID`.
  - `isNotionOAuthConfigured()`: `!!NOTION_CLIENT_ID && !!OAUTH_PROXY_URL`.
  - `startNotionOAuth()`: state 파라미터 생성 → `chrome.identity.launchWebAuthFlow` → code+state 추출 → proxy `/notion/token`에 POST(`code`, `redirect_uri`, `state`) → proxy가 `https://api.notion.com/v1/oauth/token`에 Basic Auth(`client_id:client_secret` base64)로 교환 → `{ access_token, bot_id, workspace_id, workspace_name, workspace_icon, owner }` 반환 → `getMyself(auth)`로 botName 추출.
  - `parseNotionCallbackParams(redirectUrl, expectedState)`: 순수 헬퍼. error/state mismatch/code missing/cancel 5케이스.
  - `isNotionCancellationCode(code)`: 화이트리스트 (`access_denied`/`user_denied` 등). 정규식 매칭 금지.
  - `persistNotionOAuthTokens(auth)` → `writeStoredNotionOAuthTokens`. 멱등.
  - `disconnectNotion()`: storage envelope에서 notion 슬롯 제거.
  - **refresh 함수 없음**, 모듈 사이드 이펙트로 `setNotionRefreshHook(...)` 등록 안 함.

- **`src/background/__tests__/notion-api.test.ts`** — auth header(API Key vs OAuth), 에러 파싱(401/403/429), `parseDatabaseSchema` 추출 케이스.
- **`src/background/__tests__/notion-oauth.test.ts`** — `parseNotionCallbackParams` 5케이스, `isNotionCancellationCode` 화이트리스트, `persistNotionOAuthTokens` 멱등.

- **`src/sidepanel/lib/buildNotionIssueBody.ts`** — `MarkdownContext` → `{ blocks: NotionBlock[]; attachments: NotionAttachmentInput[] }`.
  - 환경 섹션 → heading_2 + paragraph.
  - 사용자 섹션(description/steps/expected/notes) — `stepsToReproduce`는 `bulleted_list_item` 다중. 빈 paragraph는 `(없음)`(`md.noValue`).
  - 스타일 변경 — `table` block(rows[][]).
  - 첨부:
    - `category === "image"` → 본문 흐름에 `{ type: "image", placeholderId }` 인라인.
    - 그 외 → 본문 끝 `## 첨부` heading_2 다음 file block 위치는 NotionBlock에 표현 못하므로, blocks 배열 끝에 placeholder만 두고 `submitToNotion`에서 fileUpload 결과로 `file` block을 만들어 children에 첨부.
  - 푸터: 캡처 시각·URL·selector → paragraph 1~2개.
  - 출력 시그니처:
    ```ts
    export function buildNotionIssueBody(ctx: MarkdownContext): {
      blocks: NotionBlock[];
      attachments: NotionAttachmentInput[];
    };
    ```

- **`src/sidepanel/lib/__tests__/buildNotionIssueBody.test.ts`** — 6종 block 변환 + attachment 분기(image 인라인 vs 비이미지 첨부 큐) + table 변환 + 빈 섹션 `(없음)` + 로그 요약.

- **`src/sidepanel/lib/submitToNotion.ts`** — 등록 오케스트레이터.
  - 1) `attachments.forEach`: `notion.uploadFile` 메시지 → fileUploadId 매핑.
  - 2) blocks 변환에서 `image` placeholder를 `{ type: "image", external: { url: ... } }`로 — 단, Notion `/v1/pages`는 `file_upload` 참조도 허용하므로 `{ type: "image", file_upload: { id: fileUploadId } }` 사용 (외부 URL 호스팅 불필요).
  - 3) 비이미지 첨부는 children 끝에 `file_upload` block.
  - 4) `notion.submitPage` 메시지 → 페이지 생성 → `NormalizedSubmitResult { key: pageId 단축형, url }` 반환.

- **`src/sidepanel/tabs/connect/NotionConnectForm.tsx`** — Settings sub-tab.
  - LinearConnectForm 골격 복제.
  - 온보딩: `SiNotion` + `dark:invert` + "Notion으로 연결" OAuth 버튼 + "Internal Token" 버튼/다이얼로그.
  - 연결됨: 워크스페이스 카드(workspace_name + workspace_icon emoji + bot 이름) + Disconnect.
  - Internal Token 다이얼로그 본문: "Notion 워크스페이스에서 이 integration을 페이지에 connect 해야 등록 가능" 명시.

- **`src/sidepanel/tabs/notionFields/DatabaseCombobox.tsx`** — DB 검색 콤보박스.
  - controlled props: `value` (id), `valueTitle`, `onChange`.
  - `notion.searchDatabases` 메시지로 query별 fetch. **300ms 디바운스 필수** (Notion rate limit 3 req/sec).
  - GitHub의 `RepoCombobox` 패턴 복제.

- **`src/sidepanel/tabs/notionFields/StatusSelect.tsx`** — Status 단일 select.
  - `schema.statusProperty?.options`에서 추출. shadcn `Select`.
  - DB schema에 statusProperty 없으면 비노출.

- **`src/sidepanel/tabs/notionFields/PropertiesFieldset.tsx`** — 동적 select properties 컨테이너.
  - `schema.selectProperties.map((p) => <PropertySelectCombobox schema={p} ... />)`.
  - DB 변경 시 모든 선택값 리셋.

- **`src/sidepanel/tabs/notionFields/PropertySelectCombobox.tsx`** — 1개 select/multi_select 콤보박스.
  - props: `{ schema: NotionPropertySchema; value: string[]; onChange: (next: string[]) => void }`.
  - `schema.type === "select"` → 단일 선택, `multi_select` → 다중 선택.
  - 옵션은 `schema.options`에서 직접(추가 fetch 없음).

- **`src/sidepanel/tabs/notionFields/NotionIssueFields.tsx`** — 등록 다이얼로그 필드 컨테이너.
  - `NotionIssueFieldsValue`: `{ databaseId?, databaseTitle?, statusOptionName?, selectValues: { propertyName: string; options: string[] }[] }`.
  - `initialNotionFields(last, defaults)`: GitHub/Linear와 동일 우선순위(last → defaults → 빈값).
  - 렌더: DatabaseCombobox(필수) → schema fetch 결과로 StatusSelect + PropertiesFieldset 동적 렌더. Database 변경 시 status/select 리셋.

- **`src/sidepanel/tabs/notionFields/__tests__/initialNotionFields.test.ts`** — 우선순위 룰 단위 테스트.

### 변경 파일

- **`src/types/platform.ts`**:
  - `PlatformId = "jira" | "github" | "linear" | "notion"`.
  - `PLATFORM_TAB_KEYS.notion = "platform.tab.notion"`.
  - `Accounts.notion?: NotionAccount` 추가.
  - `NotionLastSubmitFields` 인터페이스 추가:
    ```ts
    export interface NotionLastSubmitFields {
      databaseId?: string;
      databaseTitle?: string;
      statusOption?: string;
      selectValues?: { propertyName: string; options: string[] }[];
    }
    ```
  - `LastSubmitFieldsByPlatform.notion?` 추가.

- **`src/types/messages.ts`**:
  - Notion 타입 re-export 추가.
  - `BgRequest` union에 `notion.*` 10개 멤버 추가:
    `notion.oauth.available`, `notion.startOAuth`, `notion.testToken`, `notion.disconnect`, `notion.getMyself`, `notion.searchDatabases`, `notion.getDatabaseSchema`, `notion.uploadFile`, `notion.submitPage`, `notion.getPageStatus`.
  - `getOAuthErrorPlatform`: `p === "notion"` 인식 추가 (현재 `messages.ts:153-158`이 jira/github/linear만 검사 — silent failure 위험).

- **`src/store/settings-store.ts`**:
  - `SETTINGS_STORE_VERSION` 5 → 6.
  - `updateNotionAccount(patch)` 액션 추가 (`updateLinearAccount`와 동일).
  - `PLATFORM_FALLBACK_ORDER`에 `"notion"` 추가 (`pickInitialPlatform`/`connectedPlatforms` 자동 반영).
  - v5→v6 마이그레이션: 멱등 가드. `accounts` dict가 이미 있으면 그대로 통과(타입 확장만, 데이터 변환 없음).
  - `isNotionAccountComplete(acc)` 헬퍼 추가.

- **`src/store/issues-store.ts` + `src/store/issues-migrations.ts`**:
  - `IssueRecord`에 옵셔널 메타 추가:
    ```ts
    notionPageId?: string;
    notionDatabaseId?: string;
    notionDatabaseTitle?: string;
    notionStatusOption?: string;
    ```
  - v4→v5 마이그레이션은 멱등 추가만(데이터 변환 없음).

- **`src/lib/settings-storage.ts`**:
  - `readStoredNotionAuth()` + `writeStoredNotionOAuthTokens()` 추가.
  - `SettingsEnvelope` 타입에 notion 슬롯.

- **`src/background/messages.ts`**:
  - `notion-api` 함수 import + `notion-oauth` 모듈 import (refresh hook 없음, 단순 import).
  - `loadNotionAuth()` 헬퍼 (`readStoredNotionAuth`로 envelope에서 직접 읽음).
  - `handleMessage` exhaustive switch에 `notion.*` 10개 case 추가.

- **`src/background/index.ts`**:
  - `NotionError`를 에러 직렬화 블록에 추가.
  - `BG_REQUEST_TYPES` 셋에 `notion.*` 타입 추가.

- **`oauth-proxy/worker.ts`**:
  - `Env`에 `NOTION_CLIENT_ID` + `NOTION_CLIENT_SECRET` 추가.
  - `POST /notion/token` 라우트 신설 (`handleNotionToken`):
    ```
    body: { code, redirect_uri, state }
    → Basic Auth header: base64(client_id + ":" + client_secret)
    → POST https://api.notion.com/v1/oauth/token
       { grant_type: "authorization_code", code, redirect_uri }
    → JSON 그대로 반환 (access_token, bot_id, workspace_id, workspace_name, workspace_icon, owner)
    ```
  - CORS는 기존 `ALLOWED_ORIGINS` 룰 재사용.
  - **refresh 라우트 없음** (Notion bot token은 long-lived).

- **`src/sidepanel/tabs/IntegrationsTab.tsx`**:
  - `PLATFORM_ORDER`에 `"notion"` 추가 (jira → github → linear → notion).
  - sub-tab 라벨 + content 분기에 `<NotionConnectForm />`.
  - 첫 연결 플랫폼을 기본 탭으로 잡는 effect는 자동 반영(연결된 플랫폼만 fallback에 들어감).

- **`src/sidepanel/tabs/IssueCreateModal.tsx`**:
  - `SubmitFieldsDialogProps`에 `notionFields`, `setNotionFields` 추가.
  - `SubmitFieldsDialog` 내부:
    - TabsList `grid-cols` 동적 전환: `availablePlatforms.length` 기반(2/3/4 분기).
    - `<TabsTrigger value="notion">` + `SiNotion` + `dark:invert`.
    - `platformConfigured` ternary → `"notion"` 분기(`!!notionAccount`).
    - `canSubmit` 조건: `"notion"` → `!!notionFields.databaseId`.
    - 필드 렌더: `platform === "notion"` → `<NotionIssueFields />`.
  - `IssueCreateModal` 본체: `notionFields` 상태 + `handleNotionSubmit` (submitToNotion 사용) + submit 라우팅.

- **`src/sidepanel/tabs/DraftDetailDialog.tsx`**:
  - IssueCreateModal과 동일한 notion 필드·핸들러·라우팅 추가.
  - prefill effect deps는 `[open, issue?.id]`만 유지(CLAUDE.md 컨벤션).

- **`src/sidepanel/tabs/IssueListTab.tsx`**:
  - `PlatformChip`에 `"notion"` + `SiNotion` 아이콘 + `dark:invert`.
  - `SubmittedBadge`에 `"notion"` case: `notion.getPageStatus` 호출. statusOption 있으면 색상별 배지, 없으면 `lastEditedTime`만.
  - 카드 메타: `notionDatabaseTitle` + `notionStatusOption` 표시.
  - `isRefreshable`에 `"notion"` 지원.
  - URL 파싱 fallback: `resolveNotionPageId(issue)` — 구 entry는 URL에서 page_id 추출.

- **`src/sidepanel/App.tsx`**:
  - `oauthExpiredPlatform` 레이블 해소에 `"notion"` 추가 (i18n 키 `notion.oauthExpired`).

- **`manifest.config.ts`**:
  - `host_permissions`에 `"https://api.notion.com/*"` 추가.
  - `https://www.notion.so/*`는 `launchWebAuthFlow`가 authorize URL 처리하므로 불필요. 단, OAuth 후속 라우팅 안정성을 위해 host_permissions에 함께 추가하는 것이 안전 — 검토 후 결정.

- **`.env.example`**:
  - `VITE_NOTION_CLIENT_ID=` 추가 (proxy URL은 `VITE_OAUTH_PROXY_URL` 공용).

- **`src/i18n/{ko,en}.ts`**:
  - `platform.tab.notion`.
  - 연결: `notion.onboarding.{title,body}`, `notion.connect.button`, `notion.connecting`, `notion.internalToken.button`, `notion.internalToken.dialog.{title,body}`, `notion.internalToken.label`, `notion.internalToken.placeholder`, `notion.internalToken.shareNotice`.
  - 필드: `notion.field.{database,status,properties}` + placeholder/empty/search/select.
  - 섹션: `notion.section.{connection,workspace,issueSettings}`.
  - 에러: `notion.error.{401,403,404,429,5xx,generic}`.
  - OAuth: `notion.oauth.notConfigured`, `notion.oauthExpired`.
  - 기타: `notion.workspaceCard.bot`, `notion.workspaceCard.workspace`, `notion.attachmentSection`(첨부 heading 라벨).
  - 이슈 목록 상태: `issueList.notion.{noStatus,lastEdited}` (Status 속성 유무에 따른 표시).

- **`src/store/__tests__/settings-store.test.ts`** — v5→v6 마이그레이션 (멱등 + notion account lifecycle).
- **`src/types/__tests__/platform.test.ts`** — `pickInitialPlatform` notion 우선순위 + `PLATFORM_FALLBACK_ORDER` 멤버십 + `getOAuthErrorPlatform("notion")` 반환.

## 데이터 흐름

### OAuth 연결 (Proxy 경유, refresh 없음)

```
[NotionConnectForm] "Notion으로 연결"
  → bg "notion.startOAuth"
  → background.startNotionOAuth():
    1. state = randomUUID()
    2. chrome.identity.launchWebAuthFlow({
         url: https://api.notion.com/v1/oauth/authorize?
              owner=user&client_id=...&redirect_uri=<ext callback>
              &response_type=code&state=<csrf>
       })
    3. 콜백에서 ?code= + ?state= 추출, state 검증
    4. fetch(`${PROXY_URL}/notion/token`, {
         method: "POST",
         body: JSON.stringify({ code, redirect_uri, state })
       })
       → proxy가 Basic Auth로 https://api.notion.com/v1/oauth/token 호출
       → { access_token, bot_id, workspace_id, workspace_name, workspace_icon, owner: { user: { name } } }
    5. getMyself(auth) → botName
    6. settings-store.setAccount("notion", { auth, defaults: {} })
```

### Internal Token 연결

```
[NotionConnectForm] Internal Token 입력 → bg "notion.testToken"
  → getMyself({ kind: "apiKey", token })
    → /v1/users/me → { bot.workspace_name?, bot.owner.user.name? }
  → settings-store.setAccount("notion", { auth: { kind: "apiKey", token, botName, workspaceName? } })
```

### Database 검색 + Schema fetch

```
IssueCreateModal → [notion] 탭 → DatabaseCombobox query 입력 (디바운스 300ms)
  → bg "notion.searchDatabases" { query }
  → POST /v1/search { query, filter: { value: "database", property: "object" } }
  → 결과 표시
  → 사용자 DB 선택
  → bg "notion.getDatabaseSchema" { databaseId }
  → GET /v1/databases/{id}
  → parseDatabaseSchema(raw) → { titlePropertyName, statusProperty?, selectProperties }
  → StatusSelect + PropertiesFieldset 동적 렌더
```

### 이슈 등록

```
사용자가 등록 버튼 클릭
  → submitToNotion(input):
    1. buildNotionIssueBody(ctx) → { blocks, attachments }
    2. attachments.map(async (a) =>
         bg "notion.uploadFile" { filename, contentType, dataUrl }
         → BG: createFileUpload → sendFileUpload → fileUploadId
       )
    3. blocks 변환:
       - { type: "image", placeholderId } → { type: "image", file_upload: { id: ... } }
       - 비이미지 첨부 → blocks 끝에 { type: "file", file_upload: { id: ... } }
    4. bg "notion.submitPage" {
         databaseId, title, statusOption?, selectValues, blocks, attachments(uploadIds)
       }
       → BG: POST /v1/pages {
              parent: { database_id },
              properties: { [titleProp]: { title: [...] }, [statusProp]?, ...select },
              children: blocks
         }
       → { id: pageId, url }
    5. NormalizedSubmitResult { key: pageId.slice(0,8), url }
  → markSubmitted + setLastSubmitFields("notion") + setLastSubmittedPlatform("notion")
```

### Status 동기화

```
IssueListTab → entry refresh 클릭
  → bg "notion.getPageStatus" { pageId }
  → GET /v1/pages/{id}
  → properties에서 statusProperty 추출 (DB schema 기억해두지 않으므로 type === "status" iterate)
  → { statusOption?: { name, color }, lastEditedTime }
  → entry 갱신 (notionStatusOption 또는 lastEditedTime만)
```

### OAuth 만료 / Integration 제거

```
notion-api.ts: 401 수신
  → throw new OAuthError({ platform: "notion", refreshFailed: true })
  → BG가 body.platform: "notion" + body.oauthRefreshFailed: true 직렬화
  → sendBg가 isOAuthRefreshFailed(err) → onOAuthExpired.fire("notion")
  → App.tsx AlertDialog: "Notion 연결이 만료됐습니다" + IntegrationsTab/[Notion] 이동
```

## OAuth Proxy 설계

### `/notion/token` 라우트 (신규)

```
POST /notion/token
  body: { code, redirect_uri, state? }
  Basic Auth: base64(env.NOTION_CLIENT_ID + ":" + env.NOTION_CLIENT_SECRET)
  → POST https://api.notion.com/v1/oauth/token
    Authorization: Basic <base64>
    Content-Type: application/json
    body: { grant_type: "authorization_code", code, redirect_uri }
  → 200: JSON 그대로 클라이언트에 반환
  → 4xx/5xx: { error, error_description } 직렬화 후 같은 status로 반환
```

CORS: `ALLOWED_ORIGINS` 환경변수에 익스텐션 origin(`chrome-extension://<id>`) 추가. GitHub `/github/token`과 동일 패턴.

### refresh 라우트 없음

Notion bot token은 long-lived. Notion 측에서 integration을 제거하거나 access를 회수하면 401이 떨어지고 재인증으로 복구. 따라서:
- `oauth-proxy/worker.ts`에 `/notion/refresh` 라우트 없음.
- `notion-oauth.ts`에 `refreshNotionToken` 함수 없음.
- `setNotionRefreshHook` 시그니처는 다른 플랫폼과 통일하되 모듈 사이드 이펙트로 hook 등록하지 않음.

## Notion Blocks 변환 룰

### 6종 block 매핑

| MarkdownContext 요소 | NotionBlock |
|---|---|
| 섹션 헤더 (`description`/`stepsToReproduce`/`expected`/`notes`) | `heading_2` |
| 단순 텍스트 paragraph | `paragraph` |
| `stepsToReproduce` 줄별 항목 | `bulleted_list_item` × N |
| 스타일 변경 표 | `table` (`rows: string[][]`) |
| 콘솔/네트워크 로그 요약 코드 블록 | `code` (language: `"plain text"`) |
| 캡처 이미지·diff | `image` placeholder → file_upload 후 주입 |

### 빈 paragraph

`if (!text) → { type: "paragraph", text: "(없음)" }`. `md.noValue` i18n 키 사용. heading 직후 빈 paragraph는 omit하지 않음(다른 빌더와 동일 룰로 일관성).

### Table 변환

Notion `table` block 구조:
```ts
{
  type: "table",
  has_column_header: true,
  has_row_header: false,
  table_width: rows[0].length,
  children: rows.map((cells) => ({
    type: "table_row",
    cells: cells.map((c) => [{ type: "text", text: { content: c } }])
  }))
}
```

`buildNotionIssueBody`는 placeholder 시그니처(`{ type: "table", rows: string[][] }`)를 반환하고, `submitToNotion` 시점에 위 구조로 expand.

### 이미지 인라인

```ts
// builder
blocks.push({ type: "image", placeholderId: "screenshot-0" });
attachments.push({ placeholderId: "screenshot-0", filename, contentType, dataUrl, category: "image" });

// submit 시
const uploadIds = await Promise.all(attachments.map(...));
blocks = blocks.map((b) => b.type === "image"
  ? { type: "image", file_upload: { id: uploadIds[b.placeholderId] } }
  : b);
```

### 비이미지 첨부 섹션

영상·로그·기타: blocks 끝에 `## 첨부` heading_2 + `file_upload` block × N.
```ts
const nonImage = attachments.filter((a) => a.category !== "image");
if (nonImage.length) {
  finalBlocks.push({ type: "heading_2", text: t("notion.attachmentSection") });
  for (const a of nonImage) {
    finalBlocks.push({ type: "file", file_upload: { id: uploadIds[a.placeholderId] }, name: a.filename });
  }
}
```

## file_upload API 흐름 (3-step)

Notion `/v1/file_uploads`:
1. **Create**: `POST /v1/file_uploads` body `{ filename, content_type }` → `{ id, upload_url, expiry_time }`.
2. **Send**: `POST <upload_url>` `multipart/form-data` 첨부 파일. 5MB 이하 single-part. (5MB 초과 시 multi-part는 v1 미지원 — fallback 처리 필요.)
3. **Reference**: `/v1/pages` children에 `file_upload: { id }` 객체 포함.

`notion-api.ts`의 `createFileUpload` + `sendFileUpload`이 step 1+2 처리. `submitPage`가 step 3 처리.

### 5MB 초과 처리

단일 dataUrl이 5MB를 넘으면:
- v1: 인라인 image block 대신 첨부 섹션의 file block으로 강제 fallback (그래도 5MB 초과 시 등록 자체 실패 → UI에 안내 토스트).

## v6 마이그레이션 vs Linear v4

| 관점 | Linear (v3→v4) | Notion (v5→v6) |
|---|---|---|
| 변경 종류 | additive optional, 데이터 변환 없음 | additive optional, 데이터 변환 없음 |
| accounts 슬롯 | `accounts.linear?` 추가 | `accounts.notion?` 추가 |
| 멱등 가드 | `accounts` dict 존재 시 passthrough | 동일 |
| `LastSubmitFieldsByPlatform` | `linear?` 추가 | `notion?` 추가 |
| `IssueRecord` 필드 | `linearIdentifier?` 등 optional | `notionPageId?` 등 optional |

## 기존 패턴 준수

- **discriminated union auth**: `NotionAuth = NotionApiKeyAuth | NotionOAuthAuth`, `kind` 판별자. Linear/GitHub와 동일.
- **메시지 namespace**: `notion.*` 10개. exhaustive switch.
- **에러 클래스**: `NotionError(status, message, body)` — Linear/GitHub와 동일.
- **OAuth 에러**: `OAuthError({ platform: "notion" })`. `getOAuthErrorPlatform`에 `"notion"` 추가.
- **refresh hook 시그니처**: 다른 플랫폼과 통일하되 v1엔 등록 안 함.
- **스토어 마이그레이션**: 멱등 가드, 버전 증가, `migrate` 콜백 패턴 동일.
- **settings storage**: `readStoredNotionAuth` / `writeStoredNotionOAuthTokens` — 기존 패턴 복제.
- **submit 결과**: `NormalizedSubmitResult { key, url }`.
- **i18n**: ko/en 동시 갱신. `locales.test.ts` 키 패리티.
- **테스트 배치**: `__tests__/*.test.ts` 소스와 동일 디렉터리. issues-store가 트랜시티브 i18n 로드 일으키는 이슈는 `issues-migrations.ts` 분리 패턴(이미 존재) 그대로.
- **UI 컨벤션**: shadcn 컴포넌트만, IconButton `h-8 w-8`, `data-[state=inactive]:hidden`, brand 아이콘 `color="default"` + Notion만 `dark:invert`.
- **prefill effect deps**: IssueCreateModal/DraftDetailDialog 모두 `[open, issue?.id]`만 (issue.platform 변경 시 재발화 회피).

## 대안 검토

**대안 A — Internal Token만 지원**: proxy 작업이 사라지므로 가장 단순. 하지만 사용자가 워크스페이스 admin이어야 하고 페이지에 integration을 수동 connect해야 해서 onboarding 마찰이 큼. OAuth와 둘 다 지원하는 일관성을 우선.

**대안 B — Markdown 본문 1개 paragraph block으로**: 변환 비용 0이지만 Notion에서 편집 시 구조가 없어 보기 나쁨. 핵심 가치인 "Notion 페이지로 자연스럽게 보임"이 깨짐. 제외.

**대안 C — file_upload 미지원 (텍스트 안내만)**: GitHub 패턴과 동일. 구현 단순. 하지만 핵심 사용자 가치(스크린샷 + diff 자동 첨부)가 약함. 정책 결정으로 file_upload 채택.

**대안 D — DB 모드 + 부모 페이지 모드 동시 지원**: UI 분기 + 마이그레이션 + 빌더 분기 모두 2배. v1 스코프에 안 맞음. v2로 미룸.

**대안 E — DB 스키마 모든 properties 타입 동적 렌더**: text/number/date/people/url/checkbox 등 12종 입력 UI. 구현량 폭증. v1은 select/multi_select만, 나머지 type은 후속.

**대안 F — Notion이 PKCE를 지원할 가능성**: 현재 Notion은 PKCE를 지원하지 않음(2024 기준). 향후 도입 시 proxy 제거 가능. 현재는 GitHub 패턴 따라야 함.

## 위험 요소

1. **getOAuthErrorPlatform 좁은 분기 (`messages.ts:153-158`)**: 현재 `p === "jira" || p === "github" || p === "linear"` 하드코딩. notion 추가 누락 시 OAuthExpired 다이얼로그가 안 뜨는 silent failure. T1에서 즉시 수정 + 테스트.
2. **Notion API rate limit (3 req/sec 평균)**: DatabaseCombobox가 keystroke마다 fetch하면 위반 → 디바운스 300ms 필수. 다중 attachment 업로드도 직렬화(Promise.all 대신 for-of).
3. **DB schema 변경 race**: 사용자가 IssueCreateModal 연 상태에서 Notion 측에서 DB 속성 수정 시 stale schema로 등록 422. v1은 422 표시 후 재선택 안내.
4. **이미지 file_upload 5MB 제한**: 큰 스크린샷은 사전 압축(`capture.ts`의 jpeg quality) 또는 첨부 섹션 fallback. 둘 다 실패 시 UI에 명시적 토스트.
5. **Internal Token UX 함정**: 사용자가 token은 발급했지만 페이지에 integration을 connect 안 한 경우 등록 실패 → DB 검색 빈 결과. SettingsTab에 명시적 안내 + "no databases found" 가이드.
6. **i18n 키 누락**: 30+ 키 일괄 추가하다 ko/en 비대칭 가능 → `locales.test.ts` 키 패리티 테스트가 자동 검출.
7. **PlatformId union 확장의 회귀**: `getOAuthErrorPlatform`(messages.ts), `PLATFORM_FALLBACK_ORDER`(settings-store.ts), `PLATFORM_TAB_KEYS`(platform.ts) 등 union을 좁게 검사하는 곳 모두 수정. exhaustive switch가 강제하지 않는 곳은 grep으로 한 번 더 훑어야.
8. **manifest host_permissions 추가**: `https://api.notion.com/*` 추가 시 Chrome 웹스토어 업데이트에서 권한 재승인 다이얼로그. 릴리스 노트 안내.
9. **Notion OAuth integration callback URL**: Notion 측 settings에 `chrome.identity.getRedirectURL()` (`https://<extension-id>.chromiumapp.org/`)와 정확히 일치 등록 필요. dev/prod extension ID가 다르면 둘 다 등록(Notion은 multiple redirect URLs 지원이라 GitHub처럼 OAuth App을 둘로 쪼갤 필요 없음).
10. **블록 children 100개 제한**: Notion `/v1/pages` children 한 요청당 100 block 제한. 큰 케이스(50+ 스타일 diff 행)는 분할 필요. v1 스코프에선 typical 사용량(<30 block) 가정.
