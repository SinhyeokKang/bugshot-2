# Custom Webhook 전송 — 기술 설계

## 개요

`PlatformId`에 9번째 값 `"webhook"`을 추가하고, 기존 어댑터 슬롯(계정·제출·배지)에 그대로 끼운다. 새 축을 만들지 않는 게 설계의 핵심이다 — 별도 `DeliveryTarget` 축을 세우면 이슈 목록·배지·제출 다이얼로그가 전부 2축이 된다.

전송은 background realm에서 단일 POST로 끝난다. 성공 판정은 모드별로 갈린다 — **multipart는 `{key,url}` 응답이 계약이라 없으면 실패**, **json은 2xx만으로 성공이고 응답을 읽지 않는다**(Discord처럼 `204 No Content`가 정상인 제3자 훅이 상대라서다). 그래서 json 모드는 이슈 목록 행을 만들지 않는다. **업로드와 생성이 같은 요청**이라 기존 8개가 가진 "업로드 → URL → 본문 치환 → 생성" 2단 구조가 없다. 그런데 본문 빌더(`buildMarkdownIssueBody`)는 미디어 URL을 전제로 한다 — 이 간극을 **`prepareUpload`의 `UploadFn`을 `cid:` URL을 즉시 돌려주는 순수 함수로 채워서** 메운다. 네트워크를 타지 않는 가짜 업로드다. 그래서 본문 빌더 경로가 github/gitlab과 바이트 단위로 같아지고, 신규 빌더를 만들지 않는다.

## 변경 범위

### 신규 파일

| 파일 | 역할 |
|---|---|
| `src/types/webhook.ts` | `WebhookAccount`·`WebhookAuth`·`WebhookFormat`·`WebhookSubmitPayload`·`WebhookSubmitResult` |
| `src/sidepanel/lib/webhookUrlPolicy.ts` | URL 정규화 + 스킴/사설망 판정(순수). `normalizeWebhookUrl(input)` |
| `src/sidepanel/lib/webhookHeaderPolicy.ts` | forbidden header name 판정(순수). `isSettableHeaderName(name)` |
| `src/sidepanel/lib/webhookTemplate.ts` | 템플릿 파싱·변수 화이트리스트·치환(순수). `parseWebhookTemplate` / `renderWebhookTemplate` |
| `src/sidepanel/lib/webhookPayload.ts` | `MarkdownContext` + 캡처 파일 → `WebhookSubmitPayload`(순수) |
| `src/sidepanel/lib/submitToWebhook.ts` | 제출 오케스트레이션(기존 `submitToXxx.ts` 8벌과 같은 위상) |
| `src/background/webhook-api.ts` | 실제 `fetch`. multipart 조립·JSON 전송·응답 정규화·타임아웃 |
| `src/sidepanel/tabs/connect/WebhookConnectForm.tsx` | `WebhookConnectedBody`(내 연동 Section 본문) + `WebhookConnectEntry`(진입 버튼 + 다이얼로그) |
| `src/sidepanel/tabs/statusBadges/WebhookSubmittedBadge.tsx` | 상태 폴링 없는 정적 배지(`SlackSubmittedBadge` 복제) |
| `docs/webhook-contract.md` | 수신 서버가 읽을 계약 + 레퍼런스 스니펫 |

### 기존 파일 — 컴파일러가 강제하는 5곳

앞 4곳은 `PlatformId` 키 맵이라 `"webhook"`을 넣는 순간 빨개진다. **`BG_REQUEST_TYPE_MAP`은 성격이 다르다** — `Record<BgRequest["type"], true>`(애노테이션, `satisfies` 아님)라 `PlatformId`와 무관하고 `types/messages.ts`의 `BgRequest`에 항목을 먼저 추가해야 비로소 강제된다. 강제 트리거가 다른 걸 한 표에 섞지 않는다.

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

채택안은 "OAuth 없는 전송 대상"을 타입 레벨에 정식으로 들인다. 기존 8개에 대한 컴파일 강제는 그대로 유지된다(`Exclude`가 8개를 여전히 전수 요구). `src/background/__tests__/connect-reason-coverage.test.ts`의 `OAUTH_FILES`는 하드코딩 배열이 **아니라** `readdirSync(BG).filter(f => f.endsWith("-oauth.ts"))` glob이다(`:12-16` — 소스 주석이 "하드코딩하면 9번째 플랫폼 파일이 스캔을 빠져나간다"고 적어놨다). webhook은 `*-oauth.ts` 파일을 만들지 않아 glob에 안 걸리므로 8개 그대로이고 **수정이 필요 없다** — 결론은 같지만 근거가 다르다. 반면 같은 파일의 `GRANT_LANE_FILES`·`TAGGING_PLATFORMS`와 `src/background/oauth/__tests__/config.test.ts:127`의 `needsProxy` 단언은 하드코딩이라, webhook에 OAuth 파일을 만드는 순간 red 3개가 동시에 뜬다(지금은 안 만드니 무관).

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
| `src/sidepanel/tabs/SubmitFieldsDialog.tsx:101-110` | **9개 이상이면 `TabsList`를 가로 스크롤(`overflow-x-auto`)로 전환**. `9: "grid-cols-9"`를 넣는 것만으로는 안 된다 — 아래 "9열 탭은 물리적으로 안 들어간다" 참조 |
| `src/sidepanel/tabs/SubmitFieldsDialog.tsx:112-126` | `PLATFORM_TABS`에 lucide `Webhook` 아이콘 항목 |
| `src/sidepanel/tabs/SubmitFieldsDialog.tsx:181-213` | `platformConfigured`(계정 존재) / `fieldsReady`(항상 `true`) 두 exhaustive switch |
| `src/sidepanel/tabs/SubmitFieldsDialog.tsx:258-267` | `ccCount`에 `webhook: undefined` |
| `src/sidepanel/tabs/SubmitFieldsDialog.tsx:327-361` | 필드 폼 삼항 체인 — webhook은 폼 없이 `null`. **마지막 notion fallback 앞에** 삽입 |
| `src/sidepanel/tabs/IssueCreateModal.tsx` | `handleWebhookSubmit` + `handleSubmit` 분기 |
| `src/sidepanel/tabs/DraftDetailDialog.tsx` | 동일 + **`clearPicker`/`reset` 블록**(이 경로에만 있는 처리) |
| `src/sidepanel/tabs/IntegrationsTab.tsx:48-54` `PlatformEntry` | `ConnectFlow`를 **optional로 바꾸고** 그리드 매핑을 `filter(p => p.ConnectFlow)`로 좁힌다 — 아래 "그리드 제외" 참조 |
| `src/sidepanel/tabs/IntegrationsTab.tsx:56-66` | `PLATFORMS`에 항목 추가(내 연동 목록·아이콘·`ConnectedBody`용) |
| `src/sidepanel/tabs/IntegrationsTab.tsx:167-196` `add` 서브탭 | 브랜드 그리드 매핑에서 `webhook`을 **제외**하고, **중앙 덩어리 안** 그리드 바로 아래에 구분선 + 진입 버튼을 둔다(`PageFooter`를 쓰지 않는다) |
| `src/lib/bg-client.ts:61-74` `getOAuthErrorPlatform` | 8리터럴 `\|\|` 체인에 webhook 추가. 빠뜨리면 `null` → `App.tsx:156`의 `?? "jira"` 폴백으로 **Jira 재연결 다이얼로그**가 뜬다(`bg-client.test.ts:209`가 `PLATFORM_TAB_KEYS` 파생 로스터라 red로 잡는다 — 저장소에서 유일) |
| `src/store/settings-store.ts:266-286` `migrate` | `if (version < 12)` 단계를 `isV3Shape` 게이트 **뒤에** 배선. **상수만 12로 올리고 이 줄을 빼도 레포 전체에서 red가 0건**이다 |
| `src/i18n/__tests__/proper-nouns.test.ts:19-24` | `PROPER_NOUNS`에 `"Webhook"` 등재 — 안 하면 ko/en 외 로케일에서 번역돼 사라져도 영구 무음 |
| `src/sidepanel/tabs/statusBadges/SubmittedBadge.tsx` | `if (platform === "webhook")` 분기 |
| `src/sidepanel/tabs/statusBadges/PlatformChip.tsx` | 분기 추가 — **마지막 github fallback 앞에** |
| `src/sidepanel/tabs/issueListUtils.ts:124` `promotableTargets` | **분기 추가 없음** — `filter(p => p !== "slack")`이라 webhook이 자동 포함되고 그게 의도다(PRD 엣지 케이스). 무음 동작이므로 회귀 테스트로 고정한다 |
| `src/i18n/namespaces/{app,integrations,issue}.ts` | `platform.tab.webhook`, `webhook.*` 키를 **등록 로케일 전수** |

**손대지 않는 것**: `src/sidepanel/tabs/IssueRow.tsx:37`(`isSubmitted = status === "submitted" && !!url`. multipart는 `{key,url}`이 계약이라 항상 url이 있고 json은 애초에 행을 안 만든다 — **계약을 느슨하게 바꾸는 순간 이 줄이 webhook 행을 "Draft" 라벨 + [초안 삭제] 버튼 + 빈 상세 다이얼로그로 렌더하므로** 그때는 함께 열어야 한다), `src/sidepanel/hooks/usePlatformFields.ts`(제출 필드 없음), `src/sidepanel/tabs/issueListUtils.ts:10-30`(분기를 안 넣으면 `return false`로 떨어져 새로고침 후보에서 자동 제외 — Slack과 같다), `src/log-viewer/i18n.ts`(webhook 키를 안 씀), `public/_locales/`(manifest 문자열 불변).

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
 헤더 조립:  사용자 헤더 → isSettableHeaderName 통과분만
             multipart 모드는 여기서 Content-Type을 **명시적으로 제거**한다
 multipart:  FormData
               payload         ← JSON.stringify(payload)   (bugshot.idempotencyKey 포함)
               screenshot-1.webp ← dataUrlToBlob(...)   (@/store/blob-db)
               replay.mp4 / logs.html / <attachments>
             파일별 변환 직후 원본 dataUrl 슬롯을 null화 (합본이라 GC가 안 걷어간다)
             누적 바이트 > WEBHOOK_BODY_MAX_BYTES → fetch 전에 중단
             Content-Type 미지정 → fetch가 boundary 부착 (기존 7곳 관용구)
 json:       Content-Type: application/json + 사용자 헤더

 fetch(url, {
   signal: AbortSignal.timeout(30_000),
   headers,
   redirect: "manual",      // 302를 따라가면 사용자 Authorization이 그 호스트로 샌다
   credentials: "omit",     // 임의 서버에 브라우저 쿠키를 붙이지 않는다
 })
   redirected/opaqueredirect → throw WebhookError("redirect")  (ai-provider.ts:495의 throwIfRedirected 상당물)
   !res.ok                   → throw WebhookError(status, readCappedErrorBody(res))
   res.ok && mode === "json" → 성공. 응답을 읽지 않는다 (204가 정상)
   res.ok && multipart       → normalizeWebhookResult(...) — {key,url} 없으면 throw WebhookError("contract")

[사이드패널]
 multipart: { key, url } → markSubmitted → setLastSubmittedPlatform("webhook")
 json:      전송 성공 토스트. 이슈 목록 행을 만들지 않는다
```

`markSubmitted`가 원본을 비가역 파괴하는 시점은 POST가 2xx로 끝나고 **계약(`{key,url}`)까지 확인된 뒤**다. 두 모드 모두 단일 요청이라 부분 성공이 없고, 따라서 `requireMediaUpload` 가드가 필요 없다(`docs/POSTMORTEM.md` 2026-06-30 분류의 (d) atomic 군 — Jira와 같다). 이 판정을 `submitToWebhook.ts`의 `markSubmitted` 인근 주석에 박는다. 같은 회고의 재발방지 (3)이 요구하는 절차다.

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
  // idempotencyKey: 타임아웃/SW 종료 후 재시도가 중복 리포트를 만들지 않게 하는 계약.
  // 같은 draft의 재전송은 같은 키를 쓴다 — 수신 서버가 이걸로 dedup한다.
  bugshot: { version: string; sentAt: number; idempotencyKey: string };
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
// src/sidepanel/lib/webhookHeaderPolicy.ts
// 브라우저가 설정을 거부하는 요청 헤더는 fetch가 **조용히 드롭**한다(문법 오류만 throw).
// declarativeNetRequest 권한이 없어 우회 수단도 없으므로 저장 시점에 막는 게 유일한 방어다.
// Host·Cookie·Content-Length·Origin·Connection·Referer·Date·Via·Proxy-*·Sec-* 등.
export function isSettableHeaderName(name: string): boolean;
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
// url 후보: url, html_url, web_url, link.
// **multipart 모드에서 둘 중 하나라도 없으면 계약 위반 → WebhookError("contract")**.
// json 모드는 애초에 이 함수를 호출하지 않는다(2xx만으로 성공).
export function normalizeWebhookResult(body: unknown): WebhookSubmitResult;

// readErrorBody(@/background/lib/readErrorBody)는 무제한 res.text()라 임의 서버 상대로
// 쓸 수 없다. messages.ts:771의 readCappedSheetText와 같은 스트리밍 캡 래퍼를 둔다.
export function readCappedErrorBody(res: Response, maxBytes: number): Promise<string | null>;
```

## 기존 패턴 준수

- **`sidepanel` 디렉터리 안에서는 `@/` 유지**(지역 관례, CLAUDE.md 코드 컨벤션). 신규 `src/sidepanel/lib/*`도 기존 이웃과 같은 표기를 쓴다.
- **store는 `sidepanel/tabs`를 import하지 않는다.** webhook 관련 순수 로직은 전부 `sidepanel/lib/`에 둔다. `store/__tests__/bundleBoundary.test.ts`의 `ALLOWED` 화이트리스트를 건드릴 일이 없도록, store가 `webhook*.ts`를 참조하지 않게 설계했다.
- **사이드패널은 `@/background/*`를 value import하지 않는다.** `WebhookError`는 background 전용이고, 사이드패널은 `platformErrors` 직렬화 결과(`{status, body}`)만 본다.
- **multipart 조립은 기존 7곳 관용구 그대로**: `new FormData()` + `form.append(part, blob, filename)`, `Content-Type`을 **세팅하지 않아** `fetch`가 boundary를 붙이게 둔다. dataUrl → Blob은 `@/store/blob-db`의 공용 `dataUrlToBlob`(`blob-db.ts:732`, `Blob` 단독 반환 — `contentType`이 필요하면 `blob.type`을 본다)을 재사용한다. `notion-api.ts:294`에도 동명 함수가 있지만 반환이 `{blob, contentType}`으로 달라 **복제하지 않는다**(둘 다 export돼 있어 잘못 고르기 쉽다).
- **multipart 모드에서 사용자 `Content-Type` 헤더를 제거한다.** `Content-Type`은 forbidden header가 아니라 그대로 실리는데, 사용자가 `application/json`을 넣어두면 boundary 없는 multipart가 나가고 **수신 서버 파싱 실패가 무음**이 된다. json 모드에선 허용한다.
- **임의 오리진 fetch 하드닝은 저장소 3경로를 그대로 따른다**: `messages.ts:748-749`(`credentials:"omit"` + `redirect:"manual"`), `ai-provider.ts:495`·`:597`(`redirect:"manual"` + `throwIfRedirected`). 사용자 `Authorization`을 싣는 요청이라 302 추적은 시크릿 유출 경로다.
- **에러는 throw, 직렬화는 `index.ts`에 위임.** `WebhookError`를 `PLATFORM_ERROR_CTORS`에 등록하면 `src/background/index.ts:191`의 catch 체인이 `{status, body}`를 자동으로 응답에 싣는다. 핸들러가 try/catch하지 않는다.
- **본문 언어(`bodyLocale`)**: 본문을 사이드패널에서 완결해 보내므로 background 재래핑이 **불필요**하다(Jira·Notion만 예외적으로 필요한 구조). `bodyLocaleBackground.test.ts`의 화이트리스트를 건드리지 않는다.
- **analytics**: `trackSubmit`에 `platform: "webhook"`만 실린다. `ALLOWED_EVENTS.issue_submitted`(`src/background/analytics.ts:34-43`)는 **건드리지 않는다** — 엔드포인트 host를 화이트리스트에 올리지 않는 것이 이 기능의 불변식이다.
- **연결 테스트 버튼**은 토큰 다이얼로그 7개 공통 관용구(`validating` state, `disabled` + `aria-disabled` 분리, `opacity-0` 텍스트 + 절대 위치 `Loader2`, 성공 시에만 `setAccount`)를 따른다(Slack은 OAuth 전용이라 다이얼로그가 아예 없다 — 8개가 아니라 7개다). 다이얼로그 하단은 같은 7개와 같은 `DialogFooter className="flex-row justify-end"`다.
- **헤더 key/value 동적 행의 선례는 `connect/`가 아니라 `DraftingPanel.tsx:687-806`의 재현 환경 행이다.** `Input`(`w-24` 라벨 + `flex-1` 값) + `size="icon" h-9 w-9` 삭제 버튼, 마지막 행에만 추가 버튼. 그 구조를 그대로 가져온다 — `connect/` 8개 폼에는 이런 UI가 없다.
- **헤더 값은 마스킹하지 않는다.** 8개 폼의 PAT·API 키가 전부 평문 `Input`(`autoComplete="off"` + `spellCheck={false}`)이고 저장소 유일한 `type="password"`는 설정 탭의 `LlmConnectDialog.tsx:296`이다. 여기만 새 관용구를 만들지 않고, 대신 **에러 메시지·토스트·analytics에 헤더를 절대 싣지 않는다**를 불변식으로 둔다.
- **진입 버튼의 설명은 툴팁으로 단다.** `TooltipProvider delayDuration={0}` > `Tooltip` > `TooltipTrigger asChild` > `Button` > `TooltipContent` 관용구를 그대로 쓴다(`IssueTab.tsx:368-389`가 선례).
- **진입 버튼은 중앙 덩어리 안에 둔다 — `PageFooter`를 쓰지 않는다.** `PageFooter`(`Section.tsx:38`, `shrink-0 … border-t bg-muted/50 p-4`)는 저장소 전체에서 **`PageScroll`의 짝**으로만 쓰이는데, `add` 서브탭은 `items-center justify-center` 중앙정렬이라 전제가 반대다. 붙이면 `flex-1` 본문 가용 높이가 ~69px 줄어 그리드 덩어리가 **약 34.5px 위로 밀리고** 기존 `pb-5`와 겹쳐 이중 여백이 생기며, 스크롤 컨테이너가 없어 세로가 짧으면 상단 제목이 클립된다. 대신 그리드 바로 아래 `gap-4` 자리에 **구분선 + 단독 버튼**을 둔다 — 중앙정렬이 유지되고 "8개 + 성격 다른 1개"가 한 시선에 읽히며, `bg-muted/50` 위 `text-muted-foreground` 대비 게이트(`styles/__tests__/muted-surface-contrast.test.ts`, 라이트 4.34:1)가 **애초에 발생하지 않는다**.
- **브랜드 그리드에서 뺀다 — `ConnectFlow`를 optional로 만들어서.** `add` 서브탭의 2열 그리드는 `orderAddPlatforms(PLATFORMS.map(p => p.id), …)`(`integrationsTabUtils.ts:24-31`)를 그대로 도는데, `webhook`이 거기 남아 있으면 로고 자리에 lucide 아이콘이 섞여 들어간다. **`PLATFORMS` 배열 자체에서 빼면 안 된다** — 내 연동 목록의 Section 렌더가 그 배열을 찾아 쓴다(`IntegrationsTab.tsx:130-132`의 `PLATFORMS.find(...)!`가 `undefined`로 터진다). 그런데 `PlatformEntry.ConnectFlow`(`:48-54`)가 **non-optional**이라 그냥 남기면 렌더되지 않을 더미 컴포넌트를 주입해야 하고, 그러면 "그리드에서 빼는 런타임 필터"가 유일한 안전장치가 된다(누가 필터를 되돌리면 죽은 컴포넌트가 조용히 렌더된다). 대신 **`ConnectFlow?`로 optional화하고 그리드 매핑을 `PLATFORMS.filter(p => p.ConnectFlow)`로 좁혀 타입과 런타임 필터를 한 곳에 묶는다.** 대가는 남은 8개의 "빠뜨리면 컴파일 에러" 강제를 잃는 것이고, 그건 `filter`가 같은 파일 안에 있어 받아들인다.

## 대안 검토

**1. base64 미디어를 단일 JSON 바디에 싣는다 (기각).** 계약이 한 종류로 끝나고 수신 구현이 가장 쉽다. 그러나 30s replay MP4 + 첨부 합계 50MB(`MAX_TOTAL_ATTACHMENT_SIZE`)가 base64로 1.33배 부풀어 서비스워커 메모리와 서버 바디 캡을 동시에 때린다. multipart는 이미 저장소에 선례가 7곳이라 새 위험도 아니다.

**2. 2단 계약 — `POST /upload` 후 `POST /issue` (기각).** 기존 8개 어댑터의 모양과 가장 닮았고 본문 치환도 자연스럽다. 그러나 수신 서버가 구현할 엔드포인트가 2개로 늘고, 첫 요청만 성공한 부분 실패 상태가 생겨 atomic 성질(=승격 가드 불필요)을 잃는다. 채택안은 이 둘을 동시에 피한다.

**3. `DeliveryTarget`이라는 별도 축 신설 (기각).** "webhook은 이슈 트래커가 아니다"는 개념적으로 맞다. 그러나 이슈 목록·배지·제출 다이얼로그·설정이 전부 2축으로 갈라지고, Slack이 이미 트래커가 아니면서 `PlatformId`에 들어와 있다는 선례가 있다. 개념적 순수함의 대가가 UI 전반의 분기 증식이다.

**4. 템플릿을 문자열 치환 후 `JSON.parse` (기각).** 구현이 10줄로 끝난다. 그러나 본문에 따옴표·역슬래시·개행이 하나만 있어도 JSON이 부서지고, 그 실패가 **사용자 본문 내용에 의존**해 재현이 불규칙해진다. parse-먼저-치환-나중이 유일하게 옳은 순서다.

**5. 엔드포인트 N개 등록 (이번 스코프 밖).** `Accounts`의 플랫폼당 1계정 전제를 깨야 하고, 제출 다이얼로그에 "어느 엔드포인트로" 선택 필드가 생기며, 그 순간 `LastSubmitFieldsByPlatform`에 `webhook`이 필요해지고 "제출 목적지 필드는 last 우선"(POSTMORTEM 2026-06-30) 규칙까지 따라붙는다. 수요가 확인되면 그때 연다.

## 위험 요소

### 9열 탭은 물리적으로 안 들어간다 (선행 픽스)

`TABS_GRID_COLS`(`SubmitFieldsDialog.tsx:101-110`)가 8까지만 정의돼 있어 9번째 탭이 붙는 순간 `undefined` → `grid-cols-2` 폴백으로 탭 줄이 5행으로 무너진다. **그런데 `9: "grid-cols-9"`를 추가해도 해결되지 않는다.** 400px 패널에서 다이얼로그는 `w-[90vw]`=360px, `p-6` 제외 312px, `TabsList p-1` 제외 **304px**. 9등분하면 셀이 33.8px인데 트리거 최소폭은 아이콘 `h-3.5 w-3.5`(14px) + `px-3`(24px) = **38px**이고 둘 다 고정값이다(`min-w-0`는 컨텐츠를 줄이지 못한다). 8열이 이미 슬랙 0px이고, `CollapsingTabsList`는 **라벨만** 떼지 아이콘·패딩은 못 줄인다. 33.8×36px은 저장소 최소 아이콘 버튼(`h-9 w-9`=36×36)보다도 좁다.

→ **9개 이상이면 `TabsList`를 가로 스크롤(`overflow-x-auto`)로 전환한다.** 아이콘 최소폭을 보존하고 10번째가 와도 안 깨진다. 이 기능과 독립된 선행 픽스라 별도 커밋으로 분리하되, 픽스 내용이 "상수 한 줄 추가"가 아님을 tasks.md가 반영한다.

### 전송 경로

- **`redirect: "manual"`·`credentials: "omit"` 누락은 시크릿 유출이다.** 사용자 `Authorization` 헤더를 실은 요청이 302를 따라가면 그 값이 리다이렉트 대상 호스트로 넘어간다. 저장소의 임의-오리진 fetch 3경로가 전부 이 둘을 갖고 있다(`messages.ts:748-749`, `ai-provider.ts:495`, `:597`).
- **사용자 `Content-Type`이 multipart boundary를 파괴한다.** forbidden header가 아니라 그대로 실리므로 `application/json`을 넣어둔 사용자의 요청은 boundary 없이 나가고 수신 서버가 조용히 파싱에 실패한다. multipart 모드에서 명시 제거.
- **forbidden header는 무음 드롭된다.** `Cookie`·`Host`·`Content-Length`·`Origin` 등은 `Headers` 설정 시 조용히 사라지고(문법 오류만 `TypeError`), `declarativeNetRequest` 권한이 없어 우회 불가다. 저장 시점 `isSettableHeaderName` 게이트가 유일한 방어.
- **합본 `FormData`는 저장소 최초의 SW 메모리 위험이다.** 기존 8개 업로드 경로가 **예외 없이 파일별 순차**이고(GitHub만 병렬인데 그건 `world:"MAIN"` 주입이라 페이지 렌더러 힙), 합본은 응답이 끝날 때까지 모든 Blob이 동시에 살면서 `sendMessage`로 넘어온 dataUrl 문자열 사본도 남는다. 파일당 순간 피크가 원본의 약 4.3배다(dataUrl 1.33× + 바이너리 문자열 + `Uint8Array` + `Blob`). **`MAX_TOTAL_ATTACHMENT_SIZE`(50MB)는 사용자 첨부만 덮고 영상·이미지·`logs.html`은 캡 밖**이므로, `WEBHOOK_BODY_MAX_BYTES`를 템플릿 모드 전용이 아니라 **multipart 조립에도** 적용하고 변환 직후 원본 dataUrl 슬롯을 null화한다.
- **비멱등 POST + 구분 불가 에러.** `sendBg`에는 타임아웃이 없다(`ARCHITECTURE.md:421`) — 그래서 background의 `AbortSignal.timeout`이 **사이드패널 프라미스가 settle되는 유일한 보장**이다. "네트워크 예의"가 아니라 무한 스피너 방지 장치다. 그리고 타임아웃/SW 종료 시 서버가 받았는지 알 수 없는데 에러는 `bg.error.communication` 하나로 뭉치므로, 재시도가 중복 리포트를 만들지 않도록 payload에 멱등 키를 싣고 계약 문서에 명시한다.
- **`readErrorBody`에 크기 제한이 없다.** 신뢰된 벤더 API 전용으로 설계된 함수(`background/lib/readErrorBody.ts:2`, 무제한 `res.text()`)인데 webhook은 임의 서버가 상대다. `messages.ts:771`의 `readCappedSheetText`(module-local이라 복제 또는 export 승격 필요)와 같은 스트리밍 캡 래퍼를 쓴다.
- **타임아웃 선례는 `css.fetchSheets` 하나뿐이다** — 정확히는 **타임아웃 목적의 `AbortSignal.timeout`이** 하나뿐이고(`messages.ts:750`), 사용자 취소용 `AbortController`는 4곳 더 있다(`css-source-cache.ts`·`IssueTab.tsx`·`useAiRun.ts`). 임의 사용자 서버가 상대라 이 기능만 타임아웃을 갖는 이유를 상수 주석에 박는다.
- **SSRF 가드(`isFetchableSheetUrl`)는 적용하지 않는다.** `lib/loopback-host.ts:3-6` 주석이 이미 정본화했다 — 저쪽은 *적대적 페이지가 준 href*를 차단하는 방향이고, webhook은 *사용자가 자기 연결 폼에 직접 타이핑한* 사설망 엔드포인트를 허용해야 하는 반대 방향이다. `lib/url-support.ts`의 `isSupportedUrl`도 끌어오면 안 된다(content script 주입 가능성 판정이라 `file:`이 통과한다).

### 분기·렌더

- **삼항 체인의 fallback 위치.** `SubmitFieldsDialog`의 폼 렌더는 마지막이 notion으로, `PlatformChip`은 마지막이 github로 떨어지는 구조다(둘 다 `never` 가드 없음). 새 분기를 **뒤에** 붙이면 아무 에러 없이 엉뚱한 렌더가 된다.
- **`getOAuthErrorPlatform`(`lib/bg-client.ts:61-74`)은 8리터럴 `||` 체인이다.** 반환이 좁은 union이고 `PlatformId`에 그냥 대입되므로 컴파일러가 못 잡는다. 빠뜨리면 webhook 연결 에러가 `null` → `App.tsx:156`의 `?? "jira"`로 **Jira 재연결 다이얼로그**가 뜬다. 다행히 `bg-client.test.ts:209`가 `Object.keys(PLATFORM_TAB_KEYS)` 파생이라 red로 잡는다(저장소에서 유일한 파생형 로스터).
- **`promotableTargets`(`issueListUtils.ts:124`)가 webhook을 자동 포함한다.** `filter(p => p !== "slack")`이라 분기를 안 넣어도 Slack 보존 이슈의 `[승격]` 대상에 들어오고, 그게 의도다. 다만 **json 모드로 승격하면 목록 행이 안 생기므로** 승격 선택 UI가 그 차이를 보여야 하고, 무음 동작이라 회귀 테스트로 고정한다.
- **`prepareUpload`의 가짜 `UploadFn`.** 네트워크를 타지 않고 `cid:`를 즉시 돌려주는 함수라 `someUploadMissing`(`prepareUpload.ts:46`)이 항상 `false`가 된다. 의도된 결과지만 "업로드 실패 감지가 죽었다"로 오독될 수 있어 주석이 필요하다. 또 `opts.platform` 확장은 `prepareUpload.ts:103`의 `t(\`${opts.platform}.error.mediaUploadFailed\`)` 템플릿 리터럴 키를 타므로 **`webhook.error.mediaUploadFailed` i18n 키가 없으면 무음 폴백**이다(도달 불가 경로지만 키는 채운다).

### 마이그레이션·그물

- **`migrate` 체인 배선이 그물 밖이다.** `SETTINGS_STORE_VERSION`만 12로 올리고 `settings-store.ts:266-286`에 `if (version < 12)`를 안 넣어도 레포 전체에서 red가 0건이다(그 상수를 단언하는 테스트가 없다). 반대로 `settings-store.test.ts:834`는 버전 `11`이 하드코딩돼 있어 v12 단계를 추가하면 그 케이스가 새 단계를 타 red가 되고, 숫자만 고치면 v12 검증이 0이 된다 — `:855-871`("version 10 → v11 단계 배선")을 템플릿으로 **신규 케이스를 추가**해야 "호출 한 줄 삭제"가 잡힌다. 단계는 `isV3Shape` 게이트 뒤에 온다.
- **하드코딩 8열거 테스트들이 전부 무음 통과한다.** `track-submit.test.ts:9-16`(이미 6개뿐인 stale), `integrationsTabUtils.test.ts:9-15`(6개), `settings-store.test.ts:277-297`("8종 전부 연결 시 폴백 순서" — webhook 랭크가 어디에도 고정되지 않아 테스트 이름이 거짓이 된다), `i18n/__tests__/proper-nouns.test.ts:19-24`(`"Webhook"` 미등재 → ko/en 외 로케일에서 번역돼 사라져도 영구 무음). 전부 손으로 갱신한다.
- **`bundleBoundary.test.ts`.** `@/sidepanel/lib/attachmentLimits`는 이미 `ALLOWED`에 있다(`editor-store.ts:15`가 소비). webhook 순수 로직을 `sidepanel/lib/`에 두고 store가 **참조하지 않게** 설계했으므로 화이트리스트를 건드릴 일이 없다. 다만 같은 테스트의 "죽은 항목 없음" 단언이 있어, 작업 중 `editor-store`의 import를 `import type`으로 좁히면 red가 된다.
- **커버리지 로직 스코프.** `background/webhook-api.ts`·`sidepanel/lib/submitToWebhook.ts`는 분모에 포함되고(`.tsx`도 `BROWSER_BOUND_EXACT`도 아니다) `WebhookConnectForm.tsx`는 `.tsx`라 제외된다. 유닛이 없으면 로직 스코프 %가 떨어진다.

### 정책

- **평문 판정의 사설망 목록.** `isCredentialSafeUrl`(`lib/loopback-host.ts:18`, https 또는 loopback만)을 그대로 쓸 수 없어 판정을 새로 쓴다. IPv6 사설 대역·`*.local`·점 없는 단일 호스트명까지 포함해야 실사용을 덮는데 이 목록은 틀리기 쉬우므로 순수 함수로 떼어 유닛으로 전수 고정한다.
- **URL 정규화를 GitLab에서 복제하면 안 된다.** `normalizeInstanceUrl`(`connect/gitlabInstanceUrl.ts:35`)은 `${protocol}//${host}`만 남기고 **path를 버린다**. 웹훅은 path가 본질이라(`/intake`, Discord의 긴 경로) 그대로 쓰면 전송이 조용히 루트로 간다.
- **템플릿 모드의 `{{media.*.dataUri}}`.** 사용자가 옵트인으로 켜는 순간 바디가 폭증한다. 치환 직후 바이트를 재서 경고(8MB)·차단(25MB)하는 게 유일한 방어선이다. 영상은 `dataUri` 변수를 아예 제공하지 않는다.
- **첨부 상한과 바디 캡이 어긋난다.** picker는 `MAX_TOTAL_ATTACHMENT_SIZE`(50MB)까지 받는데 webhook은 25MB에서 거부한다. 첨부 UI가 webhook 연결 시 그 차이를 설명하거나, 최소한 거부 토스트가 "첨부 N MB + 영상 M MB"로 내역을 보여줘야 한다.
- **헤더 값이 시크릿이다.** `Authorization`이 `chrome.storage.local`에 평문으로 남는 건 기존 PAT과 같은 취급이고 **마스킹도 하지 않는다**(위 "기존 패턴 준수" 참조). 대신 에러 메시지·토스트·analytics 어디에도 헤더를 넣지 않는 걸 불변식으로 두고 리뷰에서 본다. 관련해서 `platform_connect.reason`(`analytics.ts:46`)은 값 검사가 없는 유일한 자유 문자열 슬롯인데, `classifyConnectReason`이 고정 enum만 반환하고 webhook은 OAuth 경로를 타지 않아 현재는 안전하다 — 회귀 감시 대상.
