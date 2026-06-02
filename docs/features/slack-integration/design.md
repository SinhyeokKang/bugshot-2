# Slack 연동 — 기술 설계

## 개요

기존 6개 플랫폼과 동일한 어댑터 레이어 패턴(`src/types/<platform>.ts` 타입 + `src/background/<platform>-api.ts` API + `src/background/<platform>-oauth.ts` 인증 + `src/sidepanel/lib/submitTo<Platform>.ts` 오케스트레이션 + 필드/연결 UI)을 Slack에 그대로 적용한다. 단 Slack은 **이슈 객체가 아닌 메시지 앱**이라는 차이를 두 곳에서 흡수한다: (1) 상태 추적 어댑터 메서드(`getIssueStatus`/`updateIssueState`)를 구현하지 않고 정적 "전송됨" 배지만 두며, (2) Block Kit 본문은 인라인 이미지를 못 받으므로 모든 파일을 본문 메시지의 **스레드 답글로 첨부**한다.

전송 흐름은 Asana의 "create → upload" 2-step과 같다: `chat.postMessage`(Block Kit 본문)로 부모 메시지를 먼저 만들고, 반환된 `ts`를 `thread_ts`로 써서 `files` API로 첨부한다. Asana와 달리 업로드 후 본문 재갱신(update)은 필요 없다 — 인라인 참조를 쓰지 않기 때문.

## 변경 범위

### 신규 파일

| 파일 | 역할 |
|---|---|
| `src/types/slack.ts` | `SlackAuth`(user token only), `SlackAccount`, `SlackConversation`, `SlackPostMessagePayload`, `SlackPostMessageResult`, `SlackMyself` 타입 |
| `src/background/slack-oauth.ts` | OAuth v2 user token 플로우. `startSlackOAuth()`, `isSlackOAuthConfigured()`, 콜백 파싱. proxy 경유 token 교환. **refresh 없음** |
| `src/background/slack-api.ts` | `getMyself()`(auth.test+users.info), `listConversations(query?)`, `postMessage(payload)`, `uploadFiles(channel, threadTs, files)`, `getPermalink(channel, ts)` |
| `src/sidepanel/lib/markdownToSlackBlocks.ts` | markdown → Block Kit `blocks[]` 변환 + mrkdwn fallback 텍스트. markdown-it 토큰 순회 (markdownToAsanaHtml 패턴) |
| `src/sidepanel/lib/buildSlackIssueBody.ts` | `MarkdownContext` → 본문 markdown 문자열 조립 (buildAsanaIssueBody 패턴, 첨부는 본문에 안 넣음) |
| `src/sidepanel/lib/submitToSlack.ts` | 전송 오케스트레이션: postMessage → 스레드 첨부 |
| `src/sidepanel/tabs/connect/SlackConnectForm.tsx` | `SlackConnectFlow`, `SlackConnectedBody` (OAuth only, NotionConnectForm 패턴 — PAT 입력 없음) |
| `src/sidepanel/tabs/slackFields/ConversationField.tsx` | 채널/DM 검색 콤보박스 (단일 필드) |
| `src/sidepanel/tabs/slackFields/SlackIssueFields.tsx` | SubmitFieldsDialog용 필드 묶음 (ConversationField 하나) |
| `src/sidepanel/tabs/statusBadges/SlackSubmittedBadge.tsx` | 정적 "전송됨" + permalink 링크 (폴링 없음). `StatusBadge`(폴링형)는 슬랙용 미생성 |
| `src/sidepanel/lib/__tests__/markdownToSlackBlocks.test.ts` | 변환기 단위 테스트 |

### 변경 파일

| 파일 | 현재 역할 | 변경 |
|---|---|---|
| `src/types/platform.ts` | `PlatformId` union, `Accounts`, `LastSubmitFieldsByPlatform`, `PLATFORM_TAB_KEYS` | `"slack"` 추가, `SlackAccount`·`SlackLastSubmitFields` 추가, `PLATFORM_TAB_KEYS.slack` 추가 |
| `src/types/messages.ts` | `BgRequest` union, `getOAuthErrorPlatform` | `slack.*` 메시지 추가, OAuth 에러 플랫폼 판정에 `"slack"` 추가, Slack 타입 re-export |
| `src/background/messages.ts` | bg 메시지 핸들러 디스패치 | `slack.*` 케이스 추가 |
| `src/background/bgRequestTypes.ts` | 메시지 타입 보조 | slack 타입 추가 (현 패턴 따름) |
| `src/sidepanel/tabs/IntegrationsTab.tsx` | `PLATFORMS` 배열 | `{ id: "slack", Icon: SiSlack, ... }` 추가 |
| `src/sidepanel/tabs/SubmitFieldsDialog.tsx` | 플랫폼 탭·필드 dispatch, `canSubmit` | slack 탭 + `SlackIssueFields` + `canSubmit` 분기(conversationId 필수) |
| `src/sidepanel/tabs/IssueCreateModal.tsx` | submit dispatch | `submitToSlack` 분기 + `lastSubmitFields.slack` + `setLastSubmittedPlatform("slack")` |
| `src/sidepanel/tabs/statusBadges/SubmittedBadge.tsx` | 플랫폼별 배지 라우팅 | `platform === "slack"` → `SlackSubmittedBadge` |
| `src/sidepanel/tabs/statusBadges/PlatformChip.tsx` | 플랫폼 아이콘+이름 칩 | slack 분기 (`SiSlack`) |
| `src/sidepanel/tabs/issueListUtils.ts` | 이슈 리스트 헬퍼 (submitTo 재전송 등) | slack 분기 추가 |
| `src/sidepanel/tabs/DraftDetailDialog.tsx` | 드래프트 상세 재전송 | slack 분기 추가 |
| `src/store/settings-store.ts` | accounts·lastSubmitFields·sync | slack 계정 setter, `connectedPlatforms`에 자연 포함. **상태 sync 대상에서 제외** |
| `src/store/issues-store.ts` | `IssueRecord` | `slackChannelId?`, `slackMessageTs?` 필드 추가 (옵셔널, 마이그레이션 불필요 — 기존 레코드엔 부재) |
| `src/lib/settings-storage.ts` | OAuth 토큰 storage 헬퍼 | `writeStoredSlackOAuthTokens` 추가 (현 패턴 따름) |
| `src/i18n/namespaces/integrations.ts` | 통합 i18n 키 | `platform.tab.slack` + `slack.*` 키 (ko/en 동시) |
| `manifest.config.ts` | 권한·호스트 | `host_permissions`에 `https://slack.com/*` 추가 |
| `.env` 문서/`vite-env` | env 정의 | `VITE_SLACK_CLIENT_ID` 추가 (`VITE_OAUTH_PROXY_URL` 재사용) |

## 데이터 흐름

```
[연결] IntegrationsTab → SlackConnectFlow
  → background slack.startOAuth
  → slack-oauth: authorize(user_scope) → redirect → code
  → proxy POST /slack/token → oauth.v2.access → authed_user.access_token (xoxp)
  → auth.test + users.info → SlackAccount{ auth, defaults } → settings-store

[대상 선택] SubmitFieldsDialog → ConversationField
  → background slack.listConversations(query)
  → conversations.list(types=public_channel,private_channel,im,mpim)
     + im은 users.info로 이름 resolve
  → SlackConversation[] → 콤보박스

[전송] IssueCreateModal.handleSubmit → submitToSlack
  1) buildSlackIssueBody(ctx) → markdown
  2) markdownToSlackBlocks(markdown) → { blocks, text }
  3) sendBg slack.postMessage { channel, blocks, text }
     → chat.postMessage → { channel, ts, permalink(getPermalink) }
  4) 첨부 있으면: sendBg slack.uploadFiles { channel, threadTs: ts, files }
     → files.getUploadURLExternal → PUT each → files.completeUploadExternal(thread_ts)
     (per-file 격리; 개별 실패 시 skip, 메시지 보존)
  5) return { key: ts, url: permalink }
  → issues-store.markSubmitted({ platform:"slack", slackChannelId, slackMessageTs, url })
  → editor-store.onSubmitted → phase "done"

[이슈 리스트] IssueRow → SubmittedBadge → SlackSubmittedBadge
  → 폴링 없음. "전송됨" 텍스트 + permalink 링크만.
```

### 첨부 파일 집합 (submitToSlack)

`submitToAsana`의 `allFiles` 조립과 동일하게:
- 캡처 이미지(screenshot / before·after)
- 본문에 붙여넣은 인라인 이미지(`inlineImages`) — Block Kit 인라인 불가하므로 **스레드 첨부로 강등**
- 영상(`video`, mp4) — 다른 파일과 동일하게 업로드
- 로그 파일(network/console/action html) + `buildAiMetaAttachment(ctx)`

## 인터페이스 설계

### `src/types/slack.ts`

```typescript
import type { PlatformAccountBase } from "./platform";

export interface SlackOAuthAuth {
  kind: "oauth";
  accessToken: string;   // xoxp- user token
  scope: string;
  teamId: string;
  teamName: string;
  authedUserId: string;  // Slack user ID (Uxxxx)
  viewerName: string;
  grantedAt: number;
}

// user token만 지원 (PAT/봇 토큰 없음)
export type SlackAuth = SlackOAuthAuth;

export interface SlackDefaults {
  conversationId?: string;
  conversationName?: string;
}

export interface SlackAccount extends PlatformAccountBase<"slack"> {
  auth: SlackAuth;
  defaults: SlackDefaults;
}

export interface SlackMyself {
  userId: string;
  name: string;
  teamId: string;
  teamName: string;
}

export type SlackConversationType = "channel" | "private" | "im" | "mpim";

export interface SlackConversation {
  id: string;            // Cxxxx / Dxxxx
  name: string;          // 채널명 또는 DM 상대 표시 이름
  type: SlackConversationType;
}

export interface SlackPostMessagePayload {
  channel: string;       // conversation id
  text: string;          // mrkdwn fallback (알림·접근성용)
  blocks: unknown[];     // Block Kit blocks
}

export interface SlackPostMessageResult {
  channel: string;
  ts: string;
  permalink: string;
}
```

### `src/types/platform.ts` 확장

```typescript
export type PlatformId =
  | "jira" | "github" | "linear" | "notion" | "gitlab" | "asana"
  | "slack";

export const PLATFORM_TAB_KEYS = {
  // ...
  slack: "platform.tab.slack",
} as const satisfies Record<PlatformId, string>;

export interface SlackLastSubmitFields {
  conversationId?: string;
  conversationName?: string;
}
// Accounts.slack?: SlackAccount;
// LastSubmitFieldsByPlatform.slack?: SlackLastSubmitFields;
```

### `src/types/messages.ts` — BgRequest 추가

```typescript
  | { type: "slack.oauth.available" }
  | { type: "slack.startOAuth" }
  | { type: "slack.disconnect" }
  | { type: "slack.getMyself" }
  | { type: "slack.listConversations"; query?: string }
  | { type: "slack.postMessage"; payload: SlackPostMessagePayload }
  | {
      type: "slack.uploadFiles";
      channel: string;
      threadTs: string;
      files: Array<{ filename: string; contentType: string; dataUrl: string }>;
    }
```

`getOAuthErrorPlatform`의 union 판정에 `p === "slack"` 추가.

### `src/sidepanel/lib/markdownToSlackBlocks.ts`

```typescript
export interface SlackBlocksResult {
  blocks: unknown[];   // Block Kit
  text: string;        // mrkdwn fallback (알림 표시용, 본문 평문화)
}

export function markdownToSlackBlocks(markdown: string): SlackBlocksResult;
```

변환 규칙:
- heading → `header` 블록(plain_text, ≤150자 truncate) 또는 굵은 `section`
- paragraph/list → `section`(mrkdwn). markdown bold `**x**` → `*x*`, italic `_x_`, `code` 유지, 링크 `[t](u)` → `<u|t>`
- code fence / 스타일 diff 테이블 → ```` ``` ```` 코드블록 `section`
- `---` → `divider`
- **3000자 제한**: 단일 `section` text는 3000자 초과 불가 → 길면 여러 section으로 분할
- **이미지 토큰**: Block Kit 인라인 불가 → alt 텍스트만 남기거나 제거 (실제 파일은 스레드 첨부)

### `src/sidepanel/lib/submitToSlack.ts`

```typescript
export interface SlackFileInput { filename: string; dataUrl: string; }

export interface SlackSubmitInput {
  ctx: MarkdownContext;
  images?: SlackFileInput[];
  video?: SlackFileInput;
  logs?: SlackFileInput[];
  inlineImages?: InlineImageInput[];  // 스레드 첨부로 강등
  conversationId: string;
}

export async function submitToSlack(
  input: SlackSubmitInput,
): Promise<NormalizedSubmitResult>;  // { key: ts, url: permalink }
```

### `src/background/slack-api.ts` (시그니처)

```typescript
export async function getMyself(auth: SlackAuth): Promise<SlackMyself>;
export async function listConversations(auth: SlackAuth, query?: string): Promise<SlackConversation[]>;
export async function postMessage(auth: SlackAuth, payload: SlackPostMessagePayload): Promise<SlackPostMessageResult>;
export async function uploadFiles(
  auth: SlackAuth,
  channel: string,
  threadTs: string,
  files: Array<{ filename: string; contentType: string; dataUrl: string }>,
): Promise<Array<{ filename: string; ok: boolean }>>;
```

## 기존 패턴 준수

- **어댑터 레이어 분리**: sidepanel은 `sendBg`로만 Slack API에 닿는다. 토큰은 background에서만 접근 (CLAUDE.md OAuth 토큰 흐름).
- **proxy 경유 token 교환**: Slack은 client secret이 필요하므로 `VITE_OAUTH_PROXY_URL`의 `/slack/token`을 경유한다 (Asana/GitHub/Notion 패턴). client secret은 확장에 두지 않는다.
- **per-file 격리 업로드**: 파일 개별 실패가 메시지 전송을 깨지 않게 background 핸들러에서 격리 (Asana `uploadFiles` 패턴).
- **세션 영속화**: `SlackAccount`·`lastSubmitFields.slack`은 settings-store에, 작성 중 상태는 editor-store에.
- **i18n 동시 갱신**: `src/i18n/`에 ko/en 키 함께 추가 (PostToolUse 훅이 대칭 검사).
- **`data-[state=inactive]:hidden`**: SubmitFieldsDialog의 Slack 탭 컨텐츠에 적용.
- **테스트 우선**: `markdownToSlackBlocks`는 순수 함수 → `__tests__`에 단위 테스트 먼저.
- **shadcn 컴포넌트**: ConversationField는 기존 Combobox 패턴(예: Asana ProjectField) 재사용.

## 대안 검토

1. **봇 토큰(xoxb) 방식** — 기각. 봇을 각 채널에 초대해야 글을 쓸 수 있어 UX 마찰이 크다. user token은 사용자가 이미 속한 채널/DM에 본인 명의로 바로 전송 가능.
2. **파일을 본문과 같은 메시지에 평탄화(`files.completeUploadExternal`의 `initial_comment`)** — 기각. completeUploadExternal은 Block Kit `blocks`를 못 받아 본문이 mrkdwn 평문으로 격하된다. Block Kit 구조화를 살리려면 본문(`chat.postMessage` blocks)과 첨부(스레드)를 분리해야 한다.
3. **대표 이미지 1장 외부 호스팅 후 인라인 image 블록** — 기각. 외부 호스팅 의존성·개인정보 노출 리스크가 생긴다. 전부 스레드 첨부가 단순·안전.
4. **`getIssueStatus`/`updateIssueState`를 no-op로라도 구현** — 기각. 호출처(폴링·토글 UI) 자체를 슬랙에서 안 만드는 게 더 단순. 정적 배지만.

## 위험 요소

- **Slack `files` 신규 업로드 플로우**: 구 `files.upload`는 deprecated. `files.getUploadURLExternal` → 외부 URL에 PUT → `files.completeUploadExternal`(`thread_ts`·`channel_id` 지정) 3-step을 정확히 구현해야 한다. background에서 fetch 3회.
- **CORS / 호스트 권한**: `https://slack.com/api/*` 호출은 `host_permissions`에 `https://slack.com/*` 필요. `getUploadURLExternal`이 반환하는 업로드 URL은 `files.slack.com` 등 별도 origin일 수 있어 — PUT 대상 origin을 확인하고 필요 시 권한/`fetch` 처리 (회귀 위험 포인트, 실제 워크스페이스 검증 필수).
- **mrkdwn fallback 정확성**: `text` 필드는 알림·접근성용. 비우면 Slack이 경고하므로 본문 요약을 넣되, Block Kit과 중복 표시되지 않도록 한다 (blocks가 있으면 text는 알림에만 쓰임).
- **section 3000자 제한 / 블록 50개 제한**: 긴 로그·diff가 한계를 넘지 않게 분할·요약. 초과 시 Slack API가 거부.
- **`PlatformId` union 확장의 누락 분기**: `"slack"` 추가 시 `satisfies Record<PlatformId, …>`·exhaustive switch가 컴파일 에러를 내는 지점을 모두 처리해야 한다. `pnpm typecheck`로 누락 적발. 특히 `PLATFORM_TAB_KEYS`(Record라 강제됨)와 SubmittedBadge/PlatformChip 분기.
- **DM 이름 resolve 비용**: `conversations.list`가 다수 `im`을 반환하면 `users.info` 호출이 늘 수 있다 → 콤보박스 검색 쿼리 기반으로 제한하거나 batch 고려.
- **토큰 만료 처리**: user token은 무기한이나 사용자가 권한 철회 시 `invalid_auth`/`token_revoked` → `oauthRefreshFailed` 동등 처리로 재연결 안내 (refresh 없음).
