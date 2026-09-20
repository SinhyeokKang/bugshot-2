# Custom Webhook 전송 — 구현 태스크

## 선행 조건

- 새 권한·env 없음. `<all_urls>`가 이미 required라 임의 엔드포인트 fetch가 추가 프롬프트 없이 동작한다.
- 새 의존성 없음. multipart는 표준 `FormData`, 아이콘은 이미 설치된 lucide의 `Webhook`.
- 착수 전 `docs/POSTMORTEM.md`에서 `어댑터` 영역을 grep해 과거 함정을 소환한다(특히 2026-06-30 업로드 모델 3건, 2026-06-25 `emitLogSummary` 8빌더).
- **e2e는 목 수신 서버로 검증할 수 없다.** `panel.route`는 background SW fetch를 못 잡고(`e2e/GOTCHAS.md:69`) 유일한 제출 e2e 선례는 `chrome.runtime.sendMessage` 스파이로 우회한다 — 실제 multipart가 서버에 도달하지 않는다. 그래서 **파트 구성·`cid:` 대응은 background 유닛(Task 13-a), UI 동선은 e2e(Task 13-b)** 두 층으로 나눈다. 실제 목 서버 왕복은 `docs/webhook-contract.md` 레퍼런스 서버로 수동 검증한다.
- `src/test/fetch-mock.ts`(`mockFetchOnce`/`formDataAt`)가 이미 있고 node 24라 `FormData`·`Blob`이 네이티브다 — 별도 패키지 추가 금지.

---

## 태스크

### Task 0: 제출 다이얼로그 탭 줄 9개+ 대응 (선행 픽스)

- **변경 대상**: `src/sidepanel/tabs/submitTabsLayout.ts`(신규 — 원래는 `SubmitFieldsDialog.tsx`의 `TABS_GRID_COLS`) + `src/sidepanel/tabs/SubmitPlatformTabs.tsx`(신규 — 다이얼로그에서 떼어낸 탭 줄) + `src/components/ui/collapsing-tabs.tsx`
- **작업 내용**: **`9: "grid-cols-9"` 추가로는 안 된다.** 400px 패널에서 탭 그리드 가용 폭은 304px(`90vw`=360 − `p-6`×2 − `TabsList p-1`×2)인데 9등분하면 33.8px, 트리거 최소폭은 아이콘 14px + `px-3` 24px = 38px로 고정이다. 8열이 이미 슬랙 0px이고 `CollapsingTabsList`는 라벨만 떼지 아이콘·패딩은 못 줄인다. → **9개 이상이면 `TabsList`를 가로 스크롤(`overflow-x-auto`)로 전환**한다. 이 기능과 독립된 잠복 버그라 **먼저 단독 커밋으로** 고친다 — 나중에 고치면 webhook 회귀로 오인된다.
- **검증**:
  - [x] 기존 8개 연결 상태에서 탭 줄이 기존과 동일(그리드 유지, 회귀 없음) — `submitTabsLayout.test.ts`가 2~8 전수 고정
  - [x] 9개 연결 시 `grid-cols-2` 폴백이 일어나지 않는다 — 같은 테스트의 음성 단언 3건
  - [ ] 9개 연결 시 각 탭의 아이콘이 잘리지 않고, 가로 스크롤로 전부 도달 가능 — **픽셀 실측 불가**: `PLATFORM_TABS`가 8개라 스크롤 분기가 프로덕션에서 도달 불가. 9탭 배선은 `submitTabsLayout.test.ts` 순수 단언까지만 고정되고(`PlatformId`가 닫힌 union 8종이라 9탭 렌더 자체가 불가), 렌더·픽셀은 Task 13-b e2e가 첫 실측
  - [ ] 키보드 탭 이동 시 화면 밖 탭이 스크롤로 따라온다 — 코드상 보장(Radix roving-focus가 `preventScroll:false`로 브라우저 기본 scroll-into-view에 맡긴다)이나 같은 이유로 실측 미수행

### Task 1: 타입 축 + 컴파일 게이트

- **변경 대상**: `src/types/platform.ts`(`PlatformId`·`PLATFORM_TAB_KEYS`·`Accounts`·`LastSubmitFieldsByPlatform`), `src/types/webhook.ts`(신규), `src/background/oauth/config.ts`, `src/background/platformErrors.ts`, `src/store/settings-store.ts`, `src/sidepanel/lib/attachmentLimits.ts`
- **작업 내용**: `PlatformId`에 `"webhook"` 추가 → 빨개지는 곳을 design.md 표대로 채운다. `OAUTH_CONFIG`는 값을 채우지 않고 `OAuthPlatformId = Exclude<PlatformId, "webhook">`를 신설해 타입을 좁힌다. `LastSubmitFieldsByPlatform`은 `webhook?: never`. `SETTINGS_STORE_VERSION` → 12 **+ `settings-store.ts:266-286` `migrate` 콜백에 `if (version < 12)` 단계를 `isV3Shape` 게이트 뒤에 배선**(전부 optional이라 단계 함수는 no-op에 가깝지만 배선 자체가 그물이다).
- **검증**:
  - [ ] `pnpm typecheck` green — `PlatformId` 키 맵 4곳이 전부 채워졌다는 뜻(`BG_REQUEST_TYPE_MAP`은 `BgRequest["type"]` 축이라 Task 5에서 강제된다)
  - [ ] `src/background/__tests__/connect-reason-coverage.test.ts`가 수정 없이 green(`OAUTH_FILES`가 `*-oauth.ts` glob이고 webhook은 그 파일을 안 만든다)
  - [ ] `src/store/__tests__/settings-store.test.ts`에 **`version 11 → v12 단계 배선` 케이스를 신규 추가**(`:855-871`을 템플릿으로). 이게 없으면 migrate 호출 한 줄을 지워도 red가 안 난다
  - [ ] `settings-store.test.ts:834`의 하드코딩 `11`이 새 단계를 타 깨지지 않는지 확인 — 깨지면 그 케이스를 v12 기준으로 갱신하되 v12 검증 케이스는 별도로 남긴다
  - [ ] `src/store/__tests__/settings-store.test.ts` 전체 green

### Task 2: URL 정책 (TDD — 테스트 먼저)

- **변경 대상**: `src/sidepanel/lib/webhookUrlPolicy.ts`(신규), `src/sidepanel/lib/__tests__/webhookUrlPolicy.test.ts`(신규)
- **작업 내용**: `normalizeWebhookUrl`. 스킴 없으면 `https://` 보정, `new URL` 실패 시 `WebhookUrlError("invalid")`, `http`면 loopback·사설망 판정 후 통과(`plaintext: true`) 또는 `WebhookUrlError("insecure-public")`. **path·query를 보존한다** — GitLab `normalizeInstanceUrl`을 복제하면 안 된다.
- **검증**:
  - [ ] `https://bugs.acme.io/intake?x=1` → path·query 보존, `plaintext: false`
  - [ ] `http://192.168.1.50:8080/intake` · `http://10.0.0.5` · `http://172.16.0.1` · `http://localhost:3000` · `http://127.0.0.1` · `http://[::1]` · `http://tracker.internal` · `http://tracker` → 통과 + `plaintext: true`
  - [ ] `http://bugs.acme.io/intake` · `http://172.32.0.1`(사설 대역 밖) → `insecure-public`
  - [ ] `ftp://x` · `javascript:alert(1)` · `빈 문자열` → `invalid` 또는 `scheme`
  - [ ] `https://` 대문자 스킴·후행 공백 입력이 정규화된다

### Task 2-b: 헤더 이름 정책 (TDD — 테스트 먼저)

- **변경 대상**: `src/sidepanel/lib/webhookHeaderPolicy.ts`(신규), `src/sidepanel/lib/__tests__/webhookHeaderPolicy.test.ts`(신규)
- **작업 내용**: `isSettableHeaderName(name)`. 브라우저가 설정을 거부하는 헤더는 `fetch`가 **조용히 드롭**하고(문법 오류만 `TypeError`) `declarativeNetRequest` 권한이 없어 우회 수단이 없으므로, 저장 시점 거부가 유일한 방어다.
- **검증**:
  - [ ] `Cookie` · `Host` · `Content-Length` · `Origin` · `Connection` · `Referer` · `Date` · `Via` · `Proxy-Authorization` · `Sec-Fetch-Mode` → 거부
  - [ ] `Authorization` · `X-Api-Key` · `X-BugShot-Test` · `Accept` → 통과
  - [ ] 대소문자 무시(`cookie`·`COOKIE`도 거부)
  - [ ] 공백·제어문자가 든 이름 → 거부(그대로 두면 `Headers`가 `TypeError`를 던진다)
  - [ ] `Content-Type`은 통과시키되, multipart 모드에서 제거하는 책임은 Task 5에 있다

### Task 3: 템플릿 엔진 (TDD — 테스트 먼저)

- **변경 대상**: `src/sidepanel/lib/webhookTemplate.ts`(신규), `src/sidepanel/lib/__tests__/webhookTemplate.test.ts`(신규)
- **작업 내용**: `parseWebhookTemplate`(저장 시점 게이트)와 `renderWebhookTemplate`. **`JSON.parse` 먼저 → 문자열 리프 안에서만 치환**. 리프 전체가 하나의 placeholder면 타입 보존. 변수는 화이트리스트 밖이면 거부.
- **검증**:
  - [ ] 본문에 `"` · `\` · 개행 · 이모지 · 한글이 든 `{{body}}`를 치환해도 결과가 유효한 JSON
  - [ ] `{"n": "{{media.count}}"}` → `n`이 number(문자열 아님)
  - [ ] `{"s": "x{{media.count}}y"}` → `s`가 문자열 `"x3y"`
  - [ ] `{{token}}` · `{{auth.headers}}` · `{{account}}` 같은 화이트리스트 밖 변수 → `unknown-var` 이슈 반환
  - [ ] 깨진 JSON → `invalid-json` 이슈, render는 호출조차 되지 않음
  - [ ] 중첩 배열·객체 안쪽 리프까지 치환된다
  - [ ] `{{media.0.dataUri}}`가 없는 인덱스면 빈 문자열이 아니라 명시적 이슈

### Task 4: 페이로드 빌더 (TDD — 테스트 먼저)

- **변경 대상**: `src/sidepanel/lib/webhookPayload.ts`(신규), `src/sidepanel/lib/__tests__/webhookPayload.test.ts`(신규)
- **작업 내용**: `MarkdownContext` + `CaptureFiles` → `WebhookSubmitPayload`. `media[].part` 이름이 본문의 `cid:` 참조와 **같은 문자열**이어야 한다. 파트 이름은 `buildCaptureFiles`의 filename 규칙(`screenshot.webp`·`before-0.webp`·`logs.html`·`<id>__<원본명>`)을 그대로 쓴다.
- **검증**:
  - [ ] 본문의 모든 `cid:X`에 대응하는 `media[].part === X`가 존재(고아 참조 0)
  - [ ] 역방향도 성립 — `media[]`에 있는데 본문이 참조 안 하는 파트가 없다
  - [ ] 첨부의 `filename`은 원본명, `part`는 고유화된 이름
  - [ ] `environment` 행이 `filterEnvironmentRows`를 거친 결과와 일치
  - [ ] 액션 로그만 있는 경우에도 `logSummary`가 실린다(POSTMORTEM 2026-06-25 회귀)

### Task 5: background 전송 핸들러

- **변경 대상**: `src/background/webhook-api.ts`(신규), `src/types/messages.ts`, `src/background/bgRequestTypes.ts`, `src/background/messages.ts`, `src/background/__tests__/webhook-api.test.ts`(신규)
- **작업 내용**: `webhook.submit` / `webhook.test` 두 핸들러. multipart는 `new FormData()` + `dataUrlToBlob`(`@/store/blob-db` — `Blob` 단독 반환. `notion-api.ts:294`의 동명 함수는 반환 shape이 달라 쓰지 않는다) + `Content-Type` 미지정. json은 `application/json`. **fetch에 `redirect: "manual"` + `credentials: "omit"`을 반드시 건다**(사용자 `Authorization`이 302로 새는 걸 막는다 — `messages.ts:748-749`·`ai-provider.ts:495` 선례). 타임아웃 `AbortSignal.timeout`(제출 30s·테스트 8s). 실패 시 `WebhookError(status, msg, cappedErrorBody)` throw — `readErrorBody`는 무제한 `res.text()`라 못 쓰고 `messages.ts:771` `readCappedSheetText`식 스트리밍 캡 래퍼를 둔다. multipart만 `normalizeWebhookResult`로 `{key,url}`을 뽑고 **없으면 계약 위반으로 throw**; json은 2xx면 응답을 읽지 않는다. **파일별 Blob 변환 직후 원본 dataUrl 슬롯을 null화**한다(합본이라 순차 경로처럼 GC가 안 걷어간다).
- **검증**:
  - [ ] multipart 요청의 파트 구성이 `payload` 1개 + 파일 N개이고 `Content-Type` 헤더를 직접 세팅하지 않는다
  - [ ] 사용자가 `Content-Type: application/json`을 넣어도 **multipart 모드에선 제거**돼 boundary가 살아남는다(json 모드에선 존중)
  - [ ] `isSettableHeaderName`을 통과하지 못한 헤더는 요청에 실리지 않는다
  - [ ] 요청 init에 `redirect: "manual"` · `credentials: "omit"`이 들어간다
  - [ ] 302 응답(`type === "opaqueredirect"`)이 `WebhookError`로 떨어지고, **사용자 헤더 값이 에러 메시지·직렬화 결과 어디에도 없다**
  - [ ] multipart 응답 `{key,url}` / `{id,html_url}`은 성공, `{}` / 비-JSON / `204`는 **계약 위반으로 throw**
  - [ ] json 모드는 `204 No Content`·빈 바디·비-JSON 전부 성공으로 처리하고 응답을 파싱하지 않는다
  - [ ] 404·401·500이 `WebhookError`로 throw되고 `serializePlatformError`가 `{status, body}`를 직렬화
  - [ ] 거대한 에러 본문(수 MB)이 캡에서 잘린다
  - [ ] 타임아웃이 `WebhookError`로 떨어진다
  - [ ] 바디가 `WEBHOOK_BODY_MAX_BYTES`를 넘으면 fetch 전에 중단 — **multipart 조립분도 같은 캡을 받는다**(템플릿 모드 전용이 아니다)
  - [ ] `payload.bugshot.idempotencyKey`가 요청에 실리고, 같은 draft 재전송이 같은 키를 쓴다

### Task 5-b: 시크릿 축 (TDD — 테스트 먼저 · #236 피드백 반영)

- **변경 대상**: `src/types/webhook.ts`(`WebhookAuth.secret?`), `src/background/webhook-api.ts`(`buildHeaders`), `src/background/__tests__/webhook-api.test.ts`
- **작업 내용**: `WebhookAuth`에 `secret?: string`을 추가하고, **전송 시점에** `Authorization: Bearer <secret>`을 합성한다. 저장 시점에 `headers`로 굳히지 않는 이유 둘을 주석에 박는다 — (1) 폼 재편집에서 같은 값이 두 군데로 갈린다 (2) `redactHeaderValues`가 **최종 헤더 맵**을 받으므로 합성해 두면 시크릿이 에코 서버 에러 본문 redaction에 자동으로 걸리는데, 굳히면 그 보장이 코드 배치에 의존하게 된다. 사용자가 고급에서 `Authorization`을 직접 정의했으면 **그쪽이 이긴다**(더 구체적인 의도). `testWebhook`도 같은 `buildHeaders`를 타므로 자동 반영된다. 마이그레이션 없음 — 추가 optional이고 v12 셰이프의 `auth`가 이미 optional이다.
- **검증**:
  - [ ] `secret`이 있으면 `Authorization: Bearer <secret>`이 요청 헤더에 실린다(multipart·json·`webhook.test` 3경로)
  - [ ] 고급 헤더가 `authorization`(대소문자 무시)을 정의하면 그쪽이 이기고 시크릿은 실리지 않는다
  - [ ] `secret`이 비었거나 없으면 `Authorization` 헤더 자체가 없다 — 빈 Bearer를 보내지 않는다
  - [ ] 에코 서버가 되비친 에러 본문에서 시크릿 값이 `***`로 가려진다(`REDACT_MIN_LENGTH` 이상)
  - [ ] `secret` 왕복이 `settings-storage`·`settings-store`에서 보존된다

### Task 6: 제출 어댑터

- **변경 대상**: `src/sidepanel/lib/submitToWebhook.ts`(신규), `src/sidepanel/lib/submitAdapters.ts`, `src/sidepanel/lib/prepareUpload.ts:76`, `src/sidepanel/lib/buildMarkdownIssueBody.ts:33`, `src/sidepanel/lib/__tests__/submitToWebhook.test.ts`(신규)
- **작업 내용**: `prepareUpload`·`buildMarkdownIssueBody`의 `opts.platform`에 `"webhook"` 추가. `cidUploadFn`은 네트워크 0으로 `{ filename, href: \`cid:${filename}\` }`를 즉시 반환 — **`someUploadMissing`이 항상 false가 되는 것이 의도**임을 주석에 박는다. `markSubmitted` 인근에 "두 모드 모두 atomic 단일 POST라 `requireMediaUpload` 가드 불필요"를 명시(POSTMORTEM 2026-06-30 재발방지 (3)이 요구하는 절차).
- **검증**:
  - [ ] multipart 모드 본문의 인라인 이미지 마커가 `cid:`로 치환된다
  - [ ] json 모드는 `prepareUpload`를 타지 않고 템플릿 결과만 보낸다
  - [ ] **json 모드 성공은 `markSubmitted`를 호출하지 않는다** — 이슈 목록 행을 만들지 않고 전송 성공 토스트로 끝난다(비목표)
  - [ ] multipart 성공은 `markSubmitted`로 행을 만들고 `{key,url}`이 그대로 실린다
  - [ ] 제출 실패 시(2xx 아님 / 계약 위반 / 타임아웃) `markSubmitted`가 호출되지 않는다(원본 보존)
  - [ ] 같은 draft를 두 번 제출하면 `idempotencyKey`가 같다
  - [ ] `bodyLocale`이 사이드패널에서 이미 적용돼 background 재래핑이 필요 없음을 테스트로 고정

### Task 7: 제출 UI 배선

- **변경 대상**: `src/sidepanel/tabs/SubmitPlatformTabs.tsx`(`PLATFORM_TABS` — Task 0에서 다이얼로그 밖으로 나갔다), `src/sidepanel/tabs/SubmitFieldsDialog.tsx`(`platformConfigured`·`fieldsReady`·`ccCount`·폼 삼항 체인), `src/sidepanel/tabs/IssueCreateModal.tsx`, `src/sidepanel/tabs/DraftDetailDialog.tsx`
- **작업 내용**: 두 진입점에 `handleWebhookSubmit`. `DraftDetailDialog`에는 **`clearPicker` + `reset` 블록**이 추가로 들어간다(이 경로에만 있는 처리). `setLastSubmitFields`는 호출하지 않는다(`webhook?: never`).
- **검증**:
  - [ ] 폼 분기를 notion fallback **앞에** 넣었다 — webhook 탭에서 Notion 폼이 안 뜬다
  - [ ] `PLATFORM_TABS`에 9번째가 들어간 직후 **`src/sidepanel/tabs/__tests__/SubmitPlatformTabs.test.tsx`의 상단 주석을 지우고 9탭 스크롤 분기 단언을 추가**한다 — 그 주석의 "9탭 렌더는 불가능"은 이 태스크와 동시에 거짓이 되고, Task 0이 유닛으로 못 잡던 `wrapperClass`·`forceCollapsed` 배선이 이 시점에 처음 잡을 수 있게 된다
  - [ ] 제출 필드가 없어도 제출 버튼이 활성(`fieldsReady === true`)
  - [ ] 계정 미연결 시 탭이 안 뜬다
  - [ ] 라이브 제출과 저장 draft 재제출 양쪽에서 성공/실패가 동일하게 동작

### Task 8: 연결 UI

- **변경 대상**: `src/sidepanel/tabs/connect/WebhookConnectForm.tsx`(신규), `src/sidepanel/tabs/IntegrationsTab.tsx`(`PlatformEntry.ConnectFlow` optional화 + `PLATFORMS` 추가 + `add` 서브탭 그리드 제외 + 중앙 덩어리 안 진입 버튼), `src/sidepanel/tabs/connect/__tests__/WebhookConnectForm.test.tsx`(신규)
- **작업 내용**:
  - **진입**: `add` 서브탭(`IntegrationsTab.tsx:167-196`)의 2열 브랜드 그리드 매핑에서 `webhook`을 제외하고, **중앙 덩어리(`items-center justify-center`) 안** 그리드 바로 아래 `gap-4` 자리에 구분선 + `<WebhookConnectEntry />`를 둔다. **`PageFooter`를 쓰지 않는다** — 그건 `PageScroll`의 짝이고 이 서브탭은 중앙정렬이라, 붙이면 그리드가 ~34.5px 위로 밀리고 `pb-5`와 겹쳐 이중 여백이 생기며 세로가 짧을 때 상단이 클립된다(design.md 참조). 설명 문구는 버튼 툴팁으로 단다(`TooltipProvider delayDuration={0}` > `Tooltip` > `TooltipTrigger asChild`, `IssueTab.tsx:368-389` 관용구).
  - **그리드 제외 방식**: `PlatformEntry.ConnectFlow`(`:48-54`)가 non-optional이라 더미 컴포넌트를 주입하는 대신 **`ConnectFlow?`로 optional화하고 그리드 매핑을 `PLATFORMS.filter(p => p.ConnectFlow)`로 좁힌다** — 타입과 런타임 필터를 한 곳에 묶는다. **`PLATFORMS` 배열에는 그대로 남긴다**(내 연동 목록의 `IntegrationsTab.tsx:130-132` `PLATFORMS.find(...)!`가 `undefined`로 터진다).
  - **다이얼로그**: 진입 버튼 클릭 시 연다. **기본 화면은 입력 칸 둘뿐이다 — Endpoint + Secret**(#236 피드백). 그 아래 접이식 `고급` 안에 헤더 key/value 동적 행 + Format 셀렉터 + (json일 때) 템플릿 textarea + 미리보기·바디 크기를 넣는다. 접이식은 `components/ui/collapsible`을 쓰고, 기본은 **닫힌 상태**이되 저장된 계정이 고급 값(헤더 ≥1 또는 `format === "json"`)을 들고 있으면 열린 채로 연다 — 안 그러면 편집 진입 시 설정이 사라진 것처럼 보인다. Secret 아래 한 줄 도움말로 `Authorization: Bearer`로 나간다는 사실을 밝힌다(수신부를 직접 짜는 사람이 상대다). 하단은 토큰 다이얼로그 7개와 같은 `DialogFooter className="flex-row justify-end"`에 `연결 테스트`·`저장`. 다이얼로그 셸은 `w-[90vw] max-w-[800px] gap-5 rounded-3xl p-6 sm:rounded-3xl` + 내부 `min-h-0 flex-1 overflow-y-auto` 본문(저장소 관용구).
  - **헤더 행 UI**: 선례는 `connect/`가 아니라 `DraftingPanel.tsx:687-806`의 재현 환경 행이다 — `Input`(`w-24` 이름 + `flex-1` 값) + `size="icon" h-9 w-9` 삭제 버튼, 마지막 행에만 추가 버튼. **헤더 값은 마스킹하지 않는다**(8개 폼의 PAT이 전부 평문 `Input`이고 유일한 `type="password"`는 `LlmConnectDialog.tsx:296` — 여기만 새 관용구를 만들지 않는다).
  - `PlatformConnectFlow`는 OAuth prop을 필수로 요구하므로 **재사용하지 않는다**. 버튼 관용구(`validating` state, `disabled`+`aria-disabled` 분리, `opacity-0` + 절대 위치 `Loader2`, 성공 시에만 `setAccount`)는 토큰 다이얼로그 7개와 동일하게 맞춘다(Slack은 다이얼로그가 없어 선례에서 제외).
- **검증**:
  - [ ] `add` 서브탭 브랜드 그리드에 8개만 남고 `Custom Webhook`은 그 아래 구분선 밑에 단독으로 뜬다
  - [ ] 그리드 덩어리가 기존과 같은 세로 위치에 있다(중앙정렬 유지 — 푸터 도입 시 생기던 밀림이 없다)
  - [ ] 내 연동 목록에서는 다른 8개와 같은 Section + `DisconnectButton`으로 렌더된다(그리드 제외가 여기까지 번지지 않음)
  - [ ] `ConnectFlow` optional화 후에도 기존 8개가 전부 그리드에 뜬다(`filter`가 8개를 통과시킨다)
  - [ ] 테스트 실패 시 `setAccount`가 호출되지 않는다
  - [ ] 평문 사설망 URL에 경고 배지가 뜨고 저장은 된다
  - [ ] 공인망 http는 저장 버튼 자체가 막힌다
  - [ ] `Cookie`·`Host` 등 forbidden header 이름을 넣으면 저장이 거부되고 사유가 표시된다
  - [ ] 잘못된 템플릿은 저장이 거부되고 어떤 변수/구문이 문제인지 표시된다
  - [ ] 기본 화면에 입력 칸이 Endpoint·Secret **둘뿐**이고 Format·헤더·템플릿은 보이지 않는다
  - [ ] 고급을 펴야 Format·헤더·템플릿이 나온다
  - [ ] 고급 값(헤더 ≥1 또는 json)을 가진 계정을 다시 열면 고급이 펼쳐진 상태로 뜬다
  - [ ] Secret만 채우고 저장하면 `auth.headers`가 빈 배열로 저장된다(시크릿을 헤더로 굳히지 않는다 — Task 5-b)
  - [ ] Format을 `JSON 템플릿`으로 바꾸면 "미디어를 보내지 않고 이슈 이력을 남기지 않는다"가 그 자리에서 보인다
  - [ ] 헤더 값이 에러 토스트·콘솔 어디에도 찍히지 않는다(화면 표시는 평문이 정상)
  - [ ] `pnpm test`의 `muted-surface-contrast` 게이트 통과

### Task 9: 배지·칩

- **변경 대상**: `src/sidepanel/tabs/statusBadges/WebhookSubmittedBadge.tsx`(신규), `SubmittedBadge.tsx`, `PlatformChip.tsx`, `src/lib/bg-client.ts:61-74`, `src/sidepanel/tabs/__tests__/issueListUtils.test.ts`
- **작업 내용**: `SlackSubmittedBadge`를 본떠 폴링 없이 `onLoaded()`를 즉시 부르는 정적 배지. `PlatformChip` 분기는 **github fallback 앞에** 삽입. `getOAuthErrorPlatform`의 8리터럴 `||` 체인에 webhook 추가. `promotableTargets`(`issueListUtils.ts:124`)는 **분기를 안 넣는 게 정답**이지만 무음 동작이라 회귀 테스트로 고정한다.
- **검증**:
  - [ ] 이슈 목록에서 webhook 행이 로딩 스피너에 갇히지 않는다
  - [ ] `issueListUtils.isRefreshable()`이 webhook에 `false`(분기 추가 없이 자연 폴백) — 테스트로 고정
  - [ ] `promotableTargets`가 webhook을 포함한다 — 의도된 동작이므로 테스트로 고정(현재 slack 제외조차 테스트가 없다)
  - [ ] Slack 보존 이슈 승격 UI에서 webhook을 고르면, json 모드일 때 "목록 행이 안 생긴다"가 보인다
  - [ ] `getOAuthErrorPlatform("webhook")`이 `null`이 아니다 — 빠뜨리면 `App.tsx:156`이 Jira 재연결 다이얼로그를 띄운다(`bg-client.test.ts:209`가 red로 잡는다)
  - [ ] 칩이 github 아이콘으로 안 뜬다

### Task 10: i18n

- **변경 대상**: `src/i18n/namespaces/{app,integrations,issue}.ts`, `src/i18n/__tests__/proper-nouns.test.ts`
- **작업 내용**: `platform.tab.webhook`(값은 **`Custom Webhook`** — 내부 `PlatformId`는 짧은 `"webhook"`으로 두고 표시 라벨만 길게 간다) + `webhook.*`(라벨·placeholder·에러·경고 + 진입 버튼 툴팁 `webhook.entry.tooltip` — 수신 서버를 직접 준비해야 한다는 걸 한 문장으로) 키를 **등록 로케일 전수** 추가. 시크릿·고급 축 키도 함께: `webhook.secret.label`·`webhook.secret.placeholder`·`webhook.secret.help`(`Authorization: Bearer`로 나간다는 한 줄)·`webhook.advanced.label`. `src/log-viewer/i18n.ts`와 `public/_locales/`는 이 키를 쓰지 않으므로 건드리지 않는다.
- **검증**:
  - [ ] PostToolUse 훅이 돌리는 `src/i18n/__tests__/locales.test.ts` green(전수 키 대칭·빈 값·placeholder 토큰 일치)
  - [ ] `src/log-viewer/__tests__/i18n.test.ts` green(교집합 키 값 일치 — 교집합이 없으므로 무영향임을 확인)
  - [ ] `proper-nouns.test.ts:19-24` `PROPER_NOUNS`에 `"Webhook"` 등재 — 안 하면 ko/en 외 로케일에서 번역돼 사라져도 영구 무음이다
  - [ ] `webhook.error.mediaUploadFailed` 키 존재 — `prepareUpload.ts:103`이 템플릿 리터럴로 조립해 누락이 컴파일 에러가 아니라 무음 폴백이다(도달 불가 경로지만 채운다)

### Task 11: 계약 문서 + 레퍼런스 수신 서버

- **변경 대상**: `docs/webhook-contract.md`(신규)
- **작업 내용**: **인증 먼저** — 시크릿이 `Authorization: Bearer <secret>`으로 온다는 것과 수신 측 검증이 문자열 비교 한 줄이라는 것(서명이 아니다. 이유는 design.md 대안 5-c). 이어서 multipart 파트 구성, `payload` JSON 스키마, `cid:` 참조 규칙, **필수 응답 `{key,url}`**(권장이 아니라 계약 — 없으면 제출 실패), **멱등 키(`payload.bugshot.idempotencyKey`)로 dedup하는 방법**, 테스트 요청의 `X-BugShot-Test: 1`, 타임아웃·크기 상한, 브라우저가 못 싣는 헤더 목록, 템플릿 변수 화이트리스트 전체. json 템플릿 모드는 응답을 읽지 않는다는 점도 명시. 끝에 **동작하는 최소 수신 서버**(의존성 없는 node `http` 기준 40줄 이내)를 싣는다.
- **검증**:
  - [ ] 문서의 레퍼런스 서버를 그대로 띄워 실제 제출이 2xx로 끝나고 `{key,url}`을 돌려준다
  - [ ] 레퍼런스 서버가 `idempotencyKey`로 중복을 걸러내는 3줄을 포함한다
  - [ ] 문서에 적힌 파트 이름이 Task 4의 테스트가 고정한 값과 일치

### Task 12: privacy 갱신

- **변경 대상**: `docs/privacy.ko.md`(원본), `docs/privacy.en.md`(번역)
- **작업 내용**: 손댈 곳이 **표 한 행이 아니라 네 곳**이다.
  1. `privacy.ko.md:139-153` "3. 외부 전송" 3열 표에 **"사용자가 지정한 서버"** 행 추가(Slack 다음). 전송 내용(리포트 본문·스크린샷·영상·로그·사용자 헤더) + 목적.
  2. 그 표 뒤 자유 문단(`:155-163`)에 GitLab self-managed 문단(`:159`)과 **같은 형식**으로 한 문단 — 임의 origin 직접 통신 + `<all_urls>`로 커버돼 별도 권한 프롬프트 없음 + 사용자 헤더가 그 서버로 나감. 3열 표로는 안 담긴다.
  3. `:13-30` §1 자격 증명 표에 webhook URL + **시크릿** + 고급 요청 헤더 행 추가. 시크릿이 `Authorization` 헤더로 그 서버에 전송된다는 사실까지 적는다.
  4. `:169-175` §5 데이터 삭제의 플랫폼 8개 나열에 Custom Webhook 추가.
  상단 시행일(`:3`)을 ko/en 함께 갱신. **ko/en은 라인 단위로 평행**하므로 같은 인덱스에 넣는다.
- **검증**:
  - [ ] ko/en 본문과 시행일이 같은 커밋에서 함께 바뀐다
  - [ ] ko/en의 `## 1.`/`## 2.`/`## 3.`/`## 4.` 시작 라인이 여전히 일치한다
  - [ ] 네 곳(§1 표 · §3 표 · §3 자유 문단 · §5 삭제)이 전부 반영됐다
  - [ ] manifest diff가 0이어도 이 갱신이 들어갔다(30s Replay 심사 탈락 전례)

### Task 13-a: 전송 계약 유닛 (Task 5에 포함 가능)

- **변경 대상**: `src/background/__tests__/webhook-api.test.ts`
- **작업 내용**: **파트 구성·`cid:` 대응 검증은 e2e가 아니라 여기서 한다.** `panel.route`는 background SW fetch를 못 잡고(`e2e/GOTCHAS.md:69`), 유일한 제출 e2e 선례(`slack-issue-promotion.spec.ts`)는 `chrome.runtime.sendMessage`를 스파이해 가짜 응답을 돌려주므로 **실제 multipart가 목 서버에 도달하지 않는다**. `src/test/fetch-mock.ts`의 `mockFetchOnce().formDataAt(0)`으로 요청 바디를 직접 뜯는다(node 24라 `FormData`·`Blob` 네이티브).
- **검증**:
  - [ ] `formDataAt(0)`의 키 집합이 `payload` 1개 + 파일 N개
  - [ ] `payload` 파트를 파싱한 JSON의 모든 `cid:X`에 대응하는 파일 파트가 존재(양방향)
  - [ ] 요청 헤더에 `Content-Type`이 없다(boundary 자동 부착)

### Task 13-b: e2e UI 동선

- **변경 대상**: `e2e/webhook-submit.spec.ts`(신규)
- **작업 내용**: 기존 선례대로 `bugshot-settings` storage seed로 계정을 우회 연결하고 `chrome.runtime.sendMessage` 스파이로 `webhook.submit`/`webhook.test` 응답을 가짜로 돌려준다. **spec 끝에 `chrome.storage.local.remove("bugshot-settings")`를 반드시 넣는다**(스토리지 오염이 다음 spec으로 샌다 — `GOTCHAS.md:70`). `data-testid`를 신규 UI에 부착한다.
- **검증**:
  - [ ] 연결 테스트가 2xx를 받으면 계정이 저장되고 다이얼로그가 닫힌다
  - [ ] 공인망 `http://` URL을 입력하면 저장이 거부되고 사유가 표시된다
  - [ ] 계정 연결 후 제출 다이얼로그에 `Custom Webhook` 탭이 뜬다
  - [ ] **9개 계정을 전부 seed한 케이스를 별도로 둔다** — 2~3개만 seed하면 탭 줄이 그리드 경로에 머물러 Task 0의 스크롤 분기가 여전히 미도달이다(선례 spec들이 2~3개만 seed한다). 단언은 셋: 각 트리거 `boundingBox().width >= 38`(아이콘 14 + `px-3` 24) / `tablist` className에 `grid-cols-`가 없다 / 첫·마지막 트리거가 스크롤 후 클릭 가능하다. "아이콘이 안 잘린다"를 눈대중 문구로 두면 작성 시점에 약해진다
  - [ ] 스파이가 `{key,url}`을 주면 이슈 목록 행에 그 키와 링크가 붙는다
  - [ ] 스파이가 500을 주면 제출이 실패하고 draft가 목록에 남는다
  - [ ] json 모드 제출이 성공하면 **이슈 목록에 행이 생기지 않는다**

### Task 14: stale 열거 갱신

- **변경 대상**: `src/sidepanel/lib/__tests__/track-submit.test.ts:9-16`, `src/sidepanel/tabs/__tests__/integrationsTabUtils.test.ts:9-15`, `src/store/__tests__/settings-store.test.ts:277-297`
- **작업 내용**: 플랫폼을 하드코딩 배열로 든 테스트들이 webhook 추가 시 **전부 무음으로 통과한다**(부분 배열이 합법이라 red가 안 난다). 손으로 갱신한다. `track-submit.test.ts`는 이미 6개뿐인 stale이라 8개→9개로 함께 맞춘다. `settings-store.test.ts`의 "8종 전부 연결 시 폴백 순서" 케이스는 webhook 랭크를 고정하지 않으면 테스트 이름이 거짓이 된다.
- **검증**:
  - [ ] 세 배열이 전부 9개이고, 하나를 빼면 해당 테스트가 red
  - [ ] `PLATFORM_FALLBACK_RANK.webhook`이 테스트로 고정된다

---

## 테스트 계획

**단위 테스트** (`*.test.ts`, node 환경)
- `webhookUrlPolicy` — Task 2 검증 항목 전수. 사설망 대역 경계값(`172.15.x`/`172.16.x`/`172.31.x`/`172.32.x`) 포함.
- `webhookHeaderPolicy` — forbidden name 전수, 대소문자 무시, 문법 위반 이름.
- `webhookTemplate` — 이스케이프(따옴표·역슬래시·개행·유니코드), 타입 보존, 화이트리스트 거부, 중첩 구조.
- `webhookPayload` — `cid:` 참조와 `media[].part`의 양방향 대응, 액션 로그 단독 케이스.
- `webhook-api` — **파트 구성·`cid:` 대응**(e2e가 못 보는 축), 사용자 `Content-Type` 제거, `redirect:"manual"`·`credentials:"omit"`, 302 거부, 응답 정규화 4종 + 계약 위반 throw, json 모드 204 성공, 에러 직렬화·본문 캡, 타임아웃, 바디 캡(multipart 포함), 멱등 키.
- `submitToWebhook` — 실패 시 `markSubmitted` 미호출, json 모드는 성공해도 행 미생성, 두 모드 분기, 같은 draft 재전송의 멱등 키 동일성.
- `settings-store` — v11 → v12 migrate 단계 배선(신규 케이스), `PLATFORM_FALLBACK_RANK.webhook` 고정.
- `issueListUtils` — `isRefreshable(webhook) === false`, `promotableTargets`가 webhook 포함.
- `bg-client` — `getOAuthErrorPlatform("webhook")`이 `null`이 아니다.

`src/test/fetch-mock.ts`(`mockFetchOnce`/`mockFetchRoutes` + `formDataAt`/`jsonBodyAt`)를 쓴다. `github-api.test.ts`의 구식 `globalThis.fetch` 직접 대입 관용구와 **같은 `describe`에서 섞지 않는다**(그 파일 주석이 경고하는 함정).

**컴포넌트 테스트** (`*.test.tsx`, jsdom)
- `WebhookConnectForm` — **기본 화면 입력 칸 2개(Endpoint·Secret)**, 고급을 펴야 Format·헤더·템플릿 노출, 고급 값을 가진 계정은 펼친 채 열림, 테스트 실패 시 저장 안 됨, 평문 경고, forbidden header 거부, 템플릿 유효성 게이트, Format 전환 시 JSON 모드 한계 고지 노출.

**e2e 시나리오** (`/e2e-write` 입력 — Task 13-b)
- 로컬 목 수신 서버가 아니라 **`chrome.runtime.sendMessage` 스파이**로 background 응답을 가짜로 만든다(`panel.route`는 SW fetch를 못 잡는다). 계정은 `bugshot-settings` storage seed로 우회 연결하고 spec 끝에 제거한다.
- Custom Webhook을 연결하면, 연결 테스트가 2xx를 받아 계정이 저장된다.
- 공인망 `http://` URL을 입력하면, 저장이 거부되고 사유가 표시된다.
- 계정 연결 후 제출 다이얼로그에 `Custom Webhook` 탭이 뜨고 9개 탭에서 아이콘이 잘리지 않는다.
- `{key,url}` 응답이면 이슈 목록 행에 그 키와 링크가 표시된다.
- 500 응답이면 제출이 실패하고 draft가 목록에 남는다.
- json 모드로 제출하면 성공 토스트가 뜨고 **이슈 목록에 행이 생기지 않는다**.

**수동 테스트** (자동화 불가)
- [ ] 실제 사설망 호스트(`http://<사내 IP>:port`)로 제출 — 평문 경고 표시와 실제 전송
- [ ] Discord 웹훅 URL + 템플릿 모드로 실제 메시지 도착 확인(204 응답이 성공으로 처리되는지)
- [ ] 실제 목 서버가 multipart를 받아 파싱되는지 — `docs/webhook-contract.md`의 레퍼런스 서버로
- [ ] 30s replay 영상 + 첨부 40MB 조합에서 바디 캡 차단과 SW 메모리 거동
- [ ] 응답이 느린 서버(30초 초과)에서 타임아웃 토스트 문구
- [ ] 302를 돌려주는 서버에서 `Authorization`이 리다이렉트 대상으로 안 나가는지(DevTools 네트워크)

---

## 구현 순서 권장

```
Task 0 (단독 선행 · 탭 줄 가로 스크롤 전환)
   ↓
Task 1 (타입 축 + migrate 배선 — 이후 전부의 전제)
   ↓
Task 2 · Task 2-b · Task 3 · Task 4   ← 순수 함수 4개, 서로 독립이라 병렬 가능
   ↓
Task 5 (background + 13-a 계약 유닛) ── Task 6 (어댑터)   ← 5가 6의 전제
   ↓
Task 5-b (시크릿 축 — 타입 + buildHeaders)   ← Task 8 연결 폼의 전제
   ↓
Task 7 (제출 UI) · Task 8 (연결 UI) · Task 9 (배지·칩·승격)   ← 병렬 가능
   ↓
Task 10 (i18n) · Task 14 (stale 열거 갱신)   ← 7·8·9가 쓰는 키가 확정된 뒤
   ↓
Task 11 (계약 문서) · Task 12 (privacy)   ← 병렬 가능
   ↓
Task 13-b (e2e — 전체가 동작한 뒤)
```

Task 2·2-b·3·4는 `/tdd interface`로 테스트를 먼저 박고 시작한다. Task 0은 이 기능과 무관한 픽스라 별도 커밋으로 분리한다.

**i18n 키 타이밍**: Task 10이 뒤에 있어 7·8·9 개발 중에는 `t()`가 키 문자열을 그대로 반환한다(DEV `console.error` + 키 노출). `src/i18n/` PostToolUse 훅이 red를 차단하므로 키를 먼저 박고 싶으면 Task 10을 1 직후로 당겨도 된다 — 다만 그러면 문구를 두 번 손보게 된다.

## 가이드 영향

사용자 노출 기능이므로 갱신 필요. 작성 전 `guide/AUTHORING.md`를 먼저 읽는다.

- `guide/ko/integrations/platforms.md` · `guide/en/integrations/platforms.md` — 지원 대상 표에 Custom Webhook 추가. 다른 8개와 성격이 달라(사용자가 수신부를 직접 준비) 별도 단락으로 구분하고 `docs/webhook-contract.md`로 링크.
- `guide/ko/integrations/issue-tracking.md` · `guide/en/integrations/issue-tracking.md` — 상태 동기화·제출 필드가 없다는 점을 명시(다른 플랫폼과 동작이 다른 지점).
- `guide/ko/integrations/README.md` · `guide/en/integrations/README.md` — 목록·요약에 반영.
- 화면이 새로 생기므로(`연동 > 플랫폼 추가 > Custom Webhook` 다이얼로그) 구현 후 `/guide-shots`로 스크린샷 촬영 필요.
