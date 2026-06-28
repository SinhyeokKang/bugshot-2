# Slack 연동 — 기술 설계

## 개요

기존 ClickUp 어댑터(OAuth proxy 경유 + 만료 없는 토큰 + 단순 본문)를 레퍼런스로 8번째 플랫폼 `slack`을 추가한다. `PlatformId` union에 `"slack"`을 더하고, ClickUp과 동일한 파일 구조(`types/slack.ts`, `background/slack-oauth.ts`, `background/slack-api.ts`, `sidepanel/lib/submitToSlack.ts`, `sidepanel/lib/buildSlackBody.ts`, `sidepanel/tabs/slackFields/`, `sidepanel/tabs/connect/SlackConnectForm.tsx`, `statusBadges/SlackSubmittedBadge.tsx`)를 복제하되, **메시지 앱 특성상 갈리는 5개 지점**만 다르게 설계한다:

1. **컨테이너가 단일 계층(Channel)** — 워크스페이스는 OAuth로 고정, 채널만 선택.
2. **제목/본문 분리 전송** — 제목은 부모 메시지, 본문·첨부는 스레드 답글.
3. **mrkdwn 변환** — 마크다운과 다른 Slack 문법. 신규 순수 함수 `markdownToMrkdwn`.
4. **files 2-step 업로드** — `getUploadURLExternal` → PUT bytes → `completeUploadExternal(thread_ts)`.
5. **상태 없는 배지** — 폴링 없이 permalink 링크만.

Slack OAuth/REST host는 `<all_urls>`가 이미 커버하므로 **manifest 변경은 0**. 신규 env(`VITE_SLACK_CLIENT_ID`)와 OAuth proxy 라우트(`/slack/token`)만 추가된다.

## 변경 범위

### 신규 파일

| 파일 | 역할 (레퍼런스) |
|---|---|
| `src/types/slack.ts` | Slack 타입 정의 (`types/clickup.ts` 패턴). `SlackAuth`(OAuth 전용), `SlackAccount`, `SlackDefaults`, `SlackChannel`, `SlackPostMessagePayload`, `SlackPostResult` 등 |
| `src/background/slack-oauth.ts` | OAuth v2 흐름 (`clickup-oauth.ts` 패턴). authorize URL 구성, `user_scope`, 콜백 파싱, proxy 경유 token 교환, `authed_user.access_token` 추출, `isSlackOAuthConfigured()` |
| `src/background/slack-api.ts` | Slack Web API 호출 (`clickup-api.ts` 패턴). `slackFetch`(ok:false 처리), `getMyself`(auth.test+users.info), `listChannels`(users.conversations 커서), `postMessage`, `uploadFiles`(2-step), `getPermalink`, `SlackError` |
| `src/sidepanel/lib/submitToSlack.ts` | 제출 오케스트레이션 (`submitToClickup.ts` 패턴). 부모 메시지 → 스레드 본문 → 첨부 → permalink |
| `src/sidepanel/lib/buildSlackBody.ts` | 스레드 본문 mrkdwn 빌더 (`buildClickupIssueBody.ts` 패턴). 환경/스타일 diff/로그 요약 + 사용자 섹션 |
| `src/sidepanel/lib/markdownToMrkdwn.ts` | **신규 순수 변환기**. 마크다운 → Slack mrkdwn |
| `src/sidepanel/lib/__tests__/markdownToMrkdwn.test.ts` | 변환기 단위 테스트 |
| `src/sidepanel/lib/__tests__/buildSlackBody.test.ts` | 본문 빌더 단위 테스트 |
| `src/sidepanel/tabs/slackFields/SlackIssueFields.tsx` | 채널 선택 필드 (`clickupFields/ClickupIssueFields.tsx` 패턴, 단일 콤보박스) |
| `src/sidepanel/tabs/slackFields/ChannelCombobox.tsx` | 채널 콤보박스 (`clickupFields`의 Combobox 패턴) |
| `src/sidepanel/tabs/connect/SlackConnectForm.tsx` | 연결 UI (`ClickupConnectForm.tsx` 패턴, OAuth만 — PatDialog 없음) |
| `src/sidepanel/tabs/statusBadges/SlackSubmittedBadge.tsx` | 전송됨 정적 배지 + permalink 링크 |

### 변경 파일 (wiring — ClickUp이 들어간 모든 지점에 slack 추가)

| 파일 | 변경 |
|---|---|
| `src/types/platform.ts` | `PlatformId`에 `"slack"`; `PLATFORM_TAB_KEYS.slack`; `Accounts.slack`; `SlackLastSubmitFields` + `LastSubmitFieldsByPlatform.slack` |
| `src/types/messages.ts` | `BgRequest`에 slack 메시지 타입들; `getOAuthErrorPlatform`에 `p === "slack"` 추가 |
| `src/background/messages.ts` | slack-api/slack-oauth import + `case "slack.*"` 분기 + `loadSlackAuth()` |
| `src/background/index.ts` | `SlackError` import + 에러 핸들러 분기 |
| `src/store/settings-store.ts` | `updateSlackAccount`; `PLATFORM_FALLBACK_ORDER`에 `"slack"`; `SETTINGS_STORE_VERSION` bump (v10) |
| `src/lib/settings-storage.ts` | `SettingsEnvelope.accounts.slack`; `readStoredSlackAuth()` |
| `src/sidepanel/tabs/IntegrationsTab.tsx` | `PLATFORMS`에 slack 엔트리 + import |
| `src/sidepanel/tabs/SubmitFieldsDialog.tsx` | `PLATFORM_TABS`에 slack; `slackFields`/`setSlackFields` prop; `platformConfigured`/`fieldsReady` 케이스; `SlackIssueFields` 렌더 분기 |
| `src/sidepanel/tabs/IssueCreateModal.tsx` | `submitToSlack` import; `handleSlackSubmit`; `handleSubmit` 분기; slack defaults/lastSubmit 전달 |
| `src/sidepanel/tabs/statusBadges/SubmittedBadge.tsx` | `slackChannelId`/`slackTs` prop + slack 분기 |
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
      → launchOAuthWebFlow(authorizeUrl, "slack")   // user_scope, redirect=getRedirectURL()
      → parseSlackCallback(redirect, state)          // code 추출
      → exchangeCode(code) via POST {PROXY}/slack/token
          ← { ok:true, authed_user:{ id, access_token, scope }, team:{ id, name } }
      → users.info(authed_user.id) 로 표시 이름 보강(또는 auth.test)
  ← SlackOAuthAuth + team
  → setAccount("slack", { platform, connectedAt, auth, teamId, teamName, defaults:{} })
```

### 채널 목록
```
ChannelCombobox 열림
  → sendBg({type:"slack.listChannels"})
    → slack-api.listChannels(auth)
       → GET users.conversations?types=public_channel,private_channel,im,mpim&limit=200 (cursor 반복)
       → im은 users.info로 상대 이름 해석
  ← SlackChannel[]  (kind별 라벨링)
```

### 전송 (제목=부모, 본문/첨부=스레드)
```
handleSlackSubmit(ctx, inlineImages, captureFiles)
  → submitToSlack({ ctx, channelId, images, video, logs, attachments, inlineImages })
     1) parent = sendBg({type:"slack.postMessage", channelId, text: titleMrkdwn})
            → chat.postMessage → { ts }
     2) body = buildSlackBody({ ctx })                       // 환경+섹션+diff+로그요약, mrkdwn
        reply = sendBg({type:"slack.postMessage", channelId, text: body, threadTs: parent.ts})
     3) if files: sendBg({type:"slack.uploadFiles", channelId, threadTs: parent.ts, files})
            → files.getUploadURLExternal → PUT bytes → files.completeUploadExternal
            → { filename, ok }[]  (logsDropped 판정)
     4) permalink = sendBg({type:"slack.getPermalink", channelId, ts: parent.ts})
  ← { key: parent.ts, url: permalink, logsDropped }
  → markSubmitted(issueId, { platform:"slack", key, url, slackChannelId, slackTs:key })
  → setLastSubmitFields("slack", { channelId, channelName })
```

스타일 diff before/after 스냅샷과 본문 inline 붙여넣기 이미지도 모두 **스레드 첨부**로 보낸다(인라인 미지원). 본문에는 스타일 diff를 텍스트(프로퍼티: as-is → to-be)로만 남긴다.

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
}
// LastSubmitFieldsByPlatform에:  slack?: SlackLastSubmitFields;
```

### `src/types/messages.ts` 추가 (BgRequest)
```typescript
| { type: "slack.oauth.available" }
| { type: "slack.startOAuth" }
| { type: "slack.disconnect" }
| { type: "slack.listChannels" }
| { type: "slack.postMessage"; payload: SlackPostMessagePayload }
| {
    type: "slack.uploadFiles";
    channelId: string;
    threadTs: string;
    files: Array<{ filename: string; contentType: string; dataUrl: string }>;
  }
| { type: "slack.getPermalink"; channelId: string; ts: string }
```
`getOAuthErrorPlatform`의 union 체크에 `p === "slack"` 추가.

### `src/background/slack-api.ts` 핵심 시그니처
```typescript
const API_BASE = "https://slack.com/api";

export class SlackError extends Error {
  constructor(public code: string, message: string, public status = 200) { super(message); }
}

// Slack은 HTTP 200 + { ok:false, error } 패턴 → ok 필드로 분기. Authorization: Bearer <user token>.
async function slackFetch<T>(auth: SlackAuth, method: string, params: object): Promise<T>;

export async function getMyself(auth: SlackAuth): Promise<{ id: string; name: string; teamId: string; teamName: string }>;
export async function listChannels(auth: SlackAuth): Promise<SlackChannel[]>;       // users.conversations 커서 반복
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
```
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
}
export async function submitToSlack(input: SlackSubmitInput): Promise<NormalizedSubmitResult>;
```

## 기존 패턴 준수

- **세션/영속화**: `SlackAccount`는 `chrome.storage.local`(zustand persist)에 저장 — ClickUp과 동일. `SETTINGS_STORE_VERSION`을 v10으로 bump(새 필드 전부 optional이라 마커만).
- **메시지 비동기 응답**: 모든 백그라운드 호출은 `sendBg<T>` + `messages.ts` switch case. ClickUp과 동일.
- **에러 분류**: `SlackError`를 `background/index.ts`에서 분기해 `{ ok:false, status, body:{platform:"slack"} }`로 응답 → `onOAuthExpired` 연동(revoke 시 재연결 안내).
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
- **PlatformId union 확장 회귀**: `"slack"` 추가로 exhaustive switch(없는 default) 지점이 타입 에러로 드러난다 → `messages.ts`/`SubmittedBadge`/`SubmitFieldsDialog`/store fallback order 등 **전부** 채워야 `typecheck` 통과. 누락 탐지는 typecheck가 게이트.
- **채널 페이지네이션·rate limit**: `users.conversations`는 Tier 2(분당 ~20). 큰 워크스페이스는 `limit=200` + cursor 반복. `rate_limited`(429 또는 ok:false) 시 재시도/안내.
- **DM 이름 해석 비용**: im 채널은 이름이 없어 `users.info` 추가 호출 필요 → N+1. 1차엔 채널명 비면 user id 폴백 허용, 과도한 호출 자제.
- **OAuth user token 추출 위치**: oauth.v2.access 응답에서 user token은 최상위 `access_token`(bot)이 아니라 **`authed_user.access_token`**. bot scope를 비우고 user_scope만 요청하면 bot 토큰은 안 온다. 추출 지점 혼동 주의.
- **logs.html 첨부**: Slack은 .html 업로드 허용 → ClickUp처럼 zip 래핑 불필요. 단 업로드 실패 시 `logsDropped` 처리 유지.
- **mrkdwn 이스케이프**: `<`, `>`, `&`는 mrkdwn에서 특수문자 → 본문 평문에 포함 시 `&lt;`/`&gt;`/`&amp;` 이스케이프 필요(특히 셀렉터·DOM 라벨). `markdownToMrkdwn`/`buildSlackBody`에서 처리.
