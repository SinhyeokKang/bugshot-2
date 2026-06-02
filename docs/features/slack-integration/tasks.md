# Slack 연동 — 구현 태스크

## 선행 조건

- **Slack 앱 생성**: api.slack.com에서 OAuth 앱 생성. user scopes: `chat:write`, `files:write`, `channels:read`, `groups:read`, `users:read`(viewer 이름 resolve용). DM 미지원이므로 `im:read`/`mpim:read` 불요. Redirect URL에 dev/store 확장 ID 두 개 등록.
- **env**: `VITE_SLACK_CLIENT_ID` 추가. `VITE_OAUTH_PROXY_URL` 재사용.
- **OAuth proxy 서버**: `/slack/token` 엔드포인트 추가 (code → `oauth.v2.access` 교환, client secret 보관). **이 레포 범위 밖** — 별도 배포 필요.
- **manifest**: `host_permissions`에 `https://slack.com/*` **+ `https://files.slack.com/*`**(업로드 PUT 대상, 기본 전제). privacy.md/PERMISSION.md 선반영.

## 태스크

### Task 1: 타입 정의 (`src/types/slack.ts`)
- **변경 대상**: `src/types/slack.ts` (신규)
- **작업 내용**: design.md "인터페이스 설계"의 `SlackOAuthAuth`/`SlackAuth`/`SlackAccount`/`SlackMyself`/`SlackConversation`/`SlackPostMessagePayload`/`SlackPostMessageResult` 정의.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `SlackAuth`가 user token 단일 종류

### Task 2: `PlatformId` union 확장 (`src/types/platform.ts`)
- **변경 대상**: `src/types/platform.ts`
- **작업 내용**: `PlatformId`에 `"slack"`, `PLATFORM_TAB_KEYS.slack`, `Accounts.slack`, `SlackLastSubmitFields`, `LastSubmitFieldsByPlatform.slack` 추가.
- **검증**:
  - [ ] `pnpm typecheck`가 `satisfies Record<PlatformId, …>`(`PLATFORM_TAB_KEYS`)·`PLATFORM_FALLBACK_ORDER`·exhaustive switch 누락을 적발 → 이후 태스크에서 모두 해소
  - [ ] 적발된 분기 파일 목록 기록 (PlatformChip, SubmitFieldsDialog, IssueCreateModal, issueListUtils, DraftDetailDialog, settings-store)
  - [ ] **주의: `SubmittedBadge.tsx`는 if-체인 + `return null` 종결이라 typecheck가 slack 분기 누락을 적발 못 함** → Task 12에서 수동 검증

### Task 3: Block Kit 변환기 + 테스트 (`markdownToSlackBlocks.ts`)
- **변경 대상**: `src/sidepanel/lib/markdownToSlackBlocks.ts` (신규), `src/sidepanel/lib/__tests__/markdownToSlackBlocks.test.ts` (신규)
- **작업 내용**: design.md 변환 규칙 구현 (markdown-it 토큰 순회, markdownToAsanaHtml 패턴). **테스트 먼저 작성**.
- **검증**:
  - [ ] heading → header 블록, **150자/151자 경계** truncate
  - [ ] paragraph/list → mrkdwn section, `**bold**`→`*bold*`, 링크 `<u|t>` 변환
  - [ ] 코드펜스·테이블 → 코드블록 section
  - [ ] **3000자/3001자 경계** section 분할
  - [ ] 이미지 토큰은 alt만 남기고 인라인 없음
  - [ ] **빈 입력** → `blocks` 빈 배열 + `text` 비어있지 않음(Slack은 둘 다 비면 거부)
  - [ ] **블록 50개 제한** 초과 시 cap/요약 (대량 데이터 경계)
  - [ ] `text` fallback 비어있지 않음
  - [ ] `pnpm test` 통과

### Task 4: 본문 조립 (`buildSlackIssueBody.ts`)
- **변경 대상**: `src/sidepanel/lib/buildSlackIssueBody.ts` (신규)
- **작업 내용**: `MarkdownContext` → markdown 문자열 (buildAsanaIssueBody 패턴). 첨부 미디어는 본문에 넣지 않음.
- **검증**:
  - [ ] 제목·환경·섹션·스타일 diff가 markdown에 포함
  - [ ] 미디어 placeholder 없음 (스레드 첨부 전담)

### Task 5: OAuth (`slack-oauth.ts`)
- **변경 대상**: `src/background/slack-oauth.ts` (신규), `src/lib/settings-storage.ts`
- **작업 내용**: `startSlackOAuth()`(authorize with `user_scope`, proxy `/slack/token` 교환, `authed_user.access_token` 추출), `isSlackOAuthConfigured()`, **`parseSlackCallbackParams`를 순수 함수로 분리**(state 검증·error·code·`authed_user.access_token` 추출 — 기존 `parse{Platform}CallbackParams` 패턴). **refresh 함수 없음**. `writeStoredSlackOAuthTokens` 추가.
- **검증**:
  - [ ] env 누락 시 `isSlackOAuthConfigured()` false → IntegrationsTab `PLATFORMS`에서 Slack 카드 자체 숨김(Task 9)
  - [ ] 실제 워크스페이스에서 user token 발급 확인
  - [ ] `parseSlackCallbackParams` 단위 테스트: state mismatch / access_denied / 정상 code 추출

### Task 6: Slack API 어댑터 (`slack-api.ts`)
- **변경 대상**: `src/background/slack-api.ts` (신규)
- **작업 내용**: `getMyself`(auth.test+users.info), `listConversations`(conversations.list `types=public_channel,private_channel` — **채널만, DM resolve 없음**), `postMessage`(chat.postMessage + getPermalink), `uploadFiles`(getUploadURLExternal → PUT → completeUploadExternal, per-file 격리, **Linear `uploadFileToLinear` 선례**).
- **검증**:
  - [ ] 채널(public/private) 목록 조회 확인
  - [ ] 본문 메시지 게시 + permalink 반환
  - [ ] 스레드 첨부(thread_ts) 동작
  - [ ] 파일 1개 실패 시 나머지·메시지 보존

### Task 6.5: 업로드 URL origin 검증
- **변경 대상**: `manifest.config.ts`
- **작업 내용**: `https://files.slack.com/*` host_permission은 **기본 전제로 미리 추가**(Task 14). 실제 워크스페이스에서 `getUploadURLExternal` 반환 PUT 대상 origin이 `files.slack.com`임을 최종 확인. 다른 origin이면 보강.
- **검증**:
  - [ ] 실제 탭에서 업로드 PUT이 CORS/권한 에러 없이 성공

### Task 7: 메시지 라우팅 (`messages.ts`, `background/messages.ts`)
- **변경 대상**: `src/types/messages.ts`, `src/background/messages.ts`, `src/background/bgRequestTypes.ts`
- **작업 내용**: `slack.*` BgRequest 추가, `getOAuthErrorPlatform`에 `"slack"`, bg 핸들러 디스패치, Slack 타입 re-export.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 각 slack 메시지가 핸들러로 라우팅

### Task 8: 전송 오케스트레이션 (`submitToSlack.ts`)
- **변경 대상**: `src/sidepanel/lib/submitToSlack.ts` (신규)
- **작업 내용**: buildSlackIssueBody → markdownToSlackBlocks → postMessage → 스레드 uploadFiles → `{ key: ts, url: permalink }`. inlineImages를 첨부로 강등.
- **검증**:
  - [ ] 첨부 없는 케이스: 본문만 전송
  - [ ] 첨부 있는 케이스: 스레드에 이미지/영상/로그
  - [ ] 반환 result가 issues-store에 기록 가능한 형태

### Task 9: 연결 UI (`SlackConnectForm.tsx`, IntegrationsTab)
- **변경 대상**: `src/sidepanel/tabs/connect/SlackConnectForm.tsx` (신규), `src/sidepanel/tabs/IntegrationsTab.tsx`
- **작업 내용**: `SlackConnectFlow`(OAuth only — 단일 "Connect with Slack" 버튼, `connectMethods`에 slack OAuth-only 분기 추가)/`SlackConnectedBody`(워크스페이스 표시 + **기본 채널 선택 블록**, Notion `NotionDefaultsBlock` 패턴). `PLATFORMS`에 `{ id: "slack", Icon: SiSlack }` 추가하되 **`isSlackOAuthConfigured()` false면 목록에서 제외**(카드 자체 숨김).
- **검증**:
  - [ ] OAuth 구성 시 "플랫폼 추가"에 Slack 노출, 연결/해제 동작
  - [ ] **env 누락 시 Slack 카드 미노출**
  - [ ] 연결됨 탭에 워크스페이스·계정 표시 + 기본 채널 선택 동작

### Task 10: 필드 UI (`slackFields/`, SubmitFieldsDialog, usePlatformFields)
- **변경 대상**: `src/sidepanel/tabs/slackFields/ConversationField.tsx`, `SlackIssueFields.tsx` (신규), `src/sidepanel/tabs/SubmitFieldsDialog.tsx`, `src/sidepanel/hooks/usePlatformFields.ts`
- **작업 내용**: 채널 검색 콤보박스 (GitHub/GitLab `*Combobox` 250ms debounce 서버 검색 패턴; 파일 위치 `asanaFields/ProjectCombobox.tsx` 등 참고). `usePlatformFields`에 slack 필드(conversationId) init/reset 등록 — `lastSubmitFields.slack`(없으면 `defaults.conversationId`) prefill. SubmitFieldsDialog: slack 탭·필드·`canSubmit`(conversationId 필수) 분기 + **`TABS_GRID_COLS`에 `7: "grid-cols-7"` + 7탭 시 활성 탭만 라벨/비활성 아이콘만**. 탭 컨텐츠는 기존 **삼항 분기**에 slack 케이스 추가(`data-[state=inactive]:hidden` 불요).
- **검증**:
  - [ ] 콤보박스에서 채널 검색·선택 (debounce)
  - [ ] 미선택 시 전송 버튼 비활성
  - [ ] `lastSubmitFields.slack`/기본 채널로 대상 prefill, 재오픈 시 reset 정상
  - [ ] 7탭 레이아웃 400px에서 안 깨짐

### Task 11: submit dispatch (`IssueCreateModal.tsx`)
- **변경 대상**: `src/sidepanel/tabs/IssueCreateModal.tsx`
- **작업 내용**: `submitToSlack` 분기, `lastSubmitFields.slack`, `setLastSubmittedPlatform("slack")`, IssueRecord에 `slackChannelId`/`slackMessageTs` 저장.
- **검증**:
  - [ ] Slack 선택 후 전송 → done 화면 + permalink
  - [ ] 이슈 리스트에 기록

### Task 12: 이슈 리스트 표시 (`SubmittedBadge`, `PlatformChip`, `SlackSubmittedBadge`)
- **변경 대상**: `src/sidepanel/tabs/statusBadges/SlackSubmittedBadge.tsx` (신규), `SubmittedBadge.tsx`, `PlatformChip.tsx`, `issueListUtils.ts`, `DraftDetailDialog.tsx`
- **작업 내용**: `SlackSubmittedBadge`는 정적 "전송됨" + permalink (`getIssueStatus` 미호출). SubmittedBadge에 slack 분기 + permalink/`slackChannelId`/`slackMessageTs` props, IssueRow에서 `IssueRecord`로부터 전달(`resolveAsanaCoords` 류). PlatformChip에 slack 분기. issueListUtils·DraftDetailDialog 재전송 분기(= 새 메시지, 중복 허용).
- **검증**:
  - [ ] 슬랙 항목에 "전송됨" + 링크
  - [ ] **이슈 리스트 렌더 시 Slack 행이 `getIssueStatus` 류 sendBg를 호출하지 않음**(정적)
  - [ ] **Slack 항목이 null 아닌 배지 렌더**(SubmittedBadge가 `return null`로 빠지지 않음 — typecheck가 못 잡는 지점)
  - [ ] PlatformChip에 Slack 아이콘
  - [ ] 드래프트 재전송 → 새 메시지 게시

### Task 13: issues-store 필드 + store 버전 bump
- **변경 대상**: `src/store/issues-store.ts`, `src/store/settings-store.ts`
- **작업 내용**: `IssueRecord`에 `slackChannelId?`/`slackMessageTs?` 옵셔널 추가. `connectedPlatforms`가 필터하는 **`PLATFORM_FALLBACK_ORDER`에 `"slack"` 추가**. issues/settings store **버전 마커 bump**(새 필드 optional이나 관례). 중앙 상태 sync 폴링은 없으므로 별도 제외 로직 불요(Slack 폴링 없음은 Task 12의 정적 배지로 자동 달성).
- **검증**:
  - [ ] 기존 레코드 데이터 마이그레이션 불필요 (옵셔널)
  - [ ] 버전 마커 bump 완료 (issues/settings)
  - [ ] `connectedPlatforms`가 slack을 포함

### Task 14: i18n + manifest
- **변경 대상**: `src/i18n/namespaces/integrations.ts`, `manifest.config.ts`
- **작업 내용**: `platform.tab.slack` + `slack.*` 키 ko/en 동시(done 화면 "메시지 전송됨" 카피 포함). `host_permissions`에 `https://slack.com/*` + `https://files.slack.com/*`.
- **검증**:
  - [ ] i18n PostToolUse 훅(ko/en 대칭) 통과
  - [ ] done 화면이 Slack용 카피로 분기(이슈 아닌 메시지)
  - [ ] `pnpm typecheck` 통과

## 테스트 계획

- **단위 테스트**:
  - `markdownToSlackBlocks`: heading(150/151자 경계)/section/code/divider/이미지/3000자 분할/빈 입력/50블록 cap/mrkdwn 변환/text fallback (Task 3)
  - `parseSlackCallbackParams`(순수 함수 필수): state mismatch·access_denied·정상 code/`authed_user.access_token` 추출 케이스 (Task 5)
- **수동 테스트 (Chrome, 실제 워크스페이스)**:
  - [ ] OAuth 연결 → user token 발급 / env 누락 시 Slack 카드 미노출
  - [ ] 공개 채널 / 비공개 채널 각각 전송 (DM 미지원)
  - [ ] 스크린샷·before·after·영상·로그 스레드 첨부 + Slack 미리보기
  - [ ] 영상 용량 초과 시 에러 안내 + 본문 보존
  - [ ] 파일 일부 실패 시 메시지 보존
  - [ ] 이슈 리스트 "전송됨" + permalink 이동, Slack 행 상태 폴링(sendBg) 미발생, 빈 배지 아님
  - [ ] 재전송 시 새 메시지 게시 (중복)
  - [ ] 권한 철회 후 전송 → 재연결 안내
  - [ ] 7탭 레이아웃 400px 가독성
  - [ ] 기존 6개 플랫폼 전송 회귀 없음

## 구현 순서 권장

0. **manifest host_permission 선반영**: Task 14의 `https://slack.com/*`·`https://files.slack.com/*`를 Task 5 착수 전 먼저 추가(권한 없으면 실제 워크스페이스 fetch 차단).
1. **Task 1 → 2**: 타입·union 먼저 (이후 typecheck가 분기 누락 가이드).
2. **Task 3, 4 병렬 가능**: 순수 변환기/조립 (UI 무관).
3. **Task 5 → 6 → 6.5**: 인증 → API → 업로드 origin 검증.
4. **Task 7**: 메시지 라우팅 (5·6 시그니처 확정 후).
5. **Task 8**: 전송 오케스트레이션 (3·4·7 의존).
6. **Task 9, 10 병렬 가능**: 연결 UI / 필드 UI.
7. **Task 11 → 12 → 13**: dispatch → 리스트 표시 → store.
8. **Task 14**: i18n·manifest (전 과정에서 키 추가, 마지막에 정합 확인).

## 가이드 영향

사용자 노출 기능(새 플랫폼 연동) → `/guide`로 ko·en 갱신 필요. 판단·작성 기준은 `guide/AUTHORING.md`.
- 연동 설정 페이지(ko·en) — Slack 연결 절차(OAuth only) + 기본 채널 지정 추가
- 이슈 전송 페이지(ko·en) — Slack 전송(채널 선택, Block Kit 본문 + 스레드 첨부, 상태추적 없음, DM 미지원) 설명 추가
- `guide/AUTHORING.md` — 지원 플랫폼 표·플랫폼 표에 Slack 행 추가 (이슈 트래커가 아닌 메시지 앱이라는 특수성 명시)
- `docs/privacy.md` — 새 외부 API(`slack.com`) + 새 host_permission + 메시지/파일 전송 동작 → 시행일 포함 갱신
