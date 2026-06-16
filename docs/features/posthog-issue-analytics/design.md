# PostHog 이슈 제출 집계 — 기술 설계

## 개요

이슈 제출 UI의 단일 choke point(`SubmitFieldsDialog.handleSubmit`)에서 제출 성공/실패가 갈리는 지점에 fire-and-forget 추적 호출을 1개 넣는다. 호출은 background로 메시지(`analytics.capture`)를 보내고, background의 `src/background/analytics.ts`가 PostHog `/capture/` 엔드포인트로 직접 `fetch`한다. 외부 fetch는 background에서만 한다는 기존 아키텍처를 따른다. PostHog 키는 빌드 타임 env(`VITE_POSTHOG_KEY`)로 주입하며, 키가 없으면 전송 전체가 no-op이 된다(`isOAuthConfigured()`와 동일한 패턴).

## 변경 범위

### 신규 파일

- **`src/background/analytics.ts`** — PostHog 전송 모듈.
  - `isAnalyticsConfigured(): boolean` — `VITE_POSTHOG_KEY` 존재 여부.
  - `buildCaptureBody(event, properties, distinctId): PosthogCaptureBody` — 순수 함수. PostHog `/capture/` 바디 생성(단위 테스트 대상).
  - `captureEvent(event: string, properties: Record<string, string>): Promise<void>` — 키 없으면 즉시 return. 있으면 `fetch(POSTHOG_HOST + "/capture/", …)`. 모든 오류 catch해 `console.warn`만.
- **`src/background/__tests__/analytics.test.ts`** — `buildCaptureBody`/`isAnalyticsConfigured` 단위 테스트.

### 변경 파일

- **`src/types/messages.ts`**
  - 현재 역할: `BgRequest` union 타입 정의 + `sendBg<T>()` 헬퍼.
  - 변경: union에 `{ type: "analytics.capture"; event: string; properties: Record<string, string> }` 추가.

- **`src/background/messages.ts`**
  - 현재 역할: `handleMessage()` switch로 메시지 라우팅.
  - 변경: `case "analytics.capture": return captureEvent(message.event, message.properties);` 추가(`void` 성격이라 결과 불필요, `{ ok: true }` 반환 흐름에 맞춤).

- **`src/sidepanel/tabs/SubmitFieldsDialog.tsx`**
  - 현재 역할: 6개 플랫폼 공통 제출 다이얼로그. `handleSubmit()`(176-198줄)이 모든 제출의 단일 진입점. `platform: PlatformId` prop 보유, try/catch로 성공/실패 일괄 처리.
  - 변경:
    1. props에 `captureMode?: CaptureMode` 추가.
    2. `handleSubmit()`의 성공 직후 `trackSubmit(platform, captureMode, "success")`, catch 블록에서 `trackSubmit(platform, captureMode, "failure")` 호출(await 안 함).
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

- **`.env.example`**
  - `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST` 항목 + 주석 추가(빈 값이면 전송 비활성).

- **`docs/privacy.md`**
  - 익명 집계 수집·전송 동작 명시(아래 위험/규정 항목 참조). 시행일 갱신.

> manifest·vite.config·권한 변경 **없음**(아래 "외부 의존성" 참조).

## 데이터 흐름

```
사용자 "제출" 클릭
  └ SubmitFieldsDialog.handleSubmit()
       ├ await onSubmit(platform)            // 기존 제출 로직(background로 createIssue)
       │    ├ 성공 → trackSubmit(platform, captureMode, "success")
       │    └ 예외 → catch → trackSubmit(platform, captureMode, "failure")
       │
       └ trackSubmit  (sidepanel, fire-and-forget)
            └ sendBg({ type:"analytics.capture", event:"issue_submitted",
                       properties:{ platform, capture_mode, result } })
                 └ background handleMessage → captureEvent()
                      └ isAnalyticsConfigured() ? fetch(POSTHOG_HOST+"/capture/") : no-op
```

- 추적 호출은 제출 결과를 기다리지 않고(=UI는 이미 onSuccess/toast 처리), 실패해도 삼킨다.
- distinct_id는 background `captureEvent`에서 매 이벤트 `crypto.randomUUID()`로 새로 생성 → 사용자 단위 연결 불가(완전 익명). 추가로 `$process_person_profile: false`를 properties에 넣어 PostHog person profile 생성을 막는다.

## 인터페이스 설계

```typescript
// src/types/messages.ts — BgRequest union에 추가
| { type: "analytics.capture"; event: string; properties: Record<string, string> }

// src/background/analytics.ts
interface PosthogCaptureBody {
  api_key: string;
  event: string;
  distinct_id: string;
  properties: Record<string, string | boolean>; // $process_person_profile: false 포함
}

export function isAnalyticsConfigured(): boolean;

export function buildCaptureBody(
  event: string,
  properties: Record<string, string>,
  distinctId: string,
): PosthogCaptureBody;

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
const POSTHOG_KEY = (import.meta.env.VITE_POSTHOG_KEY ?? "").trim();
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com")
  .trim()
  .replace(/\/+$/, "");
```

`capture_mode`가 undefined일 때(드문 legacy)는 `"unknown"`으로 채운다.

## 기존 패턴 준수

- **외부 fetch는 background에서만**: `analytics.capture` 메시지로 위임. sidepanel은 fetch하지 않는다.
- **env 게이팅**: `isAnalyticsConfigured()`는 `isOAuthConfigured()` 류 패턴 그대로. 키 없으면 기능 자동 비활성.
- **메시지 추가 패턴**: `src/types/messages.ts` union + `src/background/messages.ts` switch case 2곳 수정(기존 6개 submit 핸들러와 동일 형태).
- **순수 함수 단위 테스트**: `buildCaptureBody`, `submitEventProperties`를 `__tests__/*.test.ts`에 Vitest로 작성(CLAUDE.md 테스트 우선 원칙).
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

- **host_permissions/CORS**: PostHog `/capture/`는 `Access-Control-Allow-Origin: *`로 임의 origin 요청을 허용하므로 background fetch에 host_permission이 **불필요**하다. 일부러 host_permissions에 PostHog 도메인을 추가하면 스토어 업데이트 시 권한 재동의 프롬프트가 떠 확장이 비활성화될 수 있으므로 **추가하지 않는다**. 만약 향후 CORS가 막히면(엔드포인트 정책 변경) `manifest.config.ts`에 PostHog origin을 host_permission으로 추가하는 것이 fallback이며, 이때 privacy/PERMISSION 문서·권한 재동의 영향을 반드시 검토한다.
- **프라이버시 규정**: 새 데이터 수집·외부 전송이라 manifest diff가 0이어도 `docs/privacy.md` 갱신이 **필수**(CLAUDE.md 신선도 규칙). 수집 항목(platform, capture_mode, result), 수집 목적(집계), 익명성(식별자 미수집), 수신처(PostHog), 옵트아웃 부재를 명시하고 시행일 갱신.
- **payload 누출 방지**: `properties`에 들어가는 값은 enum성 문자열(platform/capture_mode/result)뿐이어야 한다. 에러 메시지·이슈 제목 등을 실수로 넣지 않도록 `submitEventProperties`를 단일 통로로 고정하고 테스트로 키 집합을 고정.
- **fire-and-forget 격리**: `trackSubmit`/`captureEvent` 어디서 throw해도 제출 UI에 전파되면 안 된다. `sendBg(...).catch(()=>{})` + `captureEvent` 내부 try/catch 이중 방어. 단위 테스트로 throw 격리 확인.
- **이벤트 폭증 없음**: 제출 1회당 1이벤트. 루프·리트라이 없음.
