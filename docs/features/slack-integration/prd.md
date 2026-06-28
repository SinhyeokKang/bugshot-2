# Slack 연동

## 배경

Bugshot은 현재 7개 이슈 트래커(Jira·GitHub·Linear·Notion·GitLab·Asana·ClickUp)로 버그를 등록한다. 하지만 많은 팀은 버그를 정식 이슈로 올리기 전에 **Slack 채널에 먼저 공유**한다 — "이거 깨졌어요" 한 줄 + 스크린샷. 트래커 연동만으로는 이 가벼운 1차 공유 흐름을 못 잡는다. Slack을 8번째 전송 대상으로 추가하면, 사용자는 캡처한 버그 컨텍스트(환경·스타일 diff·로그·스크린샷/영상)를 곧장 Slack 채널/DM에 던질 수 있다.

Slack은 이슈 트래커가 아니라 메시지 앱이라, 기존 7개의 "이슈 생성" 모델과 구조가 갈린다. 제목·라벨·담당자·상태 같은 트래커 개념이 없고, 대신 **채널 / 스레드 / 메시지** 모델을 쓴다. 본 기능은 기존 어댑터 패턴을 최대한 재사용하되, 메시지 앱 특성에 맞는 지점만 다르게 구현한다.

## 목표

- 사용자가 OAuth로 본인 Slack 계정을 연결하면, **본인 이름으로**(user token) 메시지를 보낼 수 있다.
- 캡처한 버그를 Slack의 **public 채널 / private 채널 / DM**에 전송한다.
- 전송 구조: **제목은 부모 메시지, 상세 본문(환경·스타일 diff·로그 요약)과 첨부(스크린샷·영상·logs.html)는 같은 메시지의 스레드 답글**로 보낸다 → 채널 타임라인은 제목 한 줄로 깔끔하고, 상세는 스레드에 접힌다.
- 기존 마크다운 본문을 Slack **mrkdwn** 포맷으로 정확히 변환한다.
- 전송 후 생성된 메시지의 **permalink**를 이슈 행에 노출해 클릭 시 Slack으로 이동한다.
- 기존 7개 플랫폼의 어댑터·OAuth·UI·i18n·store 패턴을 최대한 그대로 따른다(신규 추상화 도입 금지).

## 비목표 (Non-goals)

- **Bot token 전송 모델** — bot이 채널에 초대돼야 하는 마찰이 있어 1차 제외. user token만.
- **BYOK(토큰 직접 입력)** — Slack user token(xoxp)은 사용자가 직접 앱을 만들어야 발급 가능해 진입장벽이 높다. OAuth 전용. (다른 플랫폼의 PAT 분기는 추가하지 않는다.)
- **CC/멘션·담당자·라벨·우선순위·상태** — Slack 메시지 모델에 없는 트래커 개념. 필드 추가하지 않는다.
- **메시지 상태 추적/폴링** — Slack 메시지엔 open/closed 같은 상태가 없다. 전송됨 배지 + permalink 링크만. (기존 배지의 상태 폴링 로직을 Slack엔 적용하지 않는다.)
- **본문 inline 이미지 인라인 렌더** — mrkdwn은 인라인 이미지를 지원하지 않는다. 모든 이미지는 스레드 첨부로 보낸다(ClickUp의 2차 본문 갱신 패턴 미적용).
- **메시지 편집/삭제, 스레드 추가 답글, 리액션** — 전송 1회로 끝.
- **여러 워크스페이스 동시 연결** — OAuth로 인증한 단일 워크스페이스만.

## 사용자 시나리오

### 1. Slack 연결 (OAuth)
1. 사용자가 Integrations 탭에서 "Slack 연결"을 누른다.
2. `chrome.identity.launchWebAuthFlow`로 Slack OAuth v2 동의 화면이 열린다 (user_scope: `chat:write, channels:read, groups:read, im:read, mpim:read, files:write`).
3. 동의하면 user token(`xoxp-...`)과 워크스페이스 정보(team id/name), 본인 정보(user id/name)를 받아 저장한다.
4. Integrations 탭에 연결된 워크스페이스 이름과 기본 채널 선택 UI가 보인다.

### 2. 버그를 Slack에 전송
1. 캡처(element/screenshot/video/freeform) 후 이슈 작성 모달에서 플랫폼 탭 "Slack"을 고른다.
2. 채널 선택 콤보박스에서 전송 대상(공개/비공개 채널 또는 DM)을 고른다. 본인이 멤버인 대화만 목록에 뜬다.
3. 제목과 본문을 작성하고 전송한다.
4. 결과:
   - 채널에 **제목**이 부모 메시지로 올라간다.
   - 그 메시지의 **스레드**에 본문(환경 정보 + 사용자 작성 섹션 + 스타일 diff 텍스트 + 로그 요약)이 mrkdwn으로 올라간다.
   - 스레드에 스크린샷(before/after), 영상, logs.html이 파일로 첨부된다.
5. 이슈 행에 Slack 칩 + "전송됨" 배지가 뜨고, 클릭하면 메시지 permalink로 이동한다.

### 엣지 케이스
- **채널 목록이 많음**: `users.conversations`는 커서 페이지네이션 → 전부 모아 콤보박스에 표시.
- **DM 이름**: im(1:1)은 상대 user 이름, mpim(그룹 DM)은 참여자 라벨로 표시.
- **토큰 revoke**: user가 Slack에서 앱 권한을 철회하면 API가 `ok:false, error:"token_revoked"` → 재연결 안내 에러(ClickUp `oauthRevoked` 패턴).
- **파일 업로드 실패**: 부모/본문 메시지는 보존하고, logs.html이 누락되면 `logsDropped: true`로 사용자에게 알린다(기존 패턴).
- **스레드 답글 본문이 비어도** 환경 정보는 항상 있으므로 빈 스레드는 발생하지 않는다.
- **채널 미선택 전송 시도**: 필수 검증으로 차단(`create.requiredMissing`).

## 성공 기준

- OAuth로 Slack 워크스페이스를 연결하고 user token을 저장할 수 있다.
- public/private 채널과 DM 목록을 콤보박스에서 선택할 수 있다.
- 전송하면 채널에 제목 부모 메시지 + 스레드에 본문/첨부가 정확히 올라간다.
- 본문 mrkdwn이 Slack에서 깨지지 않고 렌더된다(볼드/이탤릭/링크/리스트/코드/인용).
- 이슈 행의 Slack 배지를 클릭하면 메시지 permalink로 이동한다.
- 기존 7개 플랫폼 전송이 회귀 없이 동작한다(`PlatformId` union 확장으로 인한 exhaustive switch 누락 없음).
- `pnpm typecheck`·`pnpm test` 통과.
