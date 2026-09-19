# Custom Webhook 전송 — 구현 태스크

## 선행 조건

- 새 권한·env 없음. `<all_urls>`가 이미 required라 임의 엔드포인트 fetch가 추가 프롬프트 없이 동작한다.
- 새 의존성 없음. multipart는 표준 `FormData`, 아이콘은 이미 설치된 lucide의 `Webhook`.
- 착수 전 `docs/POSTMORTEM.md`에서 `어댑터` 영역을 grep해 과거 함정을 소환한다(특히 2026-06-30 업로드 모델 3건, 2026-06-25 `emitLogSummary` 8빌더).
- 로컬 목 수신 서버는 e2e에서 node `http` 모듈로 띄운다(별도 패키지 추가 금지). `127.0.0.1`은 URL 정책상 loopback이라 허용된다.

---

## 태스크

### Task 0: `TABS_GRID_COLS` 9열 선행 픽스

- **변경 대상**: `src/sidepanel/tabs/SubmitFieldsDialog.tsx:101-110`
- **작업 내용**: `9: "grid-cols-9"` 추가. 이 기능과 독립된 잠복 버그라 **먼저 단독으로** 고친다 — 나중에 고치면 webhook 회귀로 오인된다.
- **검증**:
  - [ ] 기존 8개 연결 상태에서 탭 줄이 기존과 동일(회귀 없음)
  - [ ] 9개 연결 시 탭이 한 줄에 9칸으로 배치

### Task 1: 타입 축 + 컴파일 게이트

- **변경 대상**: `src/types/platform.ts`(`PlatformId`·`PLATFORM_TAB_KEYS`·`Accounts`·`LastSubmitFieldsByPlatform`), `src/types/webhook.ts`(신규), `src/background/oauth/config.ts`, `src/background/platformErrors.ts`, `src/store/settings-store.ts`, `src/sidepanel/lib/attachmentLimits.ts`
- **작업 내용**: `PlatformId`에 `"webhook"` 추가 → 빨개지는 곳을 design.md "컴파일러가 강제하는 5곳" 표대로 채운다. `OAUTH_CONFIG`는 값을 채우지 않고 `OAuthPlatformId = Exclude<PlatformId, "webhook">`를 신설해 타입을 좁힌다. `LastSubmitFieldsByPlatform`은 `webhook?: never`. `SETTINGS_STORE_VERSION` → 12(전부 optional이라 마이그레이션 함수 불필요).
- **검증**:
  - [ ] `pnpm typecheck` green — 5개 게이트가 전부 채워졌다는 뜻
  - [ ] `src/background/__tests__/connect-reason-coverage.test.ts`가 수정 없이 green(OAuth 파일은 여전히 8개)
  - [ ] `src/store/__tests__/settings-store.test.ts` green

### Task 2: URL 정책 (TDD — 테스트 먼저)

- **변경 대상**: `src/sidepanel/lib/webhookUrlPolicy.ts`(신규), `src/sidepanel/lib/__tests__/webhookUrlPolicy.test.ts`(신규)
- **작업 내용**: `normalizeWebhookUrl`. 스킴 없으면 `https://` 보정, `new URL` 실패 시 `WebhookUrlError("invalid")`, `http`면 loopback·사설망 판정 후 통과(`plaintext: true`) 또는 `WebhookUrlError("insecure-public")`. **path·query를 보존한다** — GitLab `normalizeInstanceUrl`을 복제하면 안 된다.
- **검증**:
  - [ ] `https://bugs.acme.io/intake?x=1` → path·query 보존, `plaintext: false`
  - [ ] `http://192.168.1.50:8080/intake` · `http://10.0.0.5` · `http://172.16.0.1` · `http://localhost:3000` · `http://127.0.0.1` · `http://[::1]` · `http://tracker.internal` · `http://tracker` → 통과 + `plaintext: true`
  - [ ] `http://bugs.acme.io/intake` · `http://172.32.0.1`(사설 대역 밖) → `insecure-public`
  - [ ] `ftp://x` · `javascript:alert(1)` · `빈 문자열` → `invalid` 또는 `scheme`
  - [ ] `https://` 대문자 스킴·후행 공백 입력이 정규화된다

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
- **작업 내용**: `webhook.submit` / `webhook.test` 두 핸들러. multipart는 `new FormData()` + `dataUrlToBlob`(`@/store/blob-db`) + `Content-Type` 미지정. json은 `application/json`. 타임아웃 `AbortSignal.timeout`(제출 30s·테스트 8s). 실패 시 `WebhookError(status, msg, cappedErrorBody)` throw — 캡 씌운 래퍼를 쓴다. `normalizeWebhookResult`로 `{key,url}` best-effort 추출.
- **검증**:
  - [ ] multipart 요청의 파트 구성이 `payload` 1개 + 파일 N개이고 `Content-Type` 헤더를 직접 세팅하지 않는다
  - [ ] 사용자 헤더가 요청에 실리고, `Content-Type`을 사용자가 지정해도 multipart 모드에선 무시된다
  - [ ] 응답 `{key,url}` / `{id,html_url}` / `{}` / 비-JSON 각각에 대한 `normalizeWebhookResult` 결과
  - [ ] 404·401·500이 `WebhookError`로 throw되고 `serializePlatformError`가 `{status, body}`를 직렬화
  - [ ] 타임아웃이 `WebhookError`로 떨어진다
  - [ ] 바디가 `WEBHOOK_BODY_MAX_BYTES`를 넘으면 fetch 전에 중단

### Task 6: 제출 어댑터

- **변경 대상**: `src/sidepanel/lib/submitToWebhook.ts`(신규), `src/sidepanel/lib/submitAdapters.ts`, `src/sidepanel/lib/prepareUpload.ts:76`, `src/sidepanel/lib/buildMarkdownIssueBody.ts:33`, `src/sidepanel/lib/__tests__/submitToWebhook.test.ts`(신규)
- **작업 내용**: `prepareUpload`·`buildMarkdownIssueBody`의 `opts.platform`에 `"webhook"` 추가. `cidUploadFn`은 네트워크 0으로 `{ filename, href: \`cid:${filename}\` }`를 즉시 반환 — **`someUploadMissing`이 항상 false가 되는 것이 의도**임을 주석에 박는다. `markSubmitted` 인근에 "두 모드 모두 atomic 단일 POST라 `requireMediaUpload` 가드 불필요"를 명시(POSTMORTEM 2026-06-30 재발방지 (3)이 요구하는 절차).
- **검증**:
  - [ ] multipart 모드 본문의 인라인 이미지 마커가 `cid:`로 치환된다
  - [ ] json 모드는 `prepareUpload`를 타지 않고 템플릿 결과만 보낸다
  - [ ] 제출 실패 시 `markSubmitted`가 호출되지 않는다(원본 보존)
  - [ ] `bodyLocale`이 사이드패널에서 이미 적용돼 background 재래핑이 필요 없음을 테스트로 고정

### Task 7: 제출 UI 배선

- **변경 대상**: `src/sidepanel/tabs/SubmitFieldsDialog.tsx`(`PLATFORM_TABS`·`platformConfigured`·`fieldsReady`·`ccCount`·폼 삼항 체인), `src/sidepanel/tabs/IssueCreateModal.tsx`, `src/sidepanel/tabs/DraftDetailDialog.tsx`
- **작업 내용**: 두 진입점에 `handleWebhookSubmit`. `DraftDetailDialog`에는 **`clearPicker` + `reset` 블록**이 추가로 들어간다(이 경로에만 있는 처리). `setLastSubmitFields`는 호출하지 않는다(`webhook?: never`).
- **검증**:
  - [ ] 폼 분기를 notion fallback **앞에** 넣었다 — webhook 탭에서 Notion 폼이 안 뜬다
  - [ ] 제출 필드가 없어도 제출 버튼이 활성(`fieldsReady === true`)
  - [ ] 계정 미연결 시 탭이 안 뜬다
  - [ ] 라이브 제출과 저장 draft 재제출 양쪽에서 성공/실패가 동일하게 동작

### Task 8: 연결 UI

- **변경 대상**: `src/sidepanel/tabs/connect/WebhookConnectForm.tsx`(신규), `src/sidepanel/tabs/IntegrationsTab.tsx`(`PLATFORMS` 추가 + `add` 서브탭 그리드 제외 + `PageFooter` 신설), `src/sidepanel/tabs/connect/__tests__/WebhookConnectForm.test.tsx`(신규)
- **작업 내용**:
  - **진입**: `add` 서브탭(`IntegrationsTab.tsx:166-195`)의 2열 브랜드 그리드 매핑에서 `webhook`을 제외하고, `PageShell` 아래에 `<PageFooter><div className="flex justify-end"><WebhookConnectEntry /></div></PageFooter>`를 신설한다. **푸터엔 버튼만 — 설명 문구는 버튼 툴팁으로** 단다(`TooltipProvider delayDuration={0}` > `Tooltip` > `TooltipTrigger asChild`, `IssueTab.tsx:368-389` 관용구). `connected` 서브탭의 `DisconnectAllButton` 배치(`IntegrationsTab.tsx:152-160`)와 같은 구조다. `PageFooter`는 `@/sidepanel/components/Section`에서 import — 클래스 문자열을 복제하지 않는다. **`PLATFORMS` 배열에는 그대로 남긴다**(내 연동 목록의 `PLATFORMS.find(...)!`가 터진다).
  - **다이얼로그**: 진입 버튼 클릭 시 연다. 내용은 URL 입력 + 헤더 key/value 동적 행 + Format 셀렉터 + (json일 때) 템플릿 textarea + 미리보기·바디 크기. 하단은 기존 7개와 같은 `DialogFooter className="flex-row justify-end"`에 `연결 테스트`·`저장`.
  - `PlatformConnectFlow`는 OAuth prop을 필수로 요구하므로 **재사용하지 않는다**. 버튼 관용구(`validating` state, `disabled`+`aria-disabled` 분리, `opacity-0` + 절대 위치 `Loader2`, 성공 시에만 `setAccount`)는 8개 폼과 동일하게 맞춘다. 헤더 값은 마스킹 표시.
- **검증**:
  - [ ] `add` 서브탭 브랜드 그리드에 8개만 남고 `Custom Webhook`은 하단 푸터에 단독으로 뜬다
  - [ ] 내 연동 목록에서는 다른 8개와 같은 Section + `DisconnectButton`으로 렌더된다(그리드 제외가 여기까지 번지지 않음)
  - [ ] 테스트 실패 시 `setAccount`가 호출되지 않는다
  - [ ] 평문 사설망 URL에 경고 배지가 뜨고 저장은 된다
  - [ ] 공인망 http는 저장 버튼 자체가 막힌다
  - [ ] 잘못된 템플릿은 저장이 거부되고 어떤 변수/구문이 문제인지 표시된다
  - [ ] 헤더 값이 화면에 평문으로 남지 않는다
  - [ ] 푸터에 버튼 외 텍스트가 없고, 설명은 버튼 hover/focus 툴팁으로 뜬다
  - [ ] `pnpm test`의 `muted-surface-contrast` 게이트 통과 — 푸터가 `bg-muted/50`이라 그 안에 `text-muted-foreground`를 두면 red

### Task 9: 배지·칩

- **변경 대상**: `src/sidepanel/tabs/statusBadges/WebhookSubmittedBadge.tsx`(신규), `SubmittedBadge.tsx`, `PlatformChip.tsx`
- **작업 내용**: `SlackSubmittedBadge`를 본떠 폴링 없이 `onLoaded()`를 즉시 부르는 정적 배지. `PlatformChip` 분기는 **github fallback 앞에** 삽입.
- **검증**:
  - [ ] 이슈 목록에서 webhook 행이 로딩 스피너에 갇히지 않는다
  - [ ] `issueListUtils.isRefreshable()`이 webhook에 `false`(분기 추가 없이 자연 폴백)
  - [ ] 칩이 github 아이콘으로 안 뜬다

### Task 10: i18n

- **변경 대상**: `src/i18n/namespaces/{app,integrations,issue}.ts`
- **작업 내용**: `platform.tab.webhook`(값은 **`Custom Webhook`** — 내부 `PlatformId`는 짧은 `"webhook"`으로 두고 표시 라벨만 길게 간다) + `webhook.*`(라벨·placeholder·에러·경고 + 진입 버튼 툴팁 `webhook.entry.tooltip` — 수신 서버를 직접 준비해야 한다는 걸 한 문장으로) 키를 **등록 로케일 전수** 추가. `src/log-viewer/i18n.ts`와 `public/_locales/`는 이 키를 쓰지 않으므로 건드리지 않는다.
- **검증**:
  - [ ] PostToolUse 훅이 돌리는 `src/i18n/__tests__/locales.test.ts` green(전수 키 대칭·빈 값·placeholder 토큰 일치)
  - [ ] `src/log-viewer/__tests__/i18n.test.ts` green(교집합 키 값 일치 — 교집합이 없으므로 무영향임을 확인)

### Task 11: 계약 문서 + 레퍼런스 수신 서버

- **변경 대상**: `docs/webhook-contract.md`(신규)
- **작업 내용**: multipart 파트 구성, `payload` JSON 스키마, `cid:` 참조 규칙, 권장 응답 `{key,url}`, 테스트 요청의 `X-BugShot-Test: 1`, 타임아웃·크기 상한, 템플릿 변수 화이트리스트 전체. 끝에 **동작하는 최소 수신 서버**(의존성 없는 node `http` 기준 40줄 이내)를 싣는다.
- **검증**:
  - [ ] 문서의 레퍼런스 서버를 그대로 띄워 실제 제출이 2xx로 끝난다
  - [ ] 문서에 적힌 파트 이름이 Task 4의 테스트가 고정한 값과 일치

### Task 12: privacy 갱신

- **변경 대상**: `docs/privacy.ko.md`(원본), `docs/privacy.en.md`(번역)
- **작업 내용**: "3. 외부 전송" 표에 **"사용자가 지정한 서버"** 라는 새 종류를 추가한다. 전송되는 것(리포트 본문·스크린샷·영상·로그·사용자 헤더)과 전송 시점(사용자가 Custom Webhook으로 제출할 때만), BugShot 서버 미경유를 명시. 상단 시행일을 ko/en 함께 갱신.
- **검증**:
  - [ ] ko/en 본문과 시행일이 같은 커밋에서 함께 바뀐다
  - [ ] manifest diff가 0이어도 이 갱신이 들어갔다(30s Replay 심사 탈락 전례)

### Task 13: e2e

- **변경 대상**: `e2e/webhook-submit.spec.ts`(신규)
- **작업 내용**: node `http`로 `127.0.0.1` 목 수신 서버를 띄우고 multipart 제출을 받아 검증. 실패 응답 경로도 별도 케이스로.
- **검증**:
  - [ ] 수신 요청이 multipart이고 `payload` 파트의 JSON이 스키마를 만족
  - [ ] 파일 파트 이름이 본문 `cid:` 참조와 전부 대응
  - [ ] 서버가 `{key,url}`을 주면 이슈 목록 행에 링크가 붙는다
  - [ ] 서버가 500을 주면 제출이 실패하고 draft가 남는다

---

## 테스트 계획

**단위 테스트** (`*.test.ts`, node 환경)
- `webhookUrlPolicy` — Task 2 검증 항목 전수. 사설망 대역 경계값(`172.15.x`/`172.16.x`/`172.31.x`/`172.32.x`) 포함.
- `webhookTemplate` — 이스케이프(따옴표·역슬래시·개행·유니코드), 타입 보존, 화이트리스트 거부, 중첩 구조.
- `webhookPayload` — `cid:` 참조와 `media[].part`의 양방향 대응, 액션 로그 단독 케이스.
- `webhook-api` — 응답 정규화 4종, 에러 직렬화, 타임아웃, 바디 캡.
- `submitToWebhook` — 실패 시 `markSubmitted` 미호출, 두 모드 분기.

**컴포넌트 테스트** (`*.test.tsx`, jsdom)
- `WebhookConnectForm` — 테스트 실패 시 저장 안 됨, 평문 경고, 템플릿 유효성 게이트, 헤더 마스킹.

**e2e 시나리오** (`/e2e-write` 입력)
- 로컬 목 서버를 띄우고 Custom Webhook을 연결하면, 연결 테스트가 2xx를 받아 계정이 저장된다.
- Custom Webhook으로 스크린샷 이슈를 제출하면, 목 서버가 `payload` 1개와 파일 N개로 이뤄진 multipart 요청을 받는다.
- 목 서버가 `{key,url}`을 반환하면, 이슈 목록 행에 그 키와 링크가 표시된다.
- 목 서버가 500을 반환하면, 제출이 실패하고 draft가 목록에 남는다.
- 공인망 `http://` URL을 입력하면, 저장이 거부되고 사유가 표시된다.

**수동 테스트** (자동화 불가)
- [ ] 실제 사설망 호스트(`http://<사내 IP>:port`)로 제출 — 평문 경고 표시와 실제 전송
- [ ] Discord 웹훅 URL + 템플릿 모드로 실제 메시지 도착 확인
- [ ] 30s replay 영상이 포함된 제출에서 바디 크기 경고가 실제 수치로 뜨는지
- [ ] 응답이 느린 서버(30초 초과)에서 타임아웃 토스트 문구

---

## 구현 순서 권장

```
Task 0 (단독 선행 · 잠복 버그)
   ↓
Task 1 (타입 축 — 이후 전부의 전제)
   ↓
Task 2 · Task 3 · Task 4   ← 순수 함수 3개, 서로 독립이라 병렬 가능
   ↓
Task 5 (background) ── Task 6 (어댑터)   ← 5가 6의 전제
   ↓
Task 7 (제출 UI) · Task 8 (연결 UI) · Task 9 (배지)   ← 병렬 가능
   ↓
Task 10 (i18n — 7·8·9가 쓰는 키가 확정된 뒤)
   ↓
Task 11 (계약 문서) · Task 12 (privacy)   ← 병렬 가능
   ↓
Task 13 (e2e — 전체가 동작한 뒤)
```

Task 2·3·4는 `/tdd interface`로 테스트를 먼저 박고 시작한다. Task 0은 이 기능과 무관한 픽스라 별도 커밋으로 분리한다.

## 가이드 영향

사용자 노출 기능이므로 갱신 필요. 작성 전 `guide/AUTHORING.md`를 먼저 읽는다.

- `guide/ko/integrations/platforms.md` · `guide/en/integrations/platforms.md` — 지원 대상 표에 Custom Webhook 추가. 다른 8개와 성격이 달라(사용자가 수신부를 직접 준비) 별도 단락으로 구분하고 `docs/webhook-contract.md`로 링크.
- `guide/ko/integrations/issue-tracking.md` · `guide/en/integrations/issue-tracking.md` — 상태 동기화·제출 필드가 없다는 점을 명시(다른 플랫폼과 동작이 다른 지점).
- `guide/ko/integrations/README.md` · `guide/en/integrations/README.md` — 목록·요약에 반영.
- 화면이 새로 생기므로(`연동 > 플랫폼 추가 > Custom Webhook` 다이얼로그) 구현 후 `/guide-shots`로 스크린샷 촬영 필요.
