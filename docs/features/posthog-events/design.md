# PostHog 이벤트 확장 — 기술 설계

## 개요

측정 코드를 모두 **background service worker**에 둔다. `captureEvent`는 이미 background 전용이고, 추가하려는 4개 이벤트의 트리거(설치·패널 포트 연결·OAuth 토큰 교환·disconnect)가 전부 background에서 관측 가능하므로 side panel을 거치는 메시지 왕복이 필요 없다. `distinct_id`는 고정 상수 `"anonymous"`로 통일해 `randomUUID()` 의존을 제거한다.

## 변경 범위

### `src/background/analytics.ts` (변경)
- 현재 역할: PostHog capture 래퍼. `captureEvent`가 `crypto.randomUUID()`로 매 이벤트 distinct_id 발급.
- 변경 내용:
  - 파일 상단에 `const ANONYMOUS_DISTINCT_ID = "anonymous";` 추가.
  - `captureEvent`에서 `crypto.randomUUID()` → `ANONYMOUS_DISTINCT_ID`로 교체. 시그니처 불변(`event`, `properties`). `buildCaptureBody`는 이미 `distinctId` 파라미터를 받으므로 호출부만 수정.
  - `buildCaptureBody` / `postCapture` / `analyticsEnabled` / 익명화 속성은 그대로.

### `src/background/index.ts` (변경)
- 현재 역할: SW 진입점. `chrome.runtime.onInstalled`(L67), `chrome.runtime.onConnect`(L82), 기타 리스너 등록.
- 변경 내용:
  - `onInstalled` 핸들러에 `details.reason === "install"` 분기 추가 → `void captureEvent("extension_installed", { version: chrome.runtime.getManifest().version })`. 기존 `disableGlobalSidePanel()` / `setupContextMenu()` 호출은 유지.
  - 패널 포트 연결 감지 지점(`onConnect`에서 `port.name`이 `PANEL_PORT_PREFIX`로 시작하는 분기, 현재 `tab-bindings.ts`의 핸들러로 라우팅됨)에 `void captureEvent("sidepanel_opened", {})` 추가. 측정 1줄을 어디에 둘지는 Task에서 확정(아래 "데이터 흐름" 참조).

### `src/background/messages.ts` (변경)
- 현재 역할: `onMessage` 디스패처. `case "*.startOAuth"`가 각 `startXxxOAuth()`를 그대로 반환(L139~), `case "*.disconnect"`가 `{ ok: true }` 반환(L220~).
- 변경 내용:
  - 6개 `*.startOAuth` case를 공통 헬퍼 `trackConnect(platform, () => startXxxOAuth())`로 감싼다. 성공 시 `platform_connect` { platform, result:"success" }, 예외 시 `classifyConnectResult(err)`로 `"cancelled"|"failed"` 판정 후 동일 이벤트 전송하고 **에러를 rethrow**(기존 side panel 토스트/취소 처리 동작 보존).
  - 6개 `*.disconnect` case에 `void captureEvent("platform_disconnected", { platform })` 추가. 반환값(`{ ok: true }`)은 불변.

### `src/background/connect-tracking.ts` (신규)
- 역할: OAuth 결과 분류 + 추적 래퍼를 모은 작은 모듈. background에 둔다.
  - `classifyConnectResult(err: unknown): "cancelled" | "failed"` — 순수 함수. `OAuthError`의 `cancelled` 플래그로 판정(`oauth.ts:20`의 클래스 활용), 그 외 `"failed"`.
  - `trackConnect<T>(platform: PlatformId, run: () => Promise<T>): Promise<T>` — `run()`을 실행, 성공/실패에 따라 `captureEvent("platform_connect", { platform, result })` 호출 후 결과 반환 또는 rethrow.

> 신규 파일을 별도로 두는 이유: `classifyConnectResult`를 순수 함수로 분리해 단위 테스트하기 위함. `messages.ts`는 거대 디스패처라 테스트 진입점으로 부적합.

## 데이터 흐름

```
[설치]      onInstalled(reason="install")
              → captureEvent("extension_installed", {version})
[패널 열림]  onConnect(port.name=PANEL_PORT_PREFIX+tabId)
              → captureEvent("sidepanel_opened", {})
[연결]      onMessage("github.startOAuth")
              → trackConnect("github", startGithubOAuth)
                  성공 → captureEvent("platform_connect", {platform:"github", result:"success"}) → return auth
                  실패 → captureEvent(..., result: classifyConnectResult(err)) → throw err
[해제]      onMessage("github.disconnect")
              → captureEvent("platform_disconnected", {platform:"github"}) → {ok:true}

모든 captureEvent → buildCaptureBody(event, props, "anonymous", key) → postCapture
```

이벤트는 fire-and-forget(`void`). PostHog 실패는 콘솔 경고만(기존 `postCapture` 동작).

## 인터페이스 설계

```typescript
// src/background/analytics.ts
const ANONYMOUS_DISTINCT_ID = "anonymous";
// captureEvent 내부: buildCaptureBody(event, properties, ANONYMOUS_DISTINCT_ID, key)

// src/background/connect-tracking.ts (신규)
import type { PlatformId } from "@/types/...";   // 기존 PlatformId 타입 재사용

export type ConnectResult = "success" | "cancelled" | "failed";

export function classifyConnectResult(err: unknown): "cancelled" | "failed";

export function trackConnect<T>(
  platform: PlatformId,
  run: () => Promise<T>,
): Promise<T>;
```

이벤트별 프로퍼티(모두 `Record<string, string>`):

| 이벤트 | properties |
|---|---|
| `extension_installed` | `{ version: string }` |
| `sidepanel_opened` | `{}` |
| `platform_connect` | `{ platform: PlatformId, result: "success" \| "cancelled" \| "failed" }` |
| `platform_disconnected` | `{ platform: PlatformId }` |

## 기존 패턴 준수

- **이벤트명·프로퍼티 snake_case** — 기존 `issue_submitted` / `capture_mode` / `result` 컨벤션 유지. `result` 프로퍼티 패턴도 `issue_submitted`(`success|failure`)와 일관(연결은 `success|cancelled|failed`).
- **captureEvent는 background 전용** — 모든 신규 호출이 background에서 발생. side panel 메시지 경로 불필요.
- **익명화 속성 유지** — `buildCaptureBody`가 항상 `$process_person_profile/$ip/$geoip_disable` 부착.
- **순수 함수 단위 테스트** — `classifyConnectResult`를 의존성 없는 순수 함수로 분리(기존 `buildCaptureBody` 테스트 패턴과 동일).
- **fire-and-forget `void`** — 기존 `captureEvent` 호출 스타일.

## 대안 검토

1. **설치 단위 persistent 익명 ID (`chrome.storage.local`)** — funnel 분석이 가능하지만 "완전 익명" 요구와 충돌. 폐지.
2. **side panel ConnectForm 6곳에 추적 삽입** — 가능하나 6개 파일을 건드리고 React↔background 메시지가 추가됨. background `messages.ts`의 OAuth case에 수렴시키는 편이 외과적이고 single-source. 채택.
3. **`platform_connect` 성공/실패를 별도 이벤트명으로 분리(`platform_connected` / `platform_connect_failed`)** — funnel 없이 볼륨만 보는 스코프에선 단일 이벤트 + `result` 프로퍼티가 기존 `issue_submitted` 컨벤션과 일관되고 단순. 채택.

## 위험 요소

- **`trackConnect`의 rethrow 누락 주의** — 실패 시 반드시 원래 에러를 다시 던져야 side panel의 취소 토스트 억제(`isOAuthCancelled`)·에러 토스트가 기존대로 동작. 회귀 1순위.
- **`sidepanel_opened` 노이즈** — 패널 포트는 탭마다·재오픈마다 연결되므로 이벤트가 다소 부풀 수 있음. 의도된 동작(세션당 1회 제약 안 둠)이나, 측정 줄을 `onConnect`의 `PANEL_PORT_PREFIX` 분기 **안쪽**(다른 포트는 제외)에 정확히 둬야 picker 포트 등과 섞이지 않음.
- **`onInstalled` reason 분기** — `"install"`만 카운트. `"update"`/`"chrome_update"` 제외 확인.
- **privacy.md 게이트** — 새 익명 이벤트(연결 플랫폼·설치·패널 오픈)는 manifest diff가 0이어도 수집 동작이 늘어난 것. `docs/privacy.md` 대조·갱신 필요(시행일 포함). CLAUDE.md privacy 게이트 해당.
- **PlatformId import 경로** — 신규 모듈에서 기존 타입을 재사용하되 새 타입을 만들지 말 것.
