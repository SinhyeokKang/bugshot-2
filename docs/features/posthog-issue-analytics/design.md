# PostHog 이슈 제출 집계 — 기술 설계

## 개요

이슈 제출 UI의 단일 choke point(`SubmitFieldsDialog.handleSubmit`)에서 제출 성공/실패가 갈리는 지점에 fire-and-forget 추적 호출을 1개 넣는다. 호출은 background로 메시지(`analytics.capture`)를 보내고, background의 `src/background/analytics.ts`가 PostHog `/capture/` 엔드포인트로 직접 `fetch`한다. 외부 fetch는 background에서만 한다는 기존 아키텍처를 따른다. PostHog 키는 빌드 타임 env로 주입하되 **store 빌드에서만** `VITE_POSTHOG_KEY_PROD`를 vite define으로 승격(GitHub OAuth 키와 동형)해 dev/일반/e2e 빌드는 키가 비어 전송이 no-op이 된다 → **prod(스토어 배포본) 데이터만 누적**.

## 변경 범위

### 신규 파일

- **`src/background/analytics.ts`** — PostHog 전송 모듈. 키는 `VITE_POSTHOG_KEY`로 읽되, store 빌드에서만 `VITE_POSTHOG_KEY_PROD`가 vite define으로 승격된다(아래 vite.config.ts·"기존 패턴" 참조). dev/일반/e2e 빌드는 키가 비어 no-op → **prod 데이터만 누적**.
  - `analyticsEnabled(key: string | undefined): boolean` — 순수 함수(`!!(key ?? "").trim()`). 게이팅 테스트 대상(define 치환과 무관하게 검증 가능).
  - `isAnalyticsConfigured(): boolean` — `analyticsEnabled(import.meta.env.VITE_POSTHOG_KEY)`.
  - `buildCaptureBody(event, properties, distinctId, apiKey): PosthogCaptureBody` — 순수 함수. `properties`에 `$process_person_profile: false`, `$ip: ""`, `$geoip_disable: true`를 병합, `api_key`는 인자(define 치환과 무관하게 테스트). 단위 테스트 대상.
  - `postCapture(host, body): Promise<void>` — fetch 코어. `fetch(host + "/capture/", { method:"POST", headers, body: JSON.stringify(body) })`. reject·non-ok 모두 catch해 `console.warn`만(격리). 인자 주입이라 fetch mock으로 테스트.
  - `captureEvent(event, properties): Promise<void>` — 얇은 wrapper. `const key = (import.meta.env.VITE_POSTHOG_KEY ?? "").trim(); if (!key) return;` 후 `postCapture(posthogHost(), buildCaptureBody(event, properties, crypto.randomUUID(), key))`.
- **`src/background/__tests__/analytics.test.ts`** — `buildCaptureBody`/`isAnalyticsConfigured` 단위 테스트.

### 변경 파일

- **`src/types/messages.ts`**
  - 현재 역할: `BgRequest` union 타입 정의 + `sendBg<T>()` 헬퍼.
  - 변경: union에 `{ type: "analytics.capture"; event: string; properties: Record<string, string> }` 추가.

- **`src/background/messages.ts`**
  - 현재 역할: `handleMessage()` switch로 메시지 라우팅.
  - 변경: `case "analytics.capture": return captureEvent(message.event, message.properties);` 추가(`void` 성격이라 결과 불필요, `{ ok: true }` 반환 흐름에 맞춤).

- **`src/background/bgRequestTypes.ts`**
  - 현재 역할: `BG_REQUEST_TYPE_MAP`(`Record<BgRequest["type"], true>`) + 그로부터 만든 `BG_REQUEST_TYPES` Set으로 onMessage가 허용 메시지를 화이트리스트 게이팅.
  - 변경: 맵에 `"analytics.capture": true` 추가. **누락 시 컴파일 에러(exhaustive Record) + 런타임 메시지 silently drop**이므로 union·switch와 함께 반드시 갱신(메시지 추가는 항상 3곳 수정).

- **`src/sidepanel/tabs/SubmitFieldsDialog.tsx`**
  - 현재 역할: 6개 플랫폼 공통 제출 다이얼로그. `handleSubmit()`(176-198줄)이 모든 제출의 단일 진입점. `platform: PlatformId` prop 보유, try/catch로 성공/실패 일괄 처리.
  - 변경:
    1. props에 `captureMode?: CaptureMode` 추가.
    2. `handleSubmit()`에서 **`await onSubmit(platform)`이 리졸브된 직후**(=`onOpenChange(false)`·`onSuccess?.()` 호출 **이전**) `trackSubmit(platform, captureMode, "success")`, catch 블록에서 `trackSubmit(platform, captureMode, "failure")` 호출(await 안 함). success 추적을 `onSuccess` 앞에 두는 이유: `onSuccess`/`onOpenChange`가 throw하면 catch로 떨어져 `failure`가 중복·오분류되는 것을 막기 위함. `result`는 오직 `onSubmit`의 성공/예외에만 묶인다.
  - `trackSubmit` 헬퍼는 같은 파일 상단 또는 `src/sidepanel/lib/track-submit.ts`(순수 매핑 + sendBg)로 둔다. → **신규 파일 `src/sidepanel/lib/track-submit.ts` 채택**(매핑 함수 단위 테스트 가능하게).

- **`src/sidepanel/lib/track-submit.ts`** (신규)
  - `submitEventProperties(platform, captureMode, result): Record<string, string>` — 순수 매핑(단위 테스트 대상).
  - `trackSubmit(platform, captureMode, result): void` — `sendBg({ type: "analytics.capture", … })`를 `.catch(() => {})`로 fire-and-forget.

- **`src/sidepanel/tabs/DraftDetailDialog.tsx`**
  - 현재 역할: 제출 내역 다이얼로그. `<SubmitFieldsDialog …/>`(788줄 부근) 렌더, `issue?.captureMode` 보유.
  - 변경: `<SubmitFieldsDialog captureMode={issue?.captureMode} …/>` prop 전달.

- **`src/sidepanel/tabs/IssueCreateModal.tsx`**
  - 현재 역할: 라이브 편집 → 제출. `<SubmitFieldsDialog …/>`(612줄 부근) 렌더, `useEditorStore((s) => s.captureMode)` 보유.
  - 변경: `<SubmitFieldsDialog captureMode={captureMode} …/>` prop 전달.

- **`vite.config.ts`**
  - 현재 역할: store 빌드 시 `VITE_GITHUB_CLIENT_ID_PROD`를 `VITE_GITHUB_CLIENT_ID`로 define 승격(23-25줄 define 블록).
  - 변경: 동일 패턴으로 `const posthogKey = isStoreBuild ? env.VITE_POSTHOG_KEY_PROD ?? "" : env.VITE_POSTHOG_KEY ?? "";` + define에 `"import.meta.env.VITE_POSTHOG_KEY": JSON.stringify(posthogKey)` 추가. → store 빌드에서만 키 주입, 그 외 빈 값(no-op).

- **`.env.example`**
  - `VITE_POSTHOG_KEY`(dev — 비워두면 dev/일반 빌드에서 전송 안 함), `VITE_POSTHOG_KEY_PROD`(store 빌드에서 승격), `VITE_POSTHOG_HOST`(기본 `https://us.i.posthog.com`) 항목 + 주석.

- **`docs/privacy.md`**
  - 익명 집계 수집·전송 동작 명시(아래 위험/규정 항목 참조). 시행일 갱신.

> manifest·권한 변경 **없음**. vite.config.ts는 dev/prod 키 분기 define 1줄만 추가(GitHub 키와 동형).

## 데이터 흐름

```
사용자 "제출" 클릭
  └ SubmitFieldsDialog.handleSubmit()
       ├ await onSubmit(platform)            // 기존 제출 로직(background로 createIssue)
       │    ├ 리졸브 → trackSubmit(…, "success") → onOpenChange(false) → onSuccess?.()
       │    └ 예외 → catch → trackSubmit(…, "failure")
       │
       └ trackSubmit  (sidepanel, fire-and-forget)
            └ sendBg({ type:"analytics.capture", event:"issue_submitted",
                       properties:{ platform, capture_mode, result } })
                 └ background handleMessage → captureEvent()
                      └ 키 있으면(=store 빌드) postCapture(host, body) → fetch /capture/
                        키 없으면(dev/일반/e2e) no-op
```

- 추적 호출은 제출 결과를 기다리지 않고(=UI는 이미 onSuccess/toast 처리), 실패해도 삼킨다.
- distinct_id는 background `captureEvent`에서 매 이벤트 `crypto.randomUUID()`로 새로 생성 → 사용자 단위 연결 불가(완전 익명). `$process_person_profile: false`로 person profile 생성을 막고, `$ip: ""` + `$geoip_disable: true`로 PostHog가 수신 IP를 저장·지오로케이션하지 않게 한다.

## 인터페이스 설계

```typescript
// src/types/messages.ts — BgRequest union에 추가
| { type: "analytics.capture"; event: string; properties: Record<string, string> }

// src/background/analytics.ts
interface PosthogCaptureBody {
  api_key: string;
  event: string;
  distinct_id: string;
  // 입력 properties + { $process_person_profile: false, $ip: "", $geoip_disable: true } 병합
  properties: Record<string, string | boolean>;
}

// 게이팅은 순수 함수로 분리(키 인자) — vite define 치환과 무관하게 테스트 가능
export function analyticsEnabled(key: string | undefined): boolean;
export function isAnalyticsConfigured(): boolean; // = analyticsEnabled(import.meta.env.VITE_POSTHOG_KEY)

export function buildCaptureBody(
  event: string,
  properties: Record<string, string>,
  distinctId: string,
  apiKey: string, // 인자 주입(define 치환 무관 테스트)
): PosthogCaptureBody;

export function postCapture(host: string, body: PosthogCaptureBody): Promise<void>; // fetch 코어, 격리

export function captureEvent(
  event: string,
  properties: Record<string, string>,
): Promise<void>;

// src/sidepanel/lib/track-submit.ts
import type { PlatformId } from "@/types/platform";
import type { CaptureMode } from "@/store/editor-store";

export function submitEventProperties(
  platform: PlatformId,
  captureMode: CaptureMode | undefined,
  result: "success" | "failure",
): Record<string, string>; // { platform, capture_mode, result }

export function trackSubmit(
  platform: PlatformId,
  captureMode: CaptureMode | undefined,
  result: "success" | "failure",
): void;

// src/sidepanel/tabs/SubmitFieldsDialog.tsx — props 추가
captureMode?: CaptureMode;
```

상수:

```typescript
// src/background/analytics.ts
// VITE_POSTHOG_KEY는 store 빌드에서만 vite define으로 값이 박힌다(VITE_POSTHOG_KEY_PROD 승격).
// define 치환이라 모듈 상수든 함수 재독이든 동일하게 빌드타임 리터럴 — vi.stubEnv는 안 먹힌다.
// 그래서 게이팅(analyticsEnabled)·전송(buildCaptureBody/postCapture)을 키·host 인자로 받는
// 순수/주입 함수로 분리해 테스트하고, env 읽기는 isAnalyticsConfigured/captureEvent의 얇은 표면에만 둔다.
function posthogHost(): string {
  return (import.meta.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com").trim().replace(/\/+$/, "");
}
```

`capture_mode`는 `CaptureMode`(element/screenshot/video/freeform 4종) 또는 호출부에서 undefined가 넘어올 때를 대비해 `submitEventProperties`에서 `?? "unknown"`으로 1줄 방어한다. 실제 두 호출부(`issue.captureMode`, editor store)는 제출 시점에 항상 값이 있어 `"unknown"`은 도달하지 않는 방어 코드다 — 이를 위한 전용 단위 테스트는 만들지 않는다.

## 기존 패턴 준수

- **외부 fetch는 background에서만**: `analytics.capture` 메시지로 위임. sidepanel은 fetch하지 않는다.
- **dev/prod 키 분기**: `VITE_GITHUB_CLIENT_ID`(dev) / `VITE_GITHUB_CLIENT_ID_PROD`(store, vite define 승격) 패턴을 그대로 따라 `VITE_POSTHOG_KEY` / `VITE_POSTHOG_KEY_PROD`로 둔다. dev 키를 비워 prod(스토어 배포본) 데이터만 누적.
- **env 게이팅**: `isAnalyticsConfigured()`는 `isOAuthConfigured()` 류 패턴. 키 없으면 자동 비활성. 단 define 치환 대상(GitHub과 동일)이라 게이팅 검증은 `analyticsEnabled(key)` 순수 함수로 분리한다.
- **메시지 추가 패턴**: `src/types/messages.ts` union + `src/background/bgRequestTypes.ts` 맵 + `src/background/messages.ts` switch — 3곳 수정(기존 핸들러와 동일 형태).
- **순수 함수 단위 테스트**: `analyticsEnabled`, `buildCaptureBody`(키 인자), `postCapture`(host 인자·fetch mock), `submitEventProperties`를 `__tests__/*.test.ts`에 Vitest로 작성(CLAUDE.md 테스트 우선 원칙).
- **i18n**: 사용자 노출 문자열 없음 → `src/i18n/` 변경 없음.

## 대안 검토

1. **background message 경유 vs sidepanel 직접 fetch**
   sidepanel(확장 페이지)에서도 PostHog로 직접 fetch는 가능하다(PostHog `/capture/`는 CORS 허용). 그러나 "외부 fetch는 background" 컨벤션을 깨고, 추적 지점이 sidepanel/background로 흩어진다. → **background 경유 채택**. 추가 round-trip 비용은 fire-and-forget이라 무시 가능.

2. **distinct_id를 익명 설치 UUID로 vs 매 이벤트 랜덤**
   설치 UUID(storage.local 저장)면 MAU·재방문 측정이 가능하지만, 사용자 요구는 "제출 건수 집계"뿐이고 식별 최소화를 택했다. → **매 이벤트 랜덤 + `$process_person_profile:false`** 채택. 프라이버시 최소 노출.

3. **posthog-js SDK 도입 vs raw fetch**
   posthog-js는 `window`/`document`/localStorage 의존이 강해 MV3 service worker에서 부적합하고, autocapture·person 관리 등 불필요한 표면이 크다. → **raw `fetch`** 채택.

4. **choke point를 background 6개 submit 핸들러에 vs UI 1곳에**
   background 핸들러에 넣으면 `capture_mode`가 payload에 없어 6곳에 mode를 추가 전달해야 한다(침습 범위 ↑). UI choke point(`SubmitFieldsDialog.handleSubmit`)는 platform 보유 + 성공/실패 일괄 처리 + 부모가 captureMode 보유라 prop 1개 추가로 끝난다. → **UI choke point 채택**.

## 위험 요소

- **host_permissions/CORS**: MV3 service worker fetch도 웹페이지처럼 CORS 적용 대상이고 요청 origin은 `chrome-extension://<id>`다. PostHog `/capture/`는 브라우저(posthog-js) 직접 호출용으로 `Access-Control-Allow-Origin: *`를 주므로 host_permission **없이 통과**한다(Chrome 공식 GA4 MV3 튜토리얼이 동일 패턴 사용). 일부러 host_permissions에 PostHog 도메인을 추가하면 스토어 업데이트 시 권한 재동의 프롬프트가 떠 확장이 비활성화될 수 있으므로 **추가하지 않는다**. CORS가 막히면(엔드포인트 정책 변경) `manifest.config.ts`에 PostHog origin을 host_permission으로 추가하는 게 fallback이며, 이때 privacy/PERMISSION 문서·권한 재동의 영향을 반드시 검토한다.
- **preflight(OPTIONS)**: `Content-Type: application/json` POST는 CORS simple request가 아니라 **preflight(OPTIONS)를 유발**한다. PostHog `/capture/`가 OPTIONS에 `ACAO: *` + `Access-Control-Allow-Headers: content-type`을 정상 응답하는지 구현 중 1회 수동 확인한다(posthog-js가 동일 헤더로 쓰므로 거의 확실하나 명시 검증). 막히면 헤더 조정 또는 위 host_permission fallback.
- **프라이버시 규정**: 새 데이터 수집·외부 전송이라 manifest diff가 0이어도 `docs/privacy.md` 갱신이 **필수**(CLAUDE.md 신선도 규칙). 수집 항목(platform, capture_mode, result), 수집 목적(집계), 익명성(식별자 미수집, 이벤트별 랜덤 distinct_id, `$ip` 비움·GeoIP 비활성), 수신처(PostHog), 옵트아웃 부재를 명시하고 시행일 갱신.
- **수신 IP**: PostHog 서버는 전송 시점의 요청 IP를 자동 인지한다. 이벤트 properties에 `$ip: ""` + `$geoip_disable: true`를 실어 저장·지오로케이션을 막아 prd의 "완전 익명·식별정보 미전송" 주장과 정합시킨다. (PostHog 프로젝트 설정의 IP 익명화는 보조 수단으로만 둔다.)
- **프라이버시 고지 노출 경로**: 첫 외부 전송이지만 확장 UI(`SettingsFooter`)에 privacy 링크는 **추가하지 않는다**. 대신 Chrome 웹스토어 개발자 대시보드에 privacy URL을 등록해 정책 공개 요건을 충족한다(스토어 정책상 앱 내 링크는 필수 아님). prd의 "UI 0" 전제 유지. 향후 footer 노출이 필요하면 `external-links.ts`에 `PRIVACY_URL` + i18n 키 추가가 최소 작업.
- **payload 누출 방지**: `properties`에 들어가는 값은 enum성 문자열(platform/capture_mode/result)뿐이어야 한다. 에러 메시지·이슈 제목 등을 실수로 넣지 않도록 `submitEventProperties`를 단일 통로로 고정하고 테스트로 키 집합을 고정.
- **fire-and-forget 격리**: `trackSubmit`/`captureEvent` 어디서 throw해도 제출 UI에 전파되면 안 된다. `sendBg(...).catch(()=>{})` + `captureEvent` 내부 try/catch 이중 방어. 단위 테스트로 throw 격리 확인.
- **이벤트 폭증 없음**: 제출 1회당 1이벤트. 루프·리트라이 없음.
