# 슬랙 승격 백링크 — 구현 태스크

## 선행 조건

- 추가 권한·env·OAuth 스코프 없음. `chat:write`는 기존 Slack 공유에서 이미 사용 중.
- 새 BgRequest 타입 없음 — `slack.postMessage`(threadTs 지원) 재사용.

## 태스크

### Task 1: `parseSlackChannelId` 순수 함수 + 테스트
- **변경 대상**: `src/sidepanel/lib/slackPromotionLink.ts` (신규), `src/sidepanel/lib/__tests__/slackPromotionLink.test.ts` (신규)
- **작업 내용**: permalink에서 channel을 정규식(`\/archives\/([^/]+)\//`)으로 추출. archives 세그먼트 없으면 `null`. 테스트를 먼저 작성(TDD).
- **검증**:
  - [x] `https://ws.slack.com/archives/C123ABC/p1700000000123456` → `"C123ABC"`
  - [x] enterprise grid 형태 `/archives/C0AB/p…` → channel 반환
  - [x] DM permalink `/archives/D123/p…` → `"D123"` (채널/DM 무구분)
  - [x] archives 없는 URL(`https://ws.slack.com/foo`) → `null`
  - [x] `/client/` 포맷(`https://app.slack.com/client/T1/C123/p…`) → `null` (지원 안 함 — 의도 고정)
  - [x] 트레일링 세그먼트 없는 `https://ws.slack.com/archives/C123`(뒤에 `/p…` 없음) → `null` (정규식이 channel 뒤 `/`를 요구하는 회귀 방어)
  - [x] 빈 문자열 → `null`
  - [x] `pnpm test --run src/sidepanel/lib/__tests__/slackPromotionLink.test.ts` green

### Task 2: `postSlackPromotionReply` best-effort 전송 헬퍼
- **변경 대상**: `src/sidepanel/lib/slackPromotionLink.ts`
- **작업 내용**: `{ permalink, ts, text }`를 받아 `parseSlackChannelId`로 channel 파싱(null이면 즉시 return), `sendBg({ type:"slack.postMessage", payload:{ channelId, text, threadTs: ts } })` 호출. 전체를 try/catch로 감싸 모든 예외를 삼키고 `Promise<void>`로 항상 resolve.
- **검증** (기존 `submitToSlack.test.ts`의 `vi.mock("@/types/messages")` → `sendBg` 모킹 패턴 재사용, `sendBg.mock.calls`로 호출/payload 검증):
  - [x] 유효 permalink → `sendBg`가 `{ type:"slack.postMessage", payload:{ channelId:"C123", text, threadTs: ts } }`로 **1회** 호출
  - [x] archives 없는/`/client/` permalink → `sendBg` **미호출**하고 정상 resolve
  - [x] `sendBg`가 reject해도 `postSlackPromotionReply`가 throw 없이 resolve (best-effort)
  - [x] `pnpm test --run src/sidepanel/lib/__tests__/slackPromotionLink.test.ts` green
  - [x] `pnpm typecheck` 통과

### Task 3: i18n 키 추가
- **변경 대상**: `src/i18n/namespaces/integrations.ts`
- **작업 내용**: `slack.promotedComment` 키를 ko/en 동시 추가.
  - ko: `"{platform}에 이슈로 등록되었습니다."`
  - en: `"Filed as an issue in {platform}."`
- **검증**:
  - [x] PostToolUse 훅 `locales.test.ts`(ko/en 대칭·placeholder 토큰) 통과
  - [x] placeholder는 `{platform}` 하나, ko/en 동일

### Task 4: `handleSubmit`에 승격 백링크 연결
- **변경 대상**: `src/sidepanel/tabs/DraftDetailDialog.tsx`
- **작업 내용**:
  1. `handleSubmit` 진입 직후(`markSubmitted` 전) `slackOrigin` 캡처: `issue && isSlackPreserved(issue) && accounts.slack` 일 때 `{ permalink: issue.url ?? "", ts: issue.key ?? "" }`, 아니면 `null`.
  2. `result` 반환 직전 공통부에서 `slackOrigin && submitPlatform !== "slack"`이면 `text = t("slack.promotedComment",{platform:t(PLATFORM_TAB_KEYS[submitPlatform])}) + "\n" + result.url` 만들어 `void postSlackPromotionReply({...slackOrigin, text})`.
  3. import: `postSlackPromotionReply`, `PLATFORM_TAB_KEYS`.
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [x] 캡처가 모든 `markSubmitted` 호출보다 앞선다(코드 리뷰)
  - [x] Slack 승격(submitPlatform==="slack")은 자기 스레드에 안 단다 — 가드 확인

## 테스트 계획

- **단위 테스트**:
  - `parseSlackChannelId` — Task 1의 7개 케이스(정상/grid/DM/archives없음/`/client/`/트레일링없음/빈문자열).
  - `postSlackPromotionReply` — Task 2의 3개 케이스(`sendBg` mock 호출/payload, 미호출, reject swallow). **단위로 충분하므로 sendBg 호출 검증은 단위에서 끝낸다** — 아래 e2e는 UI 통합만 본다.
- **e2e 시나리오** (`e2e/slack-issue-promotion.spec.ts`에 추가, `/e2e-write` 입력):
  - **선행 fixture 교체**: 현 spec(L10 부근)의 슬랙 보존 이슈 fixture는 `url`이 `/client/...` 포맷, `key`가 채널 id(`"C123"`)다. 설계상 `url`=`/archives/<channel>/p<ts>` 포맷, `key`=메시지 ts여야 파싱(channel)·threadTs가 성립하므로, **fixture를 `url:"https://ws.slack.com/archives/C123/p1700000000123456"`, `key:"1700000000.123456"`로 교체**한다.
  - **판정 수단**: 기존 spec은 storage-seed + UI assert만 하고 background 호출을 가로채지 않는다. e2e엔 슬랙 토큰·네트워크가 없어 실제 `slack.postMessage`는 throw→swallow된다. 따라서 패널 컨텍스트에서 **`chrome.runtime.sendMessage`를 스파이로 교체**(기존 `chrome.tabs.create` 스파이 패턴 L117-123과 동형)해 `type === "slack.postMessage"` 호출을 카운트·payload 캡처한다.
  - "슬랙 보존 이슈를 Jira로 승격하면 스파이된 `slack.postMessage`가 `payload.threadTs`=fixture key(ts), `payload.channelId`=`"C123"`, `payload.text`에 트래커 URL 포함해 **1회** 기록된다."
  - "슬랙 미연결(seed에서 accounts.slack 제거) 상태로 승격하면 `slack.postMessage` 스파이 호출 0이고 승격 성공 화면이 뜬다."
  - "`slack.postMessage` 스파이가 reject를 반환해도 승격 성공 화면이 정상 표시된다."
- **수동 테스트**: 실제 Slack 워크스페이스에서 보존 이슈를 Jira로 승격 → 원 메시지 스레드에 `Jira에 이슈로 등록되었습니다.\n<url>` 댓글 1개 확인. 원 메시지 삭제 후 승격 시 에러 없이 승격만 성공하는지 확인.

## 구현 순서 권장

Task 1 → 2 (같은 신규 파일, 1의 함수를 2가 사용) → 3 (독립, 병렬 가능) → 4 (1·2·3 의존, 마지막). Task 3은 1·2와 병렬 가능.

## 가이드 영향

`guide/ko/integrations/platforms.md` · `guide/en/integrations/platforms.md` — Slack 이슈 승격 설명에 "승격 시 원 슬랙 스레드에 트래커 링크가 댓글로 남는다" 한 줄 추가. 구현 후 `/guide`로 처리. (작성 기준은 `guide/AUTHORING.md`.)
