# 슬랙 승격 백링크 — 기술 설계

## 개요

승격(트래커 제출 성공) 직후, 승격 전 이슈가 `slackPreserved`였다면 원 슬랙 메시지 스레드에 트래커 URL 댓글을 1개 남긴다. 기존 `slack.postMessage` 백그라운드 메시지(이미 `threadTs`를 지원)를 재사용하므로 **새 BgRequest 타입은 추가하지 않는다**. channel은 원 메시지 permalink에서 정규식으로 파싱하고, thread_ts는 `issue.key`(부모 메시지 ts)를 쓴다. 전 과정은 best-effort — 모든 실패를 삼켜 승격 흐름을 막지 않는다.

## 변경 범위

### 신규 파일

**`src/sidepanel/lib/slackPromotionLink.ts`** (신규)
- `parseSlackChannelId(permalink: string): string | null` — permalink에서 channel 추출(순수 함수, 단위 테스트 대상).
- `postSlackPromotionReply(args): Promise<void>` — 원 메시지 스레드에 댓글 전송. 내부에서 channel 파싱→실패 시 즉시 return, `sendBg("slack.postMessage", …)` 호출, 모든 예외를 try/catch로 삼킨다. text는 호출부에서 i18n으로 만들어 넘긴다(이 파일은 `useT` 비의존).

### 변경 파일

**`src/sidepanel/tabs/DraftDetailDialog.tsx`** (현재: 승격/제출 로직 보유)
- `handleSubmit(submitPlatform)` (현 791행) 진입 직후, **`markSubmitted` 호출 전에** 원 슬랙 정보를 캡처:
  ```ts
  const slackOrigin =
    issue && isSlackPreserved(issue) && accounts.slack
      ? { permalink: issue.url ?? "", ts: issue.key ?? "" }
      : null;
  ```
  (`stripSubmitted`가 `url`/`key`를 트래커 값으로 덮어쓰기 때문에 사전 캡처 필수 — 위험 요소 참조.)
- 각 핸들러가 `result`를 반환한 뒤(현 802~808행 공통부), Slack 외 플랫폼으로 승격됐고 `slackOrigin`이 있으면 댓글 전송을 fire-and-forget:
  ```ts
  if (slackOrigin && submitPlatform !== "slack") {
    const text = `${t("slack.promotedComment", {
      platform: t(PLATFORM_TAB_KEYS[submitPlatform]),
    })}\n${result.url}`;
    void postSlackPromotionReply({ ...slackOrigin, text });
  }
  ```
- import 추가: `postSlackPromotionReply` (신규 lib), `PLATFORM_TAB_KEYS` (`@/types/platform`). `isSlackPreserved`는 이미 import됨.

**`src/i18n/namespaces/integrations.ts`** (현재: slack.* 키 보유)
- `slack.promotedComment` 키를 ko/en 동시 추가. placeholder `{platform}`.
  - ko: `"{platform}에 이슈로 등록되었습니다."`
  - en: `"Filed as an issue in {platform}."`
  - URL은 키에 넣지 않고 호출부에서 `\n${result.url}`로 덧붙인다(placeholder 토큰 대칭 단순화 + URL escape 불필요).

## 데이터 흐름

```
[승격] 제출 다이얼로그 → handleSubmit(submitPlatform)
  │  (진입 직후) slackOrigin = isSlackPreserved(issue) ? {permalink: issue.url, ts: issue.key} : null
  ├─ handleXxxSubmit → submitToXxx → markSubmitted (issue.url/key가 트래커 값으로 교체됨)
  │                                              ↑ slackOrigin은 이미 캡처돼 영향 없음
  └─ result(트래커 url) 반환 직전:
       slackOrigin 있고 submitPlatform≠slack 이면
         text = t("slack.promotedComment",{platform}) + "\n" + result.url
         void postSlackPromotionReply({permalink, ts, text})
                │
                ├─ channelId = parseSlackChannelId(permalink)  // null이면 return
                └─ sendBg("slack.postMessage", {payload:{channelId, text, threadTs: ts}})
                     → background messages.ts → slackPostMessage(loadSlackAuth(), payload)
                       → chat.postMessage(channel, text, thread_ts)   // 모든 throw는 호출부 catch가 삼킴
```

승격 result는 `postSlackPromotionReply`를 `await`하지 않고 즉시 반환된다(best-effort, 흐름 비차단).

## 인터페이스 설계

```ts
// src/sidepanel/lib/slackPromotionLink.ts

// permalink: https://<ws>.slack.com/archives/<CHANNEL>/p<ts> → "<CHANNEL>"
// archives 세그먼트가 없으면 null.
export function parseSlackChannelId(permalink: string): string | null;

export function postSlackPromotionReply(args: {
  permalink: string;   // 원 메시지 permalink (issue.url)
  ts: string;          // 원 메시지 ts (issue.key)
  text: string;        // 이미 i18n 적용된 댓글 본문
}): Promise<void>;      // 항상 resolve — 내부 에러는 삼킨다
```

기존 재사용(변경 없음):
```ts
// src/types/slack.ts
interface SlackPostMessagePayload { channelId: string; text: string; threadTs?: string; }
// sendBg({ type: "slack.postMessage", payload }) → background에서 chat.postMessage
```

## 기존 패턴 준수

- **메시지 타입 재사용**: `slack.postMessage`가 이미 `threadTs`를 받으므로 `BgRequest` union·handler·`BG_REQUEST_TYPES` 3곳을 건드리지 않는다(외과적).
- **i18n 동시 갱신**: `slack.promotedComment`를 ko/en 양쪽에 추가(PostToolUse 훅의 `locales.test.ts` 대칭 검사 통과). placeholder `{platform}` 양쪽 동일.
- **순수 함수 테스트 우선**: `parseSlackChannelId`는 순수 함수 → 단위 테스트 먼저.
- **best-effort 비차단**: `submitToSlack`의 파일 업로드가 개별 실패를 삼키는 패턴과 동일 결의 — 부가 동작이 주 흐름(승격)을 깨지 않는다.

## 작성자·문구 결정

- **작성자**: `slack.postMessage`는 `loadSlackAuth()`의 user token(`xoxp`)으로 전송되므로, 댓글은 **원 메시지를 공유한 본인의 후속 댓글**로 표시된다(봇 메시지 아님). 원 공유와 같은 토큰이라 일관적.
- **푸터 미부착**: 기존 스레드 답글은 `_Reported via BugShot_` 푸터를 달지만, 이 백링크 댓글은 트래커명+URL만 남기고 푸터를 붙이지 않는다(결정됨). 작성자가 본인(xoxp)으로 드러나 출처가 자명하고, URL이 단독 줄이라 트래커 unfurl 카드로 펼쳐진다.
- **DM/채널 무구분**: channel은 permalink의 `/archives/<channel>/`에서 파싱하며 채널/DM(`D…`)/그룹 DM을 구분하지 않는다. 원 공유가 DM이면 그 DM 스레드에 댓글이 달린다(PRD 비목표·위험 참조).

## 대안 검토

1. **`markSlackShared`에서 channelId를 IssueRecord에 저장해 두기** — permalink 파싱 대신 저장된 channelId 사용. 채택 안 함: 새 영속 필드 추가 + 마이그레이션이 필요하고, 기존 보존 이슈(필드 없음)는 어차피 파싱 폴백이 필요하다. permalink 파싱만으로 신·구 이슈 모두 커버되어 더 단순.
2. **전용 BgRequest 타입 `slack.postThreadReply` 신설** — 채택 안 함: `slack.postMessage`가 `threadTs`로 동일 기능을 이미 제공. 타입 3곳 추가는 불필요한 중복.
3. **댓글 전송을 `await`해 실패 시 토스트** — 채택 안 함: 사용자가 "조용히 drop, 알림 없음"을 명시. 승격 UX를 부가 동작이 지연·오염하지 않도록 fire-and-forget.

## 위험 요소

- **(핵심) 캡처 시점**: `markSubmitted`는 공통부가 아니라 **각 플랫폼 핸들러 내부**(예: `handleJiraSubmit` ~414행)에서 호출되고, 그 내부에서 `stripSubmitted`(issues-store.ts:33-58)가 `...patch` 스프레드(line 39)로 핸들러가 넘긴 트래커 `url`/`key`를 덮어쓴다. **게다가 line 56에서 `slackPreserved: undefined`로 비우므로 `markSubmitted` 후엔 `isSlackPreserved(issue)`도 false가 된다** — 사전 캡처가 필수인 더 강한 이유. 따라서 원 슬랙 permalink·ts와 `slackOrigin` 판정은 반드시 `handleSubmit` 진입 직후(794행 핸들러 분기 전)에 한 번에 끝내야 한다. 늦게 읽으면 트래커 URL을 자기 스레드로 착각하거나 `slackOrigin`이 null로 새서 댓글을 못 단다.
- **thread_ts 정합성**: `issue.key`는 `submitToSlack`이 저장한 부모 메시지 ts(`parent.ts`)여야 한다. 슬랙 보존 경로(`markSlackShared`)가 `key: result.key(=parent.ts)`를 저장하므로 충족. 다른 경로로 만들어진 이슈에는 `slackPreserved`가 없어 진입 자체가 안 됨.
- **enterprise grid permalink**: 형식이 `/archives/<channel>/p<ts>`로 동일하므로 정규식 `\/archives\/([^/]+)\//`로 커버. 그래도 파싱 실패 시 null→drop이라 안전.
- **submitPlatform === "slack" 가드**: 슬랙 보존 이슈는 승격 대상에서 slack이 제외(`submittablePlatforms`)되지만, 방어적으로 `submitPlatform !== "slack"` 조건을 둬 자기 스레드에 자기 링크를 다는 일을 원천 차단.
- **slack 미연결 케이스는 폴백 아닌 정상 스킵**: [자세히]/[승격] 노출(`canPromoteSlack`)은 slack auth가 아니라 `isSlackPreserved`(데이터) + 트래커 연결 여부에만 의존하므로, slack 토큰이 없어도 트래커가 1개+면 승격은 정상 동작한다. 이때 `slackOrigin` 캡처 조건의 `accounts.slack` 가드가 백링크를 시도조차 않고 스킵한다(승격 흐름·UX 변화 없음). 트래커가 0개면 애초에 승격 버튼이 안 뜨고 `SubmittedBadge`로 폴백된다.
- **fire-and-forget unmount**: `void` 호출이라 다이얼로그가 닫힌 뒤 완료될 수 있으나, `sendBg`는 background로 위임되므로 컴포넌트 생명주기와 무관하게 완료된다.
