# Custom Webhook 전송 — 기술 설계

## 개요

`PlatformId`에 9번째 값 `"webhook"`을 추가하고, 기존 어댑터 슬롯(계정·제출·배지)에 그대로 끼운다. 새 축을 만들지 않는 게 설계의 핵심이다 — 별도 `DeliveryTarget` 축을 세우면 이슈 목록·배지·제출 다이얼로그가 전부 2축이 된다.

전송은 background realm에서 단일 POST로 끝난다. **업로드와 생성이 같은 요청**이라 기존 8개가 가진 "업로드 → URL → 본문 치환 → 생성" 2단 구조가 없다. 그런데 본문 빌더(`buildMarkdownIssueBody`)는 미디어 URL을 전제로 한다 — 이 간극을 **`prepareUpload`의 `UploadFn`을 `cid:` URL을 즉시 돌려주는 순수 함수로 채워서** 메운다. 네트워크를 타지 않는 가짜 업로드다. 그래서 본문 빌더 경로가 github/gitlab과 바이트 단위로 같아지고, 신규 빌더를 만들지 않는다.

## 변경 범위

### 신규 파일

| 파일 | 역할 |
|---|---|
| `src/types/webhook.ts` | `WebhookAccount`·`WebhookAuth`·`WebhookFormat`·`WebhookSubmitPayload`·`WebhookSubmitResult` |
| `src/sidepanel/lib/webhookUrlPolicy.ts` | URL 정규화 + 스킴/사설망 판정(순수). `normalizeWebhookUrl(input)` |
| `src/sidepanel/lib/webhookTemplate.ts` | 템플릿 파싱·변수 화이트리스트·치환(순수). `parseWebhookTemplate` / `renderWebhookTemplate` |
| `src/sidepanel/lib/webhookPayload.ts` | `MarkdownContext` + 캡처 파일 → `WebhookSubmitPayload`(순수) |
| `src/sidepanel/lib/submitToWebhook.ts` | 제출 오케스트레이션(기존 `submitToXxx.ts` 8벌과 같은 위상) |
| `src/background/webhook-api.ts` | 실제 `fetch`. multipart 조립·JSON 전송·응답 정규화·타임아웃 |
| `src/sidepanel/tabs/connect/WebhookConnectForm.tsx` | `WebhookConnectedBody`(내 연동 Section 본문) + `WebhookConnectEntry`(푸터 진입 버튼 + 다이얼로그) |
| `src/sidepanel/tabs/statusBadges/WebhookSubmittedBadge.tsx` | 상태 폴링 없는 정적 배지(`SlackSubmittedBadge` 복제) |
| `docs/webhook-contract.md` | 수신 서버가 읽을 계약 + 레퍼런스 스니펫 |

### 기존 파일 — 컴파일러가 강제하는 5곳

전부 `satisfies Record<PlatformId, …>`라 `PlatformId`에 `"webhook"`을 넣는 순간 빨개진다. 빠뜨릴 수 없다.

| 파일:라인 | 채울 것 |
|---|---|
| `src/types/platform.ts:29` `PLATFORM_TAB_KEYS` | `webhook: "platform.tab.webhook"` |
| `src/background/oauth/config.ts:129` `OAUTH_CONFIG` | **채우지 않는다** — 아래 "OAuth 축 분리" 참조 |
| `src/background/platformErrors.ts:28` `PLATFORM_ERROR_CTORS` | `webhook: WebhookError` |
| `src/store/settings-store.ts:319` `PLATFORM_FALLBACK_RANK` | `webhook: 8` |
| `src/background/bgRequestTypes.ts` `BG_REQUEST_TYPE_MAP` | `"webhook.submit"`, `"webhook.test"` |

#### OAuth 축 분리

`OAUTH_CONFIG`는 현재 8개 전부 OAuth를 갖는다는 전제 위에 서 있다. webhook은 OAuth가 **원리적으로** 없다. 두 선택지 중:

- (기각) `clientId: ""` 스텁을 넣어 `isConfigured()`가 항상 `false`를 반환하게 한다 — 컴파일은 통과하지만 "설정만 하면 OAuth가 되는 플랫폼"이라는 거짓말이 타입에 남고, `notConfiguredClientKey`에 존재하지 않는 i18n 키를 넣어야 한다.
- (채택) `export type OAuthPlatformId = Exclude<PlatformId, "webhook">`를 신설하고 `OAUTH_CONFIG`를 `satisfies Record<OAuthPlatformId, OAuthPlatformConfig>`로 바꾼다. `oauth.start` 계열 `BgRequest`의 `platform` 필드도 같은 타입으로 좁힌다.

채택안은 "OAuth 없는 전송 대상"을 타입 레벨에 정식으로 들인다. 기존 8개에 대한 컴파일 강제는 그대로 유지된다(`Exclude`가 8개를 여전히 전수 요구). `src/background/__tests__/connect-reason-coverage.test.ts`는 파일명 배열(`OAUTH_FILES`)을 직접 들고 있어 8개 그대로이고 **수정이 필요 없다**.

### 기존 파일 — 분기 추가

| 파일:라인 | 변경 |
|---|---|
| `src/types/platform.ts:10-18` | `PlatformId`에 `"webhook"` |
| `src/types/platform.ts:50-58` `Accounts` | `webhook?: WebhookAccount` |
| `src/types/platform.ts:157-166` `LastSubmitFieldsByPlatform` | `webhook?: never` — 제출 필드가 없으므로 `setLastSubmitFields("webhook", …)` 자체를 타입으로 막는다 |
| `src/types/messages.ts` `BgRequest` | `webhook.submit` / `webhook.test` 두 항목 |
| `src/background/messages.ts` `handleMessage` switch | `case` 2개 (`default`의 `never` 체크가 누락을 강제) |
| `src/store/settings-store.ts` | `updateWebhookAccount` 액션(기존 7벌과 동일 시그니처), `SETTINGS_STORE_VERSION` → 12 |
| `src/sidepanel/lib/prepareUpload.ts:76` | `opts.platform`을 `"github" \| "gitlab" \| "webhook"`으로 확장 |
| `src/sidepanel/lib/buildMarkdownIssueBody.ts:33` | `opts.platform` 동일 확장 |
| `src/sidepanel/lib/submitAdapters.ts` | `webhookSubmitArgs()` 추가(`lastSubmitFields` 쌍은 없음) |
| `src/sidepanel/lib/attachmentLimits.ts:11` | `webhook: null`(단건 한도 없음 — 총량 캡은 바디 크기로 따로 본다) |
| `src/sidepanel/tabs/SubmitFieldsDialog.tsx:101-110` | `TABS_GRID_COLS`에 `9: "grid-cols-9"` — **9번째가 붙는 순간 `grid-cols-2`로 폴백하는 잠복 버그** |
| `src/sidepanel/tabs/SubmitFieldsDialog.tsx:112-126` | `PLATFORM_TABS`에 lucide `Webhook` 아이콘 항목 |
| `src/sidepanel/tabs/SubmitFieldsDialog.tsx:181-213` | `platformConfigured`(계정 존재) / `fieldsReady`(항상 `true`) 두 exhaustive switch |
| `src/sidepanel/tabs/SubmitFieldsDialog.tsx:258-267` | `ccCount`에 `webhook: undefined` |
| `src/sidepanel/tabs/SubmitFieldsDialog.tsx:327-361` | 필드 폼 삼항 체인 — webhook은 폼 없이 `null`. **마지막 notion fallback 앞에** 삽입 |
| `src/sidepanel/tabs/IssueCreateModal.tsx` | `handleWebhookSubmit` + `handleSubmit` 분기 |
| `src/sidepanel/tabs/DraftDetailDialog.tsx` | 동일 + **`clearPicker`/`reset` 블록**(이 경로에만 있는 처리) |
| `src/sidepanel/tabs/IntegrationsTab.tsx:56-66` | `PLATFORMS`에 항목 추가(내 연동 목록·아이콘·`ConnectedBody`용) |
| `src/sidepanel/tabs/IntegrationsTab.tsx:166-195` `add` 서브탭 | 브랜드 그리드 매핑에서 `webhook`을 **제외**하고, `PageShell` 아래 `PageFooter`를 신설해 진입 버튼을 둔다 |
| `src/sidepanel/tabs/statusBadges/SubmittedBadge.tsx` | `if (platform === "webhook")` 분기 |
| `src/sidepanel/tabs/statusBadges/PlatformChip.tsx` | 분기 추가 — **마지막 github fallback 앞에** |
| `src/i18n/namespaces/{app,integrations,issue}.ts` | `platform.tab.webhook`, `webhook.*` 키를 **등록 로케일 전수** |

**손대지 않는 것**: `src/sidepanel/hooks/usePlatformFields.ts`(제출 필드 없음), `src/sidepanel/tabs/issueListUtils.ts:10-30`(분기를 안 넣으면 `return false`로 떨어져 새로고침 후보에서 자동 제외 — Slack과 같다), `src/log-viewer/i18n.ts`(webhook 키를 안 씀), `public/_locales/`(manifest 문자열 불변).

## 데이터 흐름

```
[사이드패널]
 buildCaptureFiles()  →  images / video / logs.html / attachments   (dataUrl)
 MarkdownContext      →  title, sections, env, logSummary
        │
        ├─ multipart 모드
        │    prepareUpload(input, cidUploadFn, { platform: "webhook" })
        │      └ cidUploadFn: 네트워크 0. filename → { href: `cid:${filename}` } 즉시 반환
        │    buildMarkdownIssueBody(...)  →  body 안 미디어가 cid:로 참조됨
        │    webhookPayload()             →  { title, body, environment[], logSummary, media[] }
        │    sendBg({ type: "webhook.submit", mode: "multipart", payload, files })
        │
        └─ json 모드
             renderWebhookTemplate(template, vars)  →  임의 JSON 값
             sendBg({ type: "webhook.submit", mode: "json", body })

[background · webhook-api.ts]
 multipart:  FormData
               payload         ← JSON.stringify(payload)
               screenshot-1.webp ← dataUrlToBlob(...)   (@/store/blob-db)
               replay.mp4 / logs.html / <attachments>
             Content-Type 미지정 → fetch가 boundary 부착 (기존 7곳 관용구)
 json:       Content-Type: application/json + 사용자 헤더

 fetch(url, { signal: AbortSignal.timeout(30_000), headers })
   !res.ok            → throw WebhookError(status, readErrorBody(res))
   res.ok             → normalizeWebhookResult(await res.json().catch(() => null))

[사이드패널]
 { key, url } → markSubmitted → setLastSubmittedPlatform("webhook")
```

`markSubmitted`가 원본을 비가역 파괴하는 시점은 POST가 2xx로 끝난 **뒤**다. 두 모드 모두 단일 요청이라 부분 성공이 없고, 따라서 `requireMediaUpload` 가드가 필요 없다(`docs/POSTMORTEM.md` 2026-06-30 분류의 (d) atomic 군 — Jira와 같다). 이 판정을 `submitToWebhook.ts`의 `markSubmitted` 인근 주석에 박는다. 같은 회고의 재발방지 (3)이 요구하는 절차다.

## 인터페이스 설계

```ts
// src/types/webhook.ts
export type WebhookFormat = "multipart" | "json";

export interface WebhookAuth {
  url: string;                          // normalizeWebhookUrl를 통과한 값만
  headers: { name: string; value: string }[];
  format: WebhookFormat;
  template?: string;                    // format === "json"일 때만 의미가 있다
}

export interface WebhookAccount extends PlatformAccountBase<"webhook"> {
  auth: WebhookAuth;
}

export interface WebhookMediaEntry {
  part: string;            // multipart 파트 이름 == 본문 cid: 참조 대상
  filename: string;        // 사용자에게 보이는 이름(첨부는 원본명)
  contentType: string;
  kind: "image" | "video" | "logs" | "attachment" | "inline";
}

export interface WebhookSubmitPayload {
  title: string;
  body: string;                                    // 마크다운. 미디어는 cid:로 참조
  environment: { label: string; value: string }[];
  logSummary?: string;
  media: WebhookMediaEntry[];
  bugshot: { version: string; sentAt: number };
}

export interface WebhookSubmitResult {
  key?: string;
  url?: string;
}
```

```ts
// src/sidepanel/lib/webhookUrlPolicy.ts
export type WebhookUrlRejection = "invalid" | "scheme" | "insecure-public";

export interface WebhookUrlVerdict {
  url: string;          // 정규화 결과. path·query는 보존한다(GitLab 정규화와 다른 점)
  plaintext: boolean;   // true면 UI가 평문 경고 배지를 띄운다
}

export class WebhookUrlError extends Error {
  constructor(readonly reason: WebhookUrlRejection) { super(reason); }
}

// https → 무조건 통과. http → loopback·사설망(10/8, 172.16/12, 192.168/16,
// 169.254/16, ::1, *.local, *.internal, 점 없는 단일 호스트명)만 통과.
// 그 외 http는 WebhookUrlError("insecure-public").
export function normalizeWebhookUrl(input: string): WebhookUrlVerdict;
```

```ts
// src/sidepanel/lib/webhookTemplate.ts
export interface WebhookTemplateVars {
  title: string;
  body: string;
  url: string;
  env: { os?: string; browser?: string; viewport?: string; selector?: string };
  capturedAt?: string;
  logSummary?: string;
  sections: Record<string, string>;
  media: {
    count: number;
    items: { filename: string; contentType: string; dataUri?: string }[];
  };
}

export type TemplateIssue =
  | { kind: "invalid-json"; message: string }
  | { kind: "unknown-var"; name: string };

// 저장 시점 게이트. JSON.parse 실패 또는 화이트리스트 밖 변수면 issues를 채워 돌려준다.
export function parseWebhookTemplate(src: string): { ok: boolean; issues: TemplateIssue[] };

// 치환. **JSON.parse를 먼저 하고 문자열 리프 안에서만 치환한다** — 문자열 단계에서
// 치환하면 본문의 따옴표·개행 하나에 JSON이 부서진다.
// 리프 전체가 정확히 하나의 placeholder면 타입을 보존한다({{media.count}} → number).
export function renderWebhookTemplate(src: string, vars: WebhookTemplateVars): unknown;
```

```ts
// src/background/webhook-api.ts
export class WebhookError extends Error {
  constructor(readonly status: number, message: string, readonly body?: unknown) { super(message); }
}

export const WEBHOOK_TIMEOUT_MS = 30_000;
export const WEBHOOK_TEST_TIMEOUT_MS = 8_000;
export const WEBHOOK_BODY_WARN_BYTES = 8 * 1024 * 1024;
export const WEBHOOK_BODY_MAX_BYTES = 25 * 1024 * 1024;

// 응답에서 key/url을 best-effort로 뽑는다. key 후보: key, id, number, iid.
// url 후보: url, html_url, web_url, link. 없으면 빈 객체 → 호출부가 로컬 key로 강등.
export function normalizeWebhookResult(body: unknown): WebhookSubmitResult;
```

## 기존 패턴 준수

- **`sidepanel` 디렉터리 안에서는 `@/` 유지**(지역 관례, CLAUDE.md 코드 컨벤션). 신규 `src/sidepanel/lib/*`도 기존 이웃과 같은 표기를 쓴다.
- **store는 `sidepanel/tabs`를 import하지 않는다.** webhook 관련 순수 로직은 전부 `sidepanel/lib/`에 둔다. `store/__tests__/bundleBoundary.test.ts`의 `ALLOWED` 화이트리스트를 건드릴 일이 없도록, store가 `webhook*.ts`를 참조하지 않게 설계했다.
- **사이드패널은 `@/background/*`를 value import하지 않는다.** `WebhookError`는 background 전용이고, 사이드패널은 `platformErrors` 직렬화 결과(`{status, body}`)만 본다.
- **multipart 조립은 기존 7곳 관용구 그대로**: `new FormData()` + `form.append(part, blob, filename)`, `Content-Type`을 **세팅하지 않아** `fetch`가 boundary를 붙이게 둔다. dataUrl → Blob은 `@/store/blob-db`의 공용 `dataUrlToBlob`을 재사용한다(Notion의 로컬 변형을 복제하지 않는다).
- **에러는 throw, 직렬화는 `index.ts`에 위임.** `WebhookError`를 `PLATFORM_ERROR_CTORS`에 등록하면 `src/background/index.ts:191`의 catch 체인이 `{status, body}`를 자동으로 응답에 싣는다. 핸들러가 try/catch하지 않는다.
- **본문 언어(`bodyLocale`)**: 본문을 사이드패널에서 완결해 보내므로 background 재래핑이 **불필요**하다(Jira·Notion만 예외적으로 필요한 구조). `bodyLocaleBackground.test.ts`의 화이트리스트를 건드리지 않는다.
- **analytics**: `trackSubmit`에 `platform: "webhook"`만 실린다. `ALLOWED_EVENTS.issue_submitted`(`src/background/analytics.ts:34-43`)는 **건드리지 않는다** — 엔드포인트 host를 화이트리스트에 올리지 않는 것이 이 기능의 불변식이다.
- **연결 테스트 버튼**은 8개 폼 공통 관용구(`validating` state, `disabled` + `aria-disabled` 분리, `opacity-0` 텍스트 + 절대 위치 `Loader2`, 성공 시에만 `setAccount`)를 따른다. 다이얼로그 하단은 기존 7개와 같은 `DialogFooter className="flex-row justify-end"`다 — 여기에 `PageFooter`를 끌어오지 않는다.
- **진입 버튼의 설명은 툴팁으로 단다.** `TooltipProvider delayDuration={0}` > `Tooltip` > `TooltipTrigger asChild` > `Button` > `TooltipContent` 관용구를 그대로 쓴다(`IssueTab.tsx:368-389`가 선례). 푸터에는 버튼 외의 텍스트를 넣지 않는다.
- **진입 버튼만 `PageFooter` 패턴이다.** `add` 서브탭에 `<PageFooter><div className="flex justify-end">…</div></PageFooter>`를 신설한다 — `connected` 서브탭의 `DisconnectAllButton` 배치(`IntegrationsTab.tsx:152-160`)와 문자 그대로 같은 구조다. `PageFooter`는 `@/sidepanel/components/Section`에서 **그대로 import한다**(클래스 문자열을 복제하지 않는다 — `복제본` 계열은 회고 반복 함정 3위다).
- **브랜드 그리드에서 뺀다.** `add` 서브탭의 2열 그리드는 `orderAddPlatforms(PLATFORMS.map(p => p.id), …)`를 그대로 도는데, `webhook`이 거기 남아 있으면 로고 자리에 lucide 아이콘이 섞여 들어간다. 그리드 매핑에서 제외하고 푸터로 내린다. **`PLATFORMS` 배열 자체에서 빼면 안 된다** — 내 연동 목록의 Section 렌더가 그 배열을 찾아 쓴다(`IntegrationsTab.tsx:129-131`의 `PLATFORMS.find(...)!`가 `undefined`로 터진다).

## 대안 검토

**1. base64 미디어를 단일 JSON 바디에 싣는다 (기각).** 계약이 한 종류로 끝나고 수신 구현이 가장 쉽다. 그러나 30s replay MP4 + 첨부 합계 50MB(`MAX_TOTAL_ATTACHMENT_SIZE`)가 base64로 1.33배 부풀어 서비스워커 메모리와 서버 바디 캡을 동시에 때린다. multipart는 이미 저장소에 선례가 7곳이라 새 위험도 아니다.

**2. 2단 계약 — `POST /upload` 후 `POST /issue` (기각).** 기존 8개 어댑터의 모양과 가장 닮았고 본문 치환도 자연스럽다. 그러나 수신 서버가 구현할 엔드포인트가 2개로 늘고, 첫 요청만 성공한 부분 실패 상태가 생겨 atomic 성질(=승격 가드 불필요)을 잃는다. 채택안은 이 둘을 동시에 피한다.

**3. `DeliveryTarget`이라는 별도 축 신설 (기각).** "webhook은 이슈 트래커가 아니다"는 개념적으로 맞다. 그러나 이슈 목록·배지·제출 다이얼로그·설정이 전부 2축으로 갈라지고, Slack이 이미 트래커가 아니면서 `PlatformId`에 들어와 있다는 선례가 있다. 개념적 순수함의 대가가 UI 전반의 분기 증식이다.

**4. 템플릿을 문자열 치환 후 `JSON.parse` (기각).** 구현이 10줄로 끝난다. 그러나 본문에 따옴표·역슬래시·개행이 하나만 있어도 JSON이 부서지고, 그 실패가 **사용자 본문 내용에 의존**해 재현이 불규칙해진다. parse-먼저-치환-나중이 유일하게 옳은 순서다.

**5. 엔드포인트 N개 등록 (이번 스코프 밖).** `Accounts`의 플랫폼당 1계정 전제를 깨야 하고, 제출 다이얼로그에 "어느 엔드포인트로" 선택 필드가 생기며, 그 순간 `LastSubmitFieldsByPlatform`에 `webhook`이 필요해지고 "제출 목적지 필드는 last 우선"(POSTMORTEM 2026-06-30) 규칙까지 따라붙는다. 수요가 확인되면 그때 연다.

## 위험 요소

- **`TABS_GRID_COLS` 잠복 버그.** 8까지만 정의돼 있어 9번째 탭이 붙는 순간 `undefined` → `grid-cols-2` 폴백으로 제출 다이얼로그 탭 줄이 무너진다. 이 기능이 **처음 드러내는** 버그라 webhook 탓으로 오인하기 쉽다. 먼저 고치고 시작한다.
- **삼항 체인의 fallback 위치.** `SubmitFieldsDialog`의 폼 렌더는 마지막이 notion으로, `PlatformChip`은 마지막이 github로 떨어지는 구조다. 새 분기를 **뒤에** 붙이면 아무 에러 없이 엉뚱한 렌더가 된다.
- **타임아웃 선례가 저장소에 없다.** 플랫폼 fetch 전부 무제한이고 `AbortSignal`은 `css.fetchSheets` 한 곳뿐이다. 상대가 임의 사용자 서버라 응답하지 않는 경우가 실재하므로 이 기능만 타임아웃을 갖는다 — 일관성 위반으로 보이지 않게 상수에 이유를 주석으로 박는다.
- **`readErrorBody`에 크기 제한이 없다.** 신뢰된 벤더 API 전용으로 설계된 함수인데, webhook은 임의 서버가 상대다. 거대한 에러 본문이 그대로 버퍼링될 수 있으므로 **webhook 경로에서만 캡을 씌운 래퍼**를 쓴다(`messages.ts`의 `readCappedSheetText`가 선례).
- **평문 판정의 사설망 목록.** `isCredentialSafeUrl`(https 또는 loopback만)을 그대로 쓸 수 없어 판정을 새로 쓴다. IPv6 사설 대역·`*.local`·점 없는 단일 호스트명까지 포함해야 실사용을 덮는데, 이 목록은 틀리기 쉬우므로 순수 함수로 떼어 유닛으로 전수 고정한다.
- **URL 정규화를 GitLab에서 복제하면 안 된다.** `normalizeInstanceUrl`(`src/sidepanel/tabs/connect/gitlabInstanceUrl.ts:35`)은 `${protocol}//${host}`만 남기고 **path를 버린다**. 웹훅은 path가 본질이라(`/intake`, Discord의 긴 경로) 그대로 쓰면 전송이 조용히 루트로 간다.
- **템플릿 모드의 `{{media.*.dataUri}}`.** 사용자가 옵트인으로 켜는 순간 바디가 폭증한다. 치환 직후 바이트를 재서 경고(8MB)·차단(25MB)하는 게 유일한 방어선이다. 영상은 `dataUri` 변수를 아예 제공하지 않는다.
- **헤더 값이 시크릿이다.** `Authorization`이 `chrome.storage.local`에 평문으로 남는 건 기존 PAT과 같은 취급이지만, **연결 폼의 값 표시를 마스킹**하고 에러 메시지 조립에 헤더를 절대 넣지 않는다. 저장소에 명시적 마스킹 장치는 없고 "애초에 안 넣는" 관행뿐이라 리뷰에서 봐야 한다.
- **푸터엔 버튼만 둔다 — 설명은 툴팁이다.** `PageFooter`가 `bg-muted/50`이라 그 위에 보조 텍스트를 얹으면 `text-muted-foreground`가 `styles/__tests__/muted-surface-contrast.test.ts`에 걸린다(라이트 4.34:1, WCAG AA 미달). 문구를 옅은 `--foreground`로 바꿔 통과시키는 대신 **문구 자체를 툴팁으로 내린다** — 400px 패널에서 푸터 한 줄을 설명이 먹는 것도 손해다. 그래서 이 대비 함정은 회피가 아니라 구조적으로 발생하지 않는다.
- **`prepareUpload`의 가짜 `UploadFn`.** 네트워크를 타지 않고 `cid:`를 즉시 돌려주는 함수라, `someUploadMissing`이 항상 `false`가 된다. 의도된 결과지만 "업로드 실패 감지가 죽었다"로 오독될 수 있어 주석이 필요하다.
