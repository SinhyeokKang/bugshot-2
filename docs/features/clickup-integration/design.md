# ClickUp 연동 — 기술 설계

## 개요

ClickUp을 기존 어댑터 패턴에 7번째 플랫폼으로 추가한다. **Asana 어댑터를 복제 기준**으로 삼되, ClickUp이 `markdown_content`를 1급 지원하므로 본문은 Asana의 HTML 변환(`markdownToAsanaHtml`) 대신 `buildIssueMarkdown` 산출 markdown을 그대로 쓴다 — 본문 처리가 오히려 GitHub/GitLab보다 단순. 인증은 PAT/OAuth discriminated union, OAuth는 proxy 경유(client_secret 필요)이지만 **ClickUp 액세스 토큰은 만료가 없어 refresh hook이 불필요**(Notion OAuth와 유사). 제출은 Asana식 "task 먼저 생성 → 첨부 업로드 → inline 이미지가 있으면 본문 2차 갱신".

## 변경 범위

### 신규 파일

| 파일 | 역할 |
|---|---|
| `src/types/clickup.ts` | `ClickupPatAuth`/`ClickupOAuthAuth`/`ClickupAuth`, `ClickupAccount`, `ClickupDefaults`, `ClickupMyself`/`Workspace`/`Space`/`List`/`User`, `ClickupCreateTaskPayload`/`Result`/`TaskStatus`. `src/types/asana.ts` 미러. |
| `src/background/clickup-oauth.ts` | `isClickupOAuthConfigured()`, `startClickupOAuth()`, `parseClickupCallbackParams()`, `persistClickupOAuthTokens()`. `asana-oauth.ts` 복제, **refresh 함수 없음**. |
| `src/background/clickup-api.ts` | `clickupFetch<T>()`(PAT/OAuth 헤더 분기 + 401→재연결 에러), `getMyself`/`getTeams`/`getSpaces`/`getLists`/`getMembers`, `createTask`, `uploadAttachment`, `updateTaskMarkdown`, `getTaskStatus`. **refresh hook 없음.** |
| `src/sidepanel/lib/submitToClickup.ts` | `ClickupSubmitInput`, `submitToClickup()` → `NormalizedSubmitResult`. `submitToAsana.ts` 복제(HTML 변환 제거). |
| `src/sidepanel/lib/buildClickupIssueBody.ts` | `buildClickupIssueBody()` → markdown body. `buildIssueMarkdown` 재사용 + CC 줄 주입. `buildGitlabIssueBody.ts`에 가장 근접. |
| `src/sidepanel/tabs/connect/ClickupConnectForm.tsx` | `ClickupConnectedBody`, `ClickupConnectFlow`, PAT 입력 다이얼로그. `AsanaConnectForm.tsx` 복제. |
| `src/sidepanel/tabs/clickupFields/ClickupIssueFields.tsx` | `ClickupIssueFieldsValue`, `initialClickupFields()`, `ClickupIssueFields`. `asanaFields/AsanaIssueFields.tsx` 복제. |
| `src/sidepanel/tabs/clickupFields/WorkspaceCombobox.tsx` | Workspace(team) 선택. |
| `src/sidepanel/tabs/clickupFields/SpaceCombobox.tsx` | Space 선택(workspace 종속). |
| `src/sidepanel/tabs/clickupFields/ListCombobox.tsx` | List 선택(space 종속, folderless 포함). |
| `src/sidepanel/tabs/clickupFields/AssigneeCombobox.tsx` | Assignee 선택. |
| `src/sidepanel/tabs/clickupFields/CcCombobox.tsx` | CC 멘션 다중 선택(CcMultiCombobox 셸 사용). |
| `src/types/__tests__` · `lib/__tests__` | 순수 함수 단위 테스트(아래 테스트 계획). |

### 수정 파일

| 파일 | 변경 |
|---|---|
| `src/types/platform.ts` | `PlatformId`에 `"clickup"` 추가(L8-14); `PLATFORM_TAB_KEYS`에 `clickup`(L16-23); `import { ClickupAccount }`; `Accounts.clickup?`(L41-48); `ClickupLastSubmitFields` 추가 + `LastSubmitFieldsByPlatform.clickup?`(L114-131). |
| `src/types/messages.ts` | `BgRequest` union에 `clickup.*` 메시지 추가 + ClickUp 타입 import. |
| `src/background/bgRequestTypes.ts` | `BG_REQUEST_TYPE_MAP`에 모든 `clickup.*` 키 추가(컴파일 타임 누락 가드). |
| `src/background/messages.ts` | clickup-oauth/clickup-api import; `loadClickupAuth()`; `handleMessage` switch에 `clickup.*` case. |
| `src/lib/settings-storage.ts` | `SettingsEnvelope`에 clickup auth 슬롯; `readStoredClickupAuth()`; `writeStoredClickupOAuthTokens()`. |
| `src/store/settings-store.ts` | `PLATFORM_FALLBACK_ORDER`에 `"clickup"` 추가. (Accounts/LastSubmit 타입은 platform.ts에서 흡수) |
| `src/sidepanel/tabs/IntegrationsTab.tsx` | `PLATFORMS` 배열에 ClickUp 항목(`SiClickup` 아이콘 + ConnectedBody/ConnectFlow). |
| `src/sidepanel/hooks/usePlatformFields.ts` | clickup 필드 상태 블록(`initialClickupFields` + useState + effect). |
| `src/sidepanel/tabs/SubmitFieldsDialog.tsx` | `PLATFORM_TABS`에 clickup; `platformConfigured`/`canSubmit`/렌더 분기에 clickup. |
| `src/sidepanel/tabs/IssueCreateModal.tsx` | `submitToClickup` import; clickup 계정/필드 구독; `handleClickupSubmit()`; `handleSubmit` 라우팅. |
| `src/sidepanel/tabs/DraftDetailDialog.tsx` | clickup 계정/필드 구독 + SubmitFieldsDialog props 전달(재제출). |
| `src/sidepanel/lib/ccMention.ts` | CC를 markdown 줄로 주입(`ccMarkdownLine` 재사용). 신규 형식 함수는 ClickUp 멘션이 markdown `@` 텍스트면 불필요. |
| `manifest.config.ts` | `host_permissions`에 `https://api.clickup.com/*`, `https://app.clickup.com/*`. |
| `oauth-proxy/worker.ts` | `/clickup/token` 라우트(client_secret 주입). refresh 라우트 불필요. `ClickUp` env(CLIENT_ID/SECRET). |
| `src/i18n/namespaces/*` | `platform.tab.clickup` + ClickUp 필드/에러 키 ko·en. |
| `.env.example` | `VITE_CLICKUP_CLIENT_ID` (+ proxy의 `CLICKUP_CLIENT_SECRET`). |
| `CLAUDE.md`·`DIRECTORY.md`·`ARCHITECTURE.md`·`PERMISSION.md`·`docs/privacy.md` | 새 플랫폼/권한/호스트/OAuth 흐름 반영. |

## 데이터 흐름

### 인증
```
연동 탭 → ClickupConnectFlow
  ├─ OAuth: sendBg("clickup.startOAuth")
  │    → bg: startClickupOAuth() → launchWebAuthFlow(app.clickup.com authorize)
  │    → redirect code → proxy POST /clickup/token (client_secret 주입)
  │    → { access_token } → persist (chrome.storage.local, accounts.clickup.auth: {kind:"oauth"})
  └─ PAT: sendBg("clickup.testPat", pk_token)
       → bg: getMyself({kind:"pat"}) 검증 → persist {kind:"pat"}
```
ClickUp 토큰은 만료 없음 → `expiresAt`/refresh 없음. `clickupFetch`는 401 시 곧장 재연결 에러.

### 필드 로드 (제출 다이얼로그)
```
Workspace 콤보박스 열기 → sendBg("clickup.getTeams")
Space 콤보박스(workspace 선택 후) → sendBg("clickup.getSpaces", teamId)
List 콤보박스(space 선택 후) → sendBg("clickup.getLists", spaceId)  // folderless + folder lists 평탄화
Assignee/CC → sendBg("clickup.getMembers", workspaceId)
```

### 제출 (Asana식 순서)
```
submitToClickup(input)
 1. buildClickupIssueBody({ctx, cc}) → markdown body
 2. sendBg("clickup.submitIssue", {listId, name, markdownContent, assignees})
      → createTask → { id, url }
 3. inline 이미지 + 캡처 이미지/영상 + logs.html + 사용자 첨부:
      sendBg("clickup.uploadFile", {taskId, filename, dataUrl}) (각 파일)
 4. inline 이미지가 있으면: 업로드 attachment URL로 markdown 이미지 치환
      → sendBg("clickup.updateTaskMarkdown", {taskId, markdownContent})
 5. return { key: id, url, logsDropped? }
```

### BgRequest 메시지 (3곳 동시 등록: messages.ts union + bgRequestTypes Map + messages.ts handler)
```
clickup.oauth.available    → isClickupOAuthConfigured()
clickup.startOAuth         → startClickupOAuth()
clickup.testPat            → getMyself({kind:"pat", pat})
clickup.disconnect         → clear accounts.clickup
clickup.getTeams           → getTeams(auth)
clickup.getSpaces          → getSpaces(auth, teamId)
clickup.getLists           → getLists(auth, spaceId)
clickup.getMembers         → getMembers(auth, workspaceId)
clickup.submitIssue        → createTask(auth, payload)
clickup.uploadFile         → uploadAttachment(auth, taskId, file)
clickup.updateTaskMarkdown → updateTaskMarkdown(auth, taskId, md)
clickup.getTaskStatus      → getTaskStatus(auth, taskId)
```

## 인터페이스 설계

```ts
// src/types/clickup.ts
export interface ClickupPatAuth {
  kind: "pat";
  pat: string;            // pk_...
  viewerId: string;
  viewerName: string;
  viewerEmail?: string;
}
export interface ClickupOAuthAuth {
  kind: "oauth";
  accessToken: string;    // 만료 없음 → expiresAt/refreshToken 없음
  grantedAt: number;
  viewerId: string;
  viewerName: string;
  viewerEmail?: string;
}
export type ClickupAuth = ClickupPatAuth | ClickupOAuthAuth;

export interface ClickupDefaults {
  workspaceId?: string;
  workspaceName?: string;
  spaceId?: string;
  spaceName?: string;
  listId?: string;
  listName?: string;
}
export interface ClickupAccount extends PlatformAccountBase<"clickup"> {
  auth: ClickupAuth;
  defaults: ClickupDefaults;
}

export interface ClickupWorkspace { id: string; name: string; }
export interface ClickupSpace { id: string; name: string; }
export interface ClickupList { id: string; name: string; folderName?: string; }
export interface ClickupUser { id: string; name: string; email?: string; }

export interface ClickupCreateTaskPayload {
  listId: string;
  name: string;
  markdownContent: string;   // → ClickUp `markdown_content`
  assignees?: string[];      // user id (정수 문자열)
}
export interface ClickupCreateTaskResult { id: string; url: string; }
export interface ClickupTaskStatus { id: string; name: string; completed: boolean; url: string; }
```

```ts
// src/types/platform.ts (추가)
export interface ClickupLastSubmitFields {
  workspaceId?: string; workspaceName?: string;
  spaceId?: string; spaceName?: string;
  listId?: string; listName?: string;
  assigneeId?: string; assigneeName?: string;
  cc?: { id: string; name: string }[];
}
```

```ts
// src/sidepanel/lib/submitToClickup.ts
export interface ClickupFileInput { filename: string; dataUrl: string; displayName?: string; }
export interface ClickupSubmitInput {
  ctx: MarkdownContext;
  images?: ClickupFileInput[];
  video?: ClickupFileInput;
  logs?: ClickupFileInput[];
  attachments?: ClickupFileInput[];
  inlineImages?: InlineImageInput[];
  workspaceId: string;
  listId: string;
  assigneeId?: string;
  cc?: { id: string }[];
}
export function submitToClickup(input: ClickupSubmitInput): Promise<NormalizedSubmitResult>;
```

```ts
// src/sidepanel/tabs/clickupFields/ClickupIssueFields.tsx
export interface ClickupIssueFieldsValue {
  workspaceId?: string; workspaceName?: string;
  spaceId?: string; spaceName?: string;
  listId?: string; listName?: string;
  assigneeId?: string; assigneeName?: string;
  cc?: { id: string; name: string }[];
}
export function initialClickupFields(
  last: ClickupLastSubmitFields | undefined,
  defaults: ClickupDefaults | undefined,
): ClickupIssueFieldsValue;
```

## 기존 패턴 준수

- **어댑터 대칭**: `submitTo*`는 `NormalizedSubmitResult{key,url,logsDropped?}` 반환. ClickUp도 동일.
- **메시지 3곳 일치**: `BgRequest` union ↔ `BG_REQUEST_TYPE_MAP` ↔ handler switch. 누락 시 컴파일 에러(과거 Asana 회귀 방지 장치).
- **PAT/OAuth discriminated union**: `kind: "pat" | "oauth"` (GitLab/Asana 패턴).
- **OAuth proxy 경유**: client_secret은 `oauth-proxy/worker.ts`에만. 확장은 client_id만.
- **env 가드**: `isClickupOAuthConfigured() = !!VITE_CLICKUP_CLIENT_ID && !!VITE_OAUTH_PROXY_URL`. 미설정 시 OAuth UI 자동 숨김.
- **i18n 동시 갱신**: ko·en 함께. `src/i18n/` 훅이 대칭 강제.
- **세션/저장**: 토큰은 `chrome.storage.local`(SettingsEnvelope). 마지막 제출 필드는 `LastSubmitFieldsByPlatform.clickup`.
- **UI**: shadcn/ui 콤보박스 패턴 복제. CcMultiCombobox 셸 재사용.

## 대안 검토

- **본문을 ClickUp 외 포맷으로 변환** (예: HTML) — 기각. ClickUp은 `markdown_content`를 우선 적용하므로 변환 불필요. `buildIssueMarkdown` 직접 재사용이 가장 단순.
- **OAuth refresh hook 구현** — 기각. ClickUp 토큰은 만료가 없다(공식 문서). refresh 코드는 죽은 코드가 된다. 만료 정책이 생기면 그때 GitLab 패턴 이식.
- **Folder까지 4단계 선택 UI** — 기각. UX가 무겁다. Space 하위 list를 folderless + folder list로 평탄화해 List 콤보박스 한 단계로 합친다(`folderName` 라벨만 표기).
- **PAT 전용으로 시작** — 기각. 사용자가 OAuth+PAT 둘 다 요청. PAT는 proxy 없이 즉시 테스트 가능해 구현/검증 순서상 먼저 진행한다(tasks 참조).

## 위험 요소

- **inline 이미지 렌더 불확실**: ClickUp `markdown_content`가 attachment의 public URL을 `![](url)`로 렌더하는지 미검증. Asana는 attachment GID 임베드라 메커니즘이 다르다. → 구현 시 실제 task에서 렌더 확인 필수. 미지원이면 **첨부 폴백**(본문 누락, task는 생성). PRD 엣지 케이스 명시.
- **OAuth 토큰 헤더 형식**: ClickUp은 PAT/OAuth 모두 `Authorization: <token>`(Bearer 접두사 없음)일 수 있음. 구현 시 실제 호출로 확인.
- **proxy 선행 의존**: OAuth는 `oauth-proxy`에 `/clickup/token` 추가 + Cloudflare 재배포가 끝나야 동작. dev 검증은 PAT 우선.
- **List 검색 API 부재**: ClickUp은 전역 list 검색이 약해 Workspace→Space→List 단계 종속 로드가 불가피(N+1 호출). 각 콤보박스는 상위 선택 후에만 활성화.
- **회귀면**: `PlatformId` union·`Accounts`·`SubmitFieldsDialog`·`usePlatformFields`·`IssueCreateModal`/`DraftDetailDialog`는 모든 플랫폼 공용. ClickUp 추가가 기존 6개 분기에 영향 주지 않도록 분기 추가만(기존 케이스 수정 금지). e2e 전체 재확인.

---

## 부록: Slack 보류 노트 (이번 미구현)

Slack을 추후 추가한다면 별도 feature로 설계해야 한다. 재사용 가능/불가능 경계:

**재사용 가능**: OAuth proxy 경유(client_secret 필요), 토큰 저장(만료 없음, refresh 불필요), 연동 탭 카드/connect form 골격, PAT/OAuth union, env 가드.

**신규 필요(어댑터 패턴과 불일치)**:
- 본문: 일반 markdown ✗ → **Slack mrkdwn**(표·인라인 이미지 미지원). 표/이미지는 **Block Kit** 조립 필요 → `markdownToSlackBlocks` 신규.
- 파일: 2단계 외부 업로드 `files.getUploadURLExternal` → PUT(외부 URL) → `files.completeUploadExternal`. 기존 단일 업로드 메시지와 다름.
- 대상: List/Project ✗ → **채널 선택**(`conversations.list`, public/private 페이지네이션).
- 결과 URL: task url 즉시 반환 ✗ → `chat.postMessage` 응답 `ts` + `chat.getPermalink` 별도 호출.
- 멘션: `<@U…>` 고유 형식 → `ccMention`에 Slack 함수 신규.
- "이슈 목록/재제출/완료 상태" 개념이 메시지 모델에 없음 → IssueListTab 연동 부적합.

권장: Slack은 "이슈 제출"이 아니라 별도 "공유(Share to Slack)" 기능으로 재정의하는 편이 패턴 충돌이 적다.
