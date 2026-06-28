# Slack 연동 — 기술 설계

## 개요

기존 ClickUp 어댑터(OAuth proxy 경유 + 만료 없는 토큰 + 단순 본문)를 레퍼런스로 8번째 플랫폼 `slack`을 추가한다. `PlatformId` union에 `"slack"`을 더하고, ClickUp과 유사한 파일 구조(`types/slack.ts`, `background/slack-oauth.ts`, `background/slack-api.ts`, `sidepanel/lib/submitToSlack.ts`, `sidepanel/lib/buildSlackBody.ts`, `sidepanel/tabs/slackFields/`, `sidepanel/tabs/connect/SlackConnectForm.tsx`, `statusBadges/SlackSubmittedBadge.tsx`)를 가져가되, **메시지 앱 특성상 갈리는 6개 지점**만 다르게 설계한다:

1. **컨테이너가 단일 계층(Channel)** — 워크스페이스는 OAuth로 고정, 채널만 선택. public/private/DM을 **플랫 리스트 + 종류 아이콘**으로(섹션 그룹핑 없음).
2. **제목(+멘션)/본문 분리 전송** — 제목과 멘션은 부모 메시지, 본문·첨부는 스레드 답글. 멘션은 선택한 워크스페이스 멤버를 `<@Uxxxx>`로 부모에 주입(알림 발송).
3. **mrkdwn 변환** — 마크다운과 다른 Slack 문법. 신규 순수 함수 `markdownToMrkdwn` + `escapeMrkdwn`(`<>&`).
4. **files 2-step 업로드** — `getUploadURLExternal` → PUT bytes → `completeUploadExternal(thread_ts)`.
5. **상태 없는 배지** — 폴링 없이 permalink 링크만(`isRefreshable` false 폴백이 **의도된** 동작).
6. **API 계약이 ClickUp과 다름** — Slack은 `ok:false` 패턴(HTTP 200+실패)이라 `slackFetch`/`SlackError` 시그니처가 ClickUp "복제"가 아니라 **분기**다(아래 인터페이스 참조).

Slack OAuth/REST host는 `<all_urls>`가 이미 커버하므로 **manifest 변경은 0**. 신규 env(`VITE_SLACK_CLIENT_ID`)와 OAuth proxy 라우트(`/slack/token`)만 추가된다. 멘션·DM 이름 해석을 위해 user_scope에 `users:read`를 포함한다.

**단일 제출 모델**: Slack은 다른 7개와 동등한 택1 최종 전송처다. 제출 시 `stripSubmitted`가 로컬 blob을 삭제하므로 재제출/승격은 없다(PRD "Slack ↔ 트래커 관계" 참조). 따라서 `SlackSubmittedBadge`는 상태/재제출 없는 정적 링크 배지다.

## 변경 범위

### 신규 파일

| 파일 | 역할 (레퍼런스) |
|---|---|
| `src/types/slack.ts` | Slack 타입 정의 (`types/clickup.ts` 패턴). `SlackAuth`(OAuth 전용), `SlackAccount`, `SlackDefaults`, `SlackChannel`, `SlackPostMessagePayload`, `SlackPostResult` 등 |
| `src/background/slack-oauth.ts` | OAuth v2 흐름 (`clickup-oauth.ts` 패턴). authorize URL 구성, `user_scope`, 콜백 파싱, proxy 경유 token 교환, `authed_user.access_token` 추출, `isSlackOAuthConfigured()` |
| `src/background/slack-api.ts` | Slack Web API 호출 (계약은 ClickUp과 **분기**). `slackFetch`(ok:false→`SlackError`), `getMyself`(auth.test), `listChannels`(users.conversations 커서 + `users.list` 1회로 user id→name 매핑), `listMembers`(users.list, 멘션용), `postMessage`, `uploadFiles`(2-step), `getPermalink`, `SlackError`, `messageForSlackError`, `normalizeChannel` |
| `src/sidepanel/lib/submitToSlack.ts` | 제출 오케스트레이션 (`submitToClickup.ts` 패턴). 부모 메시지(제목+멘션) → 스레드 본문 → 첨부 → permalink |
| `src/sidepanel/lib/buildSlackBody.ts` | 스레드 본문 mrkdwn 빌더 (`buildClickupIssueBody.ts` 패턴). 환경/스타일 diff(텍스트 줄)/로그 요약 + 사용자 섹션. selector·DOM 라벨·환경값에 `escapeMrkdwn` 적용 |
| `src/sidepanel/lib/markdownToMrkdwn.ts` | **신규 순수 변환기** + `escapeMrkdwn`. 마크다운 → Slack mrkdwn |
| `src/sidepanel/lib/__tests__/markdownToMrkdwn.test.ts` | 변환기 단위 테스트 |
| `src/sidepanel/lib/__tests__/buildSlackBody.test.ts` | 본문 빌더 단위 테스트 |
| `src/sidepanel/lib/__tests__/submitToSlack.test.ts` | 제출 오케스트레이션 단위 테스트(sendBg mock) |
| `src/sidepanel/tabs/slackFields/SlackIssueFields.tsx` | 채널 + 멘션 선택 필드 (`clickupFields/ClickupIssueFields.tsx` 패턴) |
| `src/sidepanel/tabs/slackFields/ChannelCombobox.tsx` | 채널 콤보박스 (`SingleLazyCombobox` 패턴, 플랫 + kind 아이콘) |
| `src/sidepanel/tabs/slackFields/MentionCombobox.tsx` | 멘션 대상 멀티셀렉트 (기존 `CcCombobox`/멀티 콤보박스 패턴, `listMembers` 조회) |
| `src/sidepanel/tabs/connect/SlackConnectForm.tsx` | 연결 UI (`ClickupConnectForm.tsx` 패턴, OAuth만 — PatDialog/ConnectMethodDialog 없음) |
| `src/sidepanel/tabs/statusBadges/SlackSubmittedBadge.tsx` | 전송됨 정적 배지 + permalink 링크 |

### 변경 파일 (wiring — ClickUp이 들어간 모든 지점에 slack 추가)

| 파일 | 변경 |
|---|---|
| `src/types/platform.ts` | `PlatformId`에 `"slack"`; `PLATFORM_TAB_KEYS.slack`; `Accounts.slack`; `SlackLastSubmitFields` + `LastSubmitFieldsByPlatform.slack` |
| `src/types/messages.ts` | `BgRequest`에 slack 메시지 타입들; `getOAuthErrorPlatform`에 `p === "slack"` 추가 (⚠️ 인라인 `===`라 typecheck 미감지 — 회귀 테스트 필수) |
| `src/background/bgRequestTypes.ts` | **`BG_REQUEST_TYPE_MAP`에 slack 메시지 7종 등록** (⚠️ 미등록 시 `index.ts` 화이트리스트 게이트가 전량 차단 — 과거 asana가 이 누락으로 런타임 전량 차단된 전례. `Record<BgRequest["type"],true>`라 typecheck가 잡음) |
| `src/background/messages.ts` | slack-api/slack-oauth import + `case "slack.*"` 분기 + `loadSlackAuth()` (switch에 `never`-guard default 있어 누락은 typecheck 감지) |
| `src/background/index.ts` | `SlackError` import + 에러 핸들러 분기 |
| `src/store/settings-store.ts` | `updateSlackAccount`; `PLATFORM_FALLBACK_ORDER`에 `"slack"` (⚠️ 배열 리터럴 — typecheck 미감지); `SETTINGS_STORE_VERSION` bump (v9→v10, 새 필드 전부 optional이라 마이그레이션 함수 없이 마커만) |
| `src/lib/settings-storage.ts` | `SettingsEnvelope.accounts.slack`; `readStoredSlackAuth()` |
| `src/lib/attachmentLimits.ts` | `PLATFORM_FILE_SIZE_LIMIT`(`Record<PlatformId,…>`)에 slack 항목 추가 (Slack 파일 한도 또는 `null`). typecheck가 누락 감지 |
| `src/sidepanel/tabs/IntegrationsTab.tsx` | `PLATFORMS`에 slack 엔트리 + import (⚠️ 배열 리터럴 — typecheck 미감지) |
| `src/sidepanel/tabs/SubmitFieldsDialog.tsx` | `PLATFORM_TABS`에 slack; `TABS_GRID_COLS`에 `8: "grid-cols-8"` 추가(⚠️ 2~7만 정의됨 — 누락 시 8탭 grid 깨짐, JIT 정적 추출 확인); `slackFields`/`setSlackFields` prop; `platformConfigured`/`fieldsReady` 케이스(switch+never — typecheck 감지); **`SlackIssueFields` 렌더 삼항 체인은 Notion 앞에 정확히 끼울 것**(⚠️ 마지막 fallback이 NotionIssueFields라 누락 시 silent Notion 표시 — typecheck 미감지, L164 주석 경고) |
| `src/sidepanel/tabs/IssueCreateModal.tsx` | `submitToSlack` import; `handleSlackSubmit`; `handleSubmit` 분기(⚠️ else→jira fallback — 누락 시 silent jira); slack defaults/lastSubmit 전달 |
| `src/sidepanel/tabs/statusBadges/SubmittedBadge.tsx` | `slackChannelId`/`slackTs` prop + slack 분기 (null fallback — typecheck 미감지) |
| `src/sidepanel/tabs/statusBadges/PlatformChip.tsx` | **slack 분기 추가** (⚠️ if-체인 끝 default가 GitHub — 누락 시 이슈 행 칩이 "GitHub"으로 오표시. typecheck 미감지) |
| `src/i18n/namespaces/app.ts` | `platform.tab.slack: "Slack"` (ko/en) |
| `src/i18n/namespaces/integrations.ts` | slack.* 키 블록 (ko/en) — 필드/에러/OAuth/채널 |
| `oauth-proxy/worker.ts` | `Env`에 `SLACK_CLIENT_ID/SECRET`; `SLACK_TOKEN_URL`; `/slack/token` 라우트 + `handleSlackToken` |
| `manifest.config.ts` | **변경 없음** (`<all_urls>` + `identity` 이미 커버). 문서에만 명시 |

### 아이콘
`@icons-pack/react-simple-icons`의 `SiSlack` import. Slack 브랜드는 멀티컬러 마크라 `color="default"` 사용, `dark:invert` 불필요(GitHub/Notion만 invert).

## 데이터 흐름

### OAuth (연결)
```
SlackConnectFlow "연결" 클릭
  → sendBg({type:"slack.startOAuth"})
    → slack-oauth.startSlackOAuth()
      → launchOAuthWebFlow(authorizeUrl, "slack")   // user_scope(…,users:read), redirect=getRedirectURL()
      → parseSlackCallbackParams(redirect, state)    // code 추출
      → exchangeCode(code) via POST {PROXY}/slack/token
          ← { ok:true, authed_user:{ id, access_token, scope }, team:{ id, name } }
      → auth.test로 표시 이름/team 보강
  ← SlackOAuthAuth + team
  → setAccount("slack", { platform, connectedAt, auth, teamId, teamName, defaults:{} })
```

### 채널 목록 (DM 이름 N+1 회피)
```
ChannelCombobox 열림
  → sendBg({type:"slack.listChannels"})
    → slack-api.listChannels(auth)
       → GET users.conversations?types=public_channel,private_channel,im,mpim&limit=200 (cursor 반복)
       → im/mpim의 user id 모음 → users.list 1회 호출로 id→name 맵 구성(N+1 회피)
       → 맵으로 DM 이름 해석. 맵 결과는 메모리 캐시(재오픈 시 재호출 안 함)
  ← SlackChannel[]  (플랫 리스트, kind별 아이콘. 이름 미해석 시 user id 폴백)
```
채널은 먼저 반환하고 DM 이름은 배치(`users.list` 1회)로 채운다 → `users.conversations`(Tier 2) + 개별 `users.info` N+1로 인한 rate_limited 회피.

### 멘션 대상 목록
```
MentionCombobox 열림
  → sendBg({type:"slack.listMembers"})  → users.list (활성 멤버, 봇 제외)
  ← SlackUser[]   // 캐시 공유 가능(listChannels의 users.list 결과 재사용)
```

### 전송 (제목+멘션=부모, 본문/첨부=스레드)
```
handleSlackSubmit(ctx, inlineImages, captureFiles, mentions)
  → submitToSlack({ ctx, channelId, mentions, images, video, logs, attachments, inlineImages })
     1) parentText = titleMrkdwn + (mentions ? "\n" + mentions.map(m=>`<@${m.id}>`).join(" ") : "")
        parent = sendBg({type:"slack.postMessage", payload:{ channelId, text: parentText }})
            → chat.postMessage → { ts }
     2) body = buildSlackBody({ ctx })                       // 환경+섹션+diff(텍스트)+로그요약, mrkdwn
        reply = sendBg({type:"slack.postMessage", payload:{ channelId, text: body, threadTs: parent.ts }})
     3) if files: sendBg({type:"slack.uploadFiles", channelId, threadTs: parent.ts, files})
            → files.getUploadURLExternal → PUT bytes → files.completeUploadExternal(channel_id, thread_ts)
            → { filename, ok }[]  (logsDropped 판정)
     4) permalink = sendBg({type:"slack.getPermalink", channelId, ts: parent.ts})
  ← { key: parent.ts, url: permalink, logsDropped }
  → markSubmitted(issueId, { platform:"slack", key, url, slackChannelId, slackTs:key })
  → setLastSubmitFields("slack", { channelId, channelName })
```

스타일 diff before/after 스냅샷과 본문 inline 붙여넣기 이미지도 모두 **스레드 첨부**로 보낸다(인라인 미지원). 본문에는 스타일 diff를 텍스트(프로퍼티: as-is → to-be)로만 남긴다. 멘션은 부모 메시지에만 주입(스레드가 아니라 채널 메시지에 둬야 호명자에게 알림이 확실히 간다).

## 인터페이스 설계

### `src/types/slack.ts`
```typescript
import type { PlatformAccountBase } from "./platform";

export interface SlackOAuthAuth {
  kind: "oauth";
  accessToken: string; // xoxp- user token. 만료 없음(rotation 미사용) → refresh/expiresAt 없음
  grantedAt: number;
  viewerId: string;    // Slack user id (Uxxxx)
  viewerName: string;  // real_name 또는 display_name
}
export type SlackAuth = SlackOAuthAuth; // OAuth 전용 (BYOK 없음)

export interface SlackDefaults {
  channelId?: string;
  channelName?: string;
}

export interface SlackAccount extends PlatformAccountBase<"slack"> {
  auth: SlackAuth;
  teamId: string;
  teamName: string;
  defaults: SlackDefaults;
}

export type SlackChannelKind = "public" | "private" | "im" | "mpim";

export interface SlackChannel {
  id: string;
  name: string;          // "#general" | DM 상대 이름 | 그룹 DM 라벨
  kind: SlackChannelKind;
}

export interface SlackUser {     // 멘션 대상 / DM 이름 매핑
  id: string;            // Uxxxx
  name: string;          // display_name || real_name
}

export interface SlackPostMessagePayload {
  channelId: string;
  text: string;          // mrkdwn
  threadTs?: string;     // 있으면 스레드 답글
}
export interface SlackPostResult {
  ts: string;            // 메시지 timestamp (= 식별자)
}

export interface SlackUploadResult {
  filename: string;
  ok: boolean;
}

export interface SlackPermalinkResult {
  permalink: string;
}
```

### `src/types/platform.ts` 추가
```typescript
export type PlatformId = "jira" | "github" | "linear" | "notion" | "gitlab" | "asana" | "clickup" | "slack";

// PLATFORM_TAB_KEYS에:  slack: "platform.tab.slack",
// Accounts에:           slack?: SlackAccount;

export interface SlackLastSubmitFields {
  channelId?: string;
  channelName?: string;
  mentions?: { id: string; name: string }[];
}
// LastSubmitFieldsByPlatform에:  slack?: SlackLastSubmitFields;
```

### `src/types/messages.ts` 추가 (BgRequest)
```typescript
| { type: "slack.oauth.available" }
| { type: "slack.startOAuth" }
| { type: "slack.disconnect" }
| { type: "slack.listChannels" }
| { type: "slack.listMembers" }
| { type: "slack.postMessage"; payload: SlackPostMessagePayload }
| {
    type: "slack.uploadFiles";
    channelId: string;
    threadTs: string;
    files: Array<{ filename: string; contentType: string; dataUrl: string }>;
  }
| { type: "slack.getPermalink"; channelId: string; ts: string }
```
`getOAuthErrorPlatform`의 union 체크에 `p === "slack"` 추가 (인라인 `===`라 typecheck가 못 잡음 → Task 7에서 회귀 테스트로 보강). 위 8종 메시지 타입은 모두 `bgRequestTypes.ts`의 `BG_REQUEST_TYPE_MAP`에도 등록해야 한다(미등록 시 런타임 전량 차단).

### `src/background/slack-api.ts` 핵심 시그니처
> ⚠️ ClickUp "복제"가 아니라 **분기**다. ClickUp은 HTTP status 기반(`clickupFetch(auth, path, init)`, `ClickupError(status, message, body?)`)이지만, Slack은 `ok:false` 패턴이라 메서드·에러 모델이 다르다.
```typescript
const API_BASE = "https://slack.com/api";

// body에 platform을 실어야 getOAuthErrorPlatform(err.body.platform)이 revoke→재연결을 라우팅한다.
// (ClickupError처럼) index.ts가 body를 직렬화하므로 SlackError가 body를 들고 있어야 한다.
export class SlackError extends Error {
  constructor(
    public code: string,            // Slack error string ("token_revoked", "not_in_channel"…)
    message: string,
    public status = 200,
    public body: { platform: "slack" } = { platform: "slack" },
  ) { super(message); }
}

// Slack은 HTTP 200 + { ok:false, error } 패턴 → ok 필드로 분기. Authorization: Bearer <user token>.
// ok:false면 messageForSlackError(code)로 i18n 메시지 매핑해 SlackError throw.
async function slackFetch<T>(auth: SlackAuth, method: string, params: object): Promise<T>;
export function messageForSlackError(code: string): string;   // 순수 함수, 테스트 대상
export function normalizeChannel(raw: object): SlackChannel;   // 순수 함수, kind 라벨링

export async function getMyself(auth: SlackAuth): Promise<{ id: string; name: string; teamId: string; teamName: string }>;
export async function listChannels(auth: SlackAuth): Promise<SlackChannel[]>;   // conversations 커서 + users.list 1회로 DM 이름 매핑
export async function listMembers(auth: SlackAuth): Promise<SlackUser[]>;       // users.list (멘션 대상)
export async function postMessage(auth: SlackAuth, p: SlackPostMessagePayload): Promise<SlackPostResult>;
export async function uploadFiles(
  auth: SlackAuth, channelId: string, threadTs: string,
  files: Array<{ filename: string; blob: Blob }>,
): Promise<SlackUploadResult[]>;                                                     // 2-step, 파일별 격리
export async function getPermalink(auth: SlackAuth, channelId: string, ts: string): Promise<string>;
```

### `src/sidepanel/lib/markdownToMrkdwn.ts` 변환 규칙 (순수 함수)
```typescript
export function markdownToMrkdwn(md: string): string;
export function escapeMrkdwn(text: string): string;   // < > & → &lt; &gt; &amp; (코드블록/링크 외 평문)
```
기존 escape(`escapeMarkdown`·`escapeMdLinkText`·`escapeCell`)는 마크다운 전용이라 `<>&`를 커버 못 한다 → 신규 `escapeMrkdwn` 필요. `buildSlackBody`의 selector·DOM 라벨·환경값에도 적용.
| 마크다운 | mrkdwn |
|---|---|
| `**bold**` | `*bold*` |
| `*italic*` / `_italic_` | `_italic_` |
| `~~strike~~` | `~strike~` |
| `[text](url)` | `<url\|text>` |
| `# H1` / `## H2` … | `*H1*` (볼드 줄, 헤딩 문법 없음) |
| `- item` / `* item` | `• item` |
| `1. item` | `1. item` (유지) |
| `` `code` `` / ```` ```block``` ```` | 동일 |
| `> quote` | `> quote` (유지) |
| `![alt](url)` | 제거 (이미지는 첨부로) |
| 테이블 `\| … \|` | 라인별 평문 fallback (mrkdwn 테이블 없음) |

### `src/sidepanel/lib/submitToSlack.ts`
```typescript
export interface SlackFileInput { filename: string; dataUrl: string; displayName?: string; }
export interface SlackSubmitInput {
  ctx: MarkdownContext;
  images?: SlackFileInput[];
  video?: SlackFileInput;
  logs?: SlackFileInput[];
  attachments?: SlackFileInput[];
  inlineImages?: InlineImageInput[];
  channelId: string;
  mentions?: { id: string; name: string }[];   // 부모 메시지에 <@id>로 주입
}
export async function submitToSlack(input: SlackSubmitInput): Promise<NormalizedSubmitResult>;
```

## 기존 패턴 준수

- **세션/영속화**: `SlackAccount`는 `chrome.storage.local`(zustand persist)에 저장 — ClickUp과 동일. `SETTINGS_STORE_VERSION`을 v10으로 bump(새 필드 전부 optional이라 마커만).
- **메시지 비동기 응답**: 모든 백그라운드 호출은 `sendBg<T>` + `messages.ts` switch case. ClickUp과 동일.
- **에러 분류**: `SlackError`가 `body:{platform:"slack"}`를 들고 있어야 `background/index.ts`가 `{ ok:false, status, body }`로 직렬화하고 `getOAuthErrorPlatform(err.body.platform)`가 revoke→재연결을 라우팅한다(ClickupError가 body를 운반하는 것과 동일 메커니즘). `SlackError` 생성자에 body 기본값 포함.
- **i18n 동시 갱신**: `app.ts`·`integrations.ts`의 ko/en을 함께 갱신(PostToolUse 훅이 대칭성 검사).
- **OAuth proxy 패턴**: client_secret이 필요한 token 교환은 proxy 경유(ClickUp/Notion/Asana와 동일). Slack은 ClickUp처럼 만료 없는 토큰 → refresh 라우트 불필요.
- **테스트 우선**: 신규 순수 함수(`markdownToMrkdwn`, `buildSlackBody`, `listChannels` 응답 정규화)는 단위 테스트 먼저.
- **shadcn 재사용**: 채널 콤보박스는 기존 `clickupFields`의 Combobox/Command 패턴 그대로.

## 대안 검토

1. **제목·본문을 한 메시지에 합치기** (스레드 미사용)
   채널 타임라인이 길어지고 환경/diff/로그가 채널을 도배한다. 사용자가 명시적으로 "본문을 스레드로" 요청 → 스레드 모델 채택.

2. **Block Kit으로 리치 렌더** (header/section/divider 블록)
   테이블·구조화에 유리하나 변환 로직이 무겁고, 블록당 글자수·블록 수 제한이 까다롭다. mrkdwn 평문이 단순·견고. 채택하지 않음.

3. **Bot token 모델**
   bot이 채널에 초대돼야 전송 가능 → 매 채널 초대 마찰. 메시지 앱에선 "본인이 보낸 것처럼"이 자연스러워 user token 채택(사용자 선택).

4. **legacy `files.upload` (단일 호출) 사용**
   2025년 Slack이 deprecate·종료. 신규 2-step(`getUploadURLExternal`+`completeUploadExternal`)만 유효. 신규 API 채택.

5. **`markdownToMrkdwn` 대신 기존 `markdownToAsanaHtml` 류 재사용**
   포맷이 전혀 다르다(HTML vs mrkdwn). 재사용 불가. 신규 변환기 필요.

## 위험 요소

- **Slack API의 `ok:false` 패턴**: HTTP 200이어도 `{ok:false, error}`. `slackFetch`에서 반드시 `ok` 분기. status 기반 분류(ClickUp 패턴)를 그대로 쓰면 에러를 못 잡는다 → `error` 문자열(`not_in_channel`, `channel_not_found`, `token_revoked`, `rate_limited` 등)로 메시지 매핑.
- **files 2-step 순서·thread_ts**: `completeUploadExternal`에 `channel_id`와 `thread_ts`를 같이 넘겨야 스레드에 붙는다. 누락 시 채널 루트에 별도로 떨어진다. 업로드 URL PUT은 `multipart/form-data`.
- **PlatformId union 확장 회귀 (typecheck가 일부만 잡는다)**: `messages.ts`(switch+`never`-guard default), `SubmitFieldsDialog`의 2개 switch, `PLATFORM_TAB_KEYS`/`PLATFORM_FILE_SIZE_LIMIT`(`Record<PlatformId>`)는 typecheck가 누락을 **잡는다**. 그러나 **typecheck가 못 잡는 수동 지점**이 다수다 → 별도 grep으로 확인 필수: `PlatformChip.tsx`(if-체인 default=GitHub), `SubmitFieldsDialog` 필드 렌더 **삼항 체인**(fallback=Notion), `getOAuthErrorPlatform`(인라인 `===`), `PLATFORM_FALLBACK_ORDER`(배열), `IntegrationsTab.PLATFORMS`(배열), `IssueCreateModal.handleSubmit`(else→jira), `SubmittedBadge`(null fallback), `TABS_GRID_COLS`(2~7만 정의). 이 목록이 Task 1·12·13의 체크리스트다.
- **채널 페이지네이션·rate limit**: `users.conversations`는 Tier 2(분당 ~20). 큰 워크스페이스는 `limit=200` + cursor 반복. 기존 어댑터에 429 백오프 코드가 없으므로, `rate_limited`는 재시도 없이 사용자 안내(`messageForSlackError`)로 처리. DM 이름은 개별 `users.info`(N+1) 대신 **`users.list` 1회**로 일괄 매핑해 추가 호출을 1회로 묶는다.
- **DM 이름 해석 비용**: im/mpim은 이름이 없어 user 해석 필요 → `users.list` 1회 호출 결과를 메모리 캐시(`listChannels`/`listMembers` 공유). 채널은 먼저 표시하고 이름은 배치로 채운다. 미해석 시 user id 폴백.
- **OAuth user token 추출 위치**: oauth.v2.access 응답에서 user token은 최상위 `access_token`(bot)이 아니라 **`authed_user.access_token`**. bot scope를 비우고 user_scope만 요청하면 bot 토큰은 안 온다. 추출 지점 혼동 주의.
- **logs.html 첨부**: Slack은 .html 업로드 허용 → ClickUp처럼 zip 래핑 불필요. 단 업로드 실패 시 `logsDropped` 처리 유지.
- **mrkdwn 이스케이프**: `<`, `>`, `&`는 mrkdwn에서 특수문자 → 본문 평문에 포함 시 `&lt;`/`&gt;`/`&amp;` 이스케이프 필요(특히 셀렉터·DOM 라벨, `buildClickupIssueBody`는 selector를 raw 삽입함). 신규 `escapeMrkdwn`을 `markdownToMrkdwn`/`buildSlackBody` **양쪽**에서 적용. 단, 멘션 `<@Uxxxx>`와 링크 `<url|text>`는 이스케이프 대상 아님(생성 시점 분리).
- **files 업로드 PUT의 SSRF**: `getUploadURLExternal`가 반환한 `upload_url`로의 PUT은 ssrf-guard(`css.fetchSheets` 전용)를 거치지 않는다. 단 ① 인증된 Slack 호출 후 받은 URL이고 ② 응답을 페이지에 반영하지 않는 outbound라 SSRF 표면이 작다 — 차단 사유 아님, 인지만. user token 평문 저장도 기존 7개 플랫폼과 동일 posture(별도 회귀 아님).
