# Slack 연동 — 구현 태스크

## 선행 조건

- **Slack 앱 등록** (api.slack.com/apps): OAuth & Permissions에서 **User Token Scopes** 추가 — `chat:write`, `channels:read`, `groups:read`, `im:read`, `mpim:read`, `files:write`. Redirect URL에 `chrome.identity.getRedirectURL()` 값(dev/prod 두 개) 등록.
- **env**: `VITE_SLACK_CLIENT_ID`(.env.local), OAuth proxy에 `SLACK_CLIENT_ID`/`SLACK_CLIENT_SECRET`. (`VITE_OAUTH_PROXY_URL`은 기존 값 재사용.)
- **manifest 변경 없음**: `<all_urls>` + `identity` 권한이 이미 Slack OAuth/REST를 커버.
- 레퍼런스: ClickUp 어댑터 전체(`*clickup*` 파일들). 갈리는 지점은 design.md "변경 범위" 표 참조.

## 태스크

### Task 1: 타입 정의 (`src/types/slack.ts` + `platform.ts` 확장)
- **변경 대상**: `src/types/slack.ts`(신규), `src/types/platform.ts`
- **작업 내용**: design.md "인터페이스 설계"의 `SlackOAuthAuth`/`SlackAuth`/`SlackAccount`/`SlackDefaults`/`SlackChannel`/`SlackPostMessagePayload`/`SlackPostResult`/`SlackUploadResult`/`SlackPermalinkResult` 정의. `platform.ts`에 `PlatformId` `"slack"` 추가, `PLATFORM_TAB_KEYS.slack`, `Accounts.slack`, `SlackLastSubmitFields` + `LastSubmitFieldsByPlatform.slack`.
- **검증**:
  - [ ] `pnpm typecheck`가 `platform.ts` 변경으로 인한 누락 지점을 에러로 드러낸다(이후 태스크의 체크리스트가 됨).
  - [ ] 순환 import 없음(`clickup.ts` import 구조와 동일).

### Task 2: mrkdwn 변환기 (`markdownToMrkdwn.ts`) — 테스트 우선
- **변경 대상**: `src/sidepanel/lib/markdownToMrkdwn.ts`(신규), `__tests__/markdownToMrkdwn.test.ts`(신규)
- **작업 내용**: design.md 변환 규칙표대로 마크다운 → mrkdwn. 볼드/이탤릭/취소선/링크/헤딩→볼드줄/불릿/코드/인용/이미지제거/테이블 fallback. `<`·`>`·`&` 이스케이프.
- **검증**:
  - [ ] 각 규칙별 테스트 케이스(볼드, 링크 `[t](u)`→`<u|t>`, 헤딩, 불릿, 이미지 제거, 이스케이프) green.
  - [ ] 코드블록 내부는 변환하지 않음(```` ``` ```` 보존) 케이스 통과.

### Task 3: 본문 빌더 (`buildSlackBody.ts`) — 테스트 우선
- **변경 대상**: `src/sidepanel/lib/buildSlackBody.ts`(신규), `__tests__/buildSlackBody.test.ts`(신규)
- **작업 내용**: `buildClickupIssueBody.ts` 구조 차용. 환경 정보(OS/Browser/Page/DOM/Viewport/Captured/environment rows) + 사용자 섹션(`ctx.sections`, `markdownToMrkdwn` 적용) + 스타일 diff를 **텍스트 줄**(`prop: as-is → to-be`, 테이블 아님) + 로그 요약 + footer(`_Reported via BugShot_`). 이미지/영상/첨부는 본문에 넣지 않음(스레드 첨부로 분리).
- **검증**:
  - [ ] 환경 행·로그 요약·footer가 mrkdwn으로 렌더되는 스냅샷 테스트.
  - [ ] 스타일 diff가 테이블이 아닌 줄 나열로 출력.
  - [ ] 빈 섹션은 `md.noValue` 폴백.

### Task 4: OAuth (`slack-oauth.ts`)
- **변경 대상**: `src/background/slack-oauth.ts`(신규)
- **작업 내용**: `clickup-oauth.ts` 패턴. authorize URL `https://slack.com/oauth/v2/authorize`(`client_id`/`user_scope`/`redirect_uri`/`state`). `parseSlackCallbackParams`. `exchangeCode` → `POST {PROXY}/slack/token`. 응답 `authed_user.access_token`(user token)·`team` 추출. `getMyself`로 표시 이름 보강. `isSlackOAuthConfigured()`. cancel 코드(`access_denied`) 처리.
- **검증**:
  - [ ] `isSlackOAuthConfigured()`가 env 부재 시 false → UI 비활성(`isClickupOAuthConfigured` 패턴).
  - [ ] state mismatch / code missing 에러 경로 동작.
  - [ ] 수동: 실제 OAuth로 user token + team 저장 확인.

### Task 5: OAuth proxy 라우트 (`oauth-proxy/worker.ts`)
- **변경 대상**: `oauth-proxy/worker.ts`
- **작업 내용**: `Env`에 `SLACK_CLIENT_ID`/`SLACK_CLIENT_SECRET`, `SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access"`, `/slack/token` 라우트 + `handleSlackToken`(`handleClickupToken` 패턴, `client_id` 검증, `application/x-www-form-urlencoded`로 client_id/secret/code/redirect_uri 전달, `relayUpstream`).
- **검증**:
  - [ ] proxy 단위 테스트(worker 테스트 존재 시) 또는 로컬 호출로 200 + `{ok:true, authed_user, team}` 확인.
  - [ ] `client_id` 미등록 시 400, secret 미설정 시 503.

### Task 6: Slack Web API (`slack-api.ts`)
- **변경 대상**: `src/background/slack-api.ts`(신규)
- **작업 내용**: `slackFetch`(Bearer user token, `ok:false` 분기 → `SlackError(code)`), `messageForSlackError(code)` i18n 매핑, `getMyself`(auth.test/users.info), `listChannels`(users.conversations types=public_channel,private_channel,im,mpim + cursor 반복 + im 이름 해석), `postMessage`(chat.postMessage, threadTs 옵션), `uploadFiles`(2-step: getUploadURLExternal → PUT bytes → completeUploadExternal(channel_id, thread_ts), 파일별 격리·실패 isolate), `getPermalink`(chat.getPermalink). `normalizeChannel` 순수 함수 분리(테스트 대상).
- **검증**:
  - [ ] `normalizeChannel`/채널 kind 라벨링 단위 테스트.
  - [ ] `slackFetch`가 `ok:false`를 throw로 변환하는 테스트(mock).
  - [ ] 수동: 실제 토큰으로 채널 목록·메시지·파일 업로드·permalink E2E 확인.

### Task 7: 백그라운드 메시지 wiring (`messages.ts`, `index.ts`, `types/messages.ts`)
- **변경 대상**: `src/types/messages.ts`, `src/background/messages.ts`, `src/background/index.ts`
- **작업 내용**: `BgRequest`에 slack 메시지 타입(design.md 목록). `getOAuthErrorPlatform`에 `"slack"`. `messages.ts`에 slack import + `case "slack.*"` 분기 + `loadSlackAuth()`(`readStoredSlackAuth` 사용). `index.ts`에 `SlackError` 분기.
- **검증**:
  - [ ] `pnpm typecheck` 통과(메시지 union exhaustive).
  - [ ] `slack.oauth.available` → `{available}`, `slack.disconnect` → `{ok:true}` 동작.

### Task 8: store / storage wiring (`settings-store.ts`, `settings-storage.ts`)
- **변경 대상**: `src/store/settings-store.ts`, `src/lib/settings-storage.ts`
- **작업 내용**: `updateSlackAccount`, `PLATFORM_FALLBACK_ORDER`에 `"slack"`, `SETTINGS_STORE_VERSION` v10(주석). `SettingsEnvelope.accounts.slack` + `readStoredSlackAuth()`.
- **검증**:
  - [ ] 기존 마이그레이션 테스트 통과(새 필드 optional → 무손실).
  - [ ] `readStoredSlackAuth()` 반환 타입 일치.

### Task 9: 제출 오케스트레이션 (`submitToSlack.ts`)
- **변경 대상**: `src/sidepanel/lib/submitToSlack.ts`(신규)
- **작업 내용**: design.md 전송 흐름. ① 부모 메시지(제목, `markdownToMrkdwn(title)` 또는 평문) → ts ② 본문(`buildSlackBody`) 스레드 답글 ③ 첨부(images before/after + video + logs + inline + user attachments)를 `slack.uploadFiles`로 thread_ts에 ④ `slack.getPermalink`. `logsDropped` 판정. `NormalizedSubmitResult` 반환(`key: ts`, `url: permalink`).
- **검증**:
  - [ ] 첨부 0개일 때 업로드 호출 생략(부모+스레드만).
  - [ ] logs.html 업로드 실패 시 `logsDropped:true`.
  - [ ] 단위 테스트: sendBg mock으로 호출 순서·payload 검증.

### Task 10: UI — 연결 폼 (`SlackConnectForm.tsx`)
- **변경 대상**: `src/sidepanel/tabs/connect/SlackConnectForm.tsx`(신규)
- **작업 내용**: `ClickupConnectForm.tsx` 패턴에서 **OAuth만**(PatDialog·ConnectMethodDialog 제거). `SlackConnectedBody`(워크스페이스명 + 기본 채널 선택), `SlackConnectFlow`(연결 버튼 → `slack.startOAuth`). `SiSlack` 아이콘.
- **검증**:
  - [ ] OAuth 미설정 시 버튼 비활성(`oauth.available` false).
  - [ ] 수동: 연결/해제 + 기본 채널 저장.

### Task 11: UI — 채널 필드 (`slackFields/`)
- **변경 대상**: `src/sidepanel/tabs/slackFields/SlackIssueFields.tsx`, `ChannelCombobox.tsx`(신규)
- **작업 내용**: `clickupFields` Combobox 패턴. 단일 `ChannelCombobox`(`slack.listChannels` 조회, kind 아이콘/라벨). `SlackIssueFieldsValue { channelId?, channelName? }` + `initialSlackFields(last, defaults)`.
- **검증**:
  - [ ] 채널 선택 시 `channelId`/`channelName` 갱신.
  - [ ] public/private/DM 구분 표시.

### Task 12: UI — 제출 다이얼로그 wiring (`SubmitFieldsDialog.tsx`, `IssueCreateModal.tsx`)
- **변경 대상**: `src/sidepanel/tabs/SubmitFieldsDialog.tsx`, `src/sidepanel/tabs/IssueCreateModal.tsx`, `src/sidepanel/tabs/IntegrationsTab.tsx`
- **작업 내용**: `PLATFORM_TABS`·`PLATFORMS`에 slack 엔트리. `slackFields`/`setSlackFields` prop, `platformConfigured`/`fieldsReady`(`!!slackFields.channelId`) 케이스, `SlackIssueFields` 렌더 분기. `handleSlackSubmit` + `handleSubmit` 분기 + defaults/lastSubmit 전달 + `markSubmitted`/`setLastSubmitFields`/`setLastSubmittedPlatform`.
- **검증**:
  - [ ] Slack 탭 선택 → 채널 선택 → 전송 가능.
  - [ ] 미연결 시 연결 안내, 채널 미선택 시 전송 비활성.

### Task 13: UI — 결과 배지 (`SlackSubmittedBadge.tsx`, `SubmittedBadge.tsx`)
- **변경 대상**: `src/sidepanel/tabs/statusBadges/SlackSubmittedBadge.tsx`(신규), `SubmittedBadge.tsx`
- **작업 내용**: **상태 폴링 없는** 정적 "전송됨" 배지 + permalink 링크(클릭 시 `chrome.tabs.create`). `SubmittedBadge.tsx`에 `slackChannelId`/`slackTs` prop + slack 분기.
- **검증**:
  - [ ] 배지 클릭 시 permalink 열림.
  - [ ] 상태 API 호출이 발생하지 않음(메시지엔 상태 없음).

### Task 14: i18n (`app.ts`, `integrations.ts`)
- **변경 대상**: `src/i18n/namespaces/app.ts`, `src/i18n/namespaces/integrations.ts`
- **작업 내용**: `platform.tab.slack: "Slack"`(ko/en). slack.* 키 블록 — `slack.field.channel(.select/.search/.empty)`, `slack.section.channel`, `slack.oauth.notConfigured`, `slack.oauthRevoked`, `slack.error.*`(`not_in_channel`/`channel_not_found`/`rate_limited`/generic), `slack.viewerName`. ko/en 대칭.
- **검증**:
  - [ ] PostToolUse 훅(`locales.test.ts`)이 ko/en 키 대칭·placeholder 일치 통과.

## 테스트 계획

### 단위 테스트 (Vitest, `__tests__/*.test.ts`)
- `markdownToMrkdwn`: 볼드/이탤릭/취소선/링크 변환/헤딩→볼드/불릿/코드블록 보존/이미지 제거/`<>&` 이스케이프/테이블 fallback.
- `buildSlackBody`: 환경 행 구성, 사용자 섹션 mrkdwn 적용, 스타일 diff 줄 나열, 로그 요약, 빈 섹션 폴백, footer.
- `slack-api`: `normalizeChannel`(kind별 라벨), `slackFetch`의 `ok:false`→throw, `listChannels` 응답 정규화(mock fetch).
- `submitToSlack`: sendBg mock으로 부모→스레드→첨부→permalink 호출 순서·payload, 첨부 0개 분기, `logsDropped`.

### e2e 시나리오 (`/e2e-write` 입력)
- "Slack을 연결하면 Integrations 탭에 워크스페이스 이름과 채널 선택 UI가 나타난다" (OAuth는 mock/stub 필요 — 실제 launchWebAuthFlow는 e2e 불가, data-testid로 연결 상태 UI만 판정).
- "Slack 탭에서 채널을 선택하지 않으면 전송 버튼이 비활성이다."
- "Slack 탭에서 채널을 선택하면 전송 버튼이 활성화된다."
- (전송 자체는 외부 Slack API 의존 → e2e 제외, 수동 확인.)

### 수동 테스트 (Chrome)
- [ ] 실제 OAuth 연결 → user token으로 본인 이름 메시지 전송 확인.
- [ ] public 채널/private 채널/DM 각각 전송 → 부모 메시지(제목) + 스레드(본문/첨부) 구조 확인.
- [ ] mrkdwn 렌더(볼드/링크/리스트/코드/인용)가 Slack에서 깨지지 않음.
- [ ] 스크린샷 before/after·영상·logs.html이 스레드 파일로 첨부됨.
- [ ] permalink 배지 클릭 → 해당 메시지로 이동.
- [ ] 토큰 revoke 후 전송 시 재연결 안내 에러.
- [ ] 기존 7개 플랫폼 전송 회귀 없음.

## 구현 순서 권장

1. **Task 1**(타입) → typecheck로 회귀 지점 노출.
2. **Task 2·3**(변환기·본문 빌더, 테스트 우선) — 독립적, 병렬 가능.
3. **Task 4·5·6**(OAuth·proxy·API) — proxy(5)와 oauth(4)는 함께, api(6)는 oauth 타입 의존.
4. **Task 7·8**(백그라운드·store wiring) — 4·6 이후.
5. **Task 9**(submitToSlack) — 6·7 이후.
6. **Task 10·11·13·14**(UI 폼·필드·배지·i18n) — 병렬 가능. 14는 다른 UI 태스크와 함께.
7. **Task 12**(제출 다이얼로그 wiring) — 9·11 이후, 마지막 통합.
8. 전체 `pnpm typecheck` + `pnpm test` → 수동 E2E.

## 가이드 영향

사용자 노출 기능(8번째 플랫폼) → `/guide`로 ko·en 갱신 필요. `guide/AUTHORING.md` 규칙 선행.
- 플랫폼 연동 목록/표가 있는 페이지(연동 소개·지원 플랫폼) — Slack 추가, 메시지 앱 특성(채널/스레드 전송, user token, 상태 배지 없음) 1~2줄.
- 지원 플랫폼 수 "7개" → "8개" 갱신되는 모든 본문.
- AUTHORING.md의 플랫폼 표·지원 플랫폼 스냅샷 갱신.
