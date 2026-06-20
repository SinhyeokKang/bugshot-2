# PostHog 이벤트 확장 — 기술 설계

## 개요

측정 코드를 모두 **background service worker**에 둔다. `captureEvent`는 이미 background 전용이고, 추가하려는 4개 이벤트의 트리거(설치·패널 포트 연결·OAuth 토큰 교환·disconnect)가 전부 background에서 관측 가능하므로 side panel을 거치는 메시지 왕복이 거의 필요 없다(예외: Jira disconnect — 아래 참조). `distinct_id`는 `chrome.storage.local`에 1회 저장하는 **설치 단위 익명 random UUID**로 통일해 매-이벤트 `randomUUID()` 발급을 폐지한다.

## 변경 범위

### `src/background/analytics.ts` (변경)
- 현재 역할: PostHog capture 래퍼. `captureEvent`(L57)가 `crypto.randomUUID()`(L65)로 매 이벤트 distinct_id 발급. `buildCaptureBody`(L22, 시그니처 `(event, properties, distinctId, apiKey)`)는 distinctId를 받아 패스스루.
- 변경 내용:
  - 설치 단위 ID 해석 순수 함수 `resolveInstallationId(stored, generate)` 추가(아래 인터페이스).
  - async 헬퍼 `getInstallationId()` 추가: `chrome.storage.local`에서 `INSTALL_ID_KEY`를 읽어 `resolveInstallationId`에 넘기고, 신규 생성된 경우에만 저장 후 id 반환.
  - `captureEvent`에서 `crypto.randomUUID()` → `await getInstallationId()`로 교체. 시그니처 불변(`event`, `properties`). 이미 `async`이므로 await 추가만.
  - `buildCaptureBody` / `postCapture` / `analyticsEnabled` / 익명화 속성은 그대로.
- **부수효과(명시)**: distinct_id 발급 지점이 `captureEvent`(L65) 단일 지점이므로, 이 변경은 `issue_submitted`를 포함한 **모든 이벤트의 distinct_id 동작을 함께 바꾼다**(매-이벤트 UUID → 설치 단위 ID). 의도된 동작.

### `src/background/index.ts` (변경)
- 현재 역할: SW 진입점. `chrome.runtime.onInstalled`(L67, 현재 `addListener(() => {...})` — **details 인자 안 받음**), `chrome.runtime.onConnect`(L82), 기타 리스너 등록.
- 변경 내용:
  - `onInstalled` 콜백 시그니처를 `(details) =>`로 변경하고 `if (details.reason === "install") void captureEvent("extension_installed", { version: chrome.runtime.getManifest().version });` 추가. 기존 `disableGlobalSidePanel()` / `setupContextMenu()` 호출은 유지.
  - 패널 포트 연결 분기는 **index.ts:82-103에 인라인**(tab-bindings.ts 아님 — tab-bindings는 `stopRecorders(tabId)` 호출로만 관여). `onConnect`에서 `port.name`이 `PANEL_PORT_PREFIX`로 시작하고 `tabId` NaN 가드를 통과한 직후(약 index.ts:84)에 `void captureEvent("sidepanel_opened", {})` 추가.

### `src/background/messages.ts` (변경)
- 현재 역할: `onMessage` 디스패처(~537줄). OAuth start case: **Jira만 `case "oauth.start"`(L161, `startOAuthFlow()` 반환)**, 나머지 5개는 `case "{platform}.startOAuth"`(github/linear/notion/gitlab/asana). disconnect case는 **5개만** 존재(L220/283/339/385/461 = github/linear/notion/gitlab/asana, `{ ok: true }` 반환). **Jira disconnect case는 없음.**
- 변경 내용:
  - 6개 OAuth start case를 `trackConnect("<platform>", () => startXxxOAuth())`로 감싼다. **platform 인자는 case별로 명시 매핑**(case명에서 기계 파생 불가). Jira는 `trackConnect("jira", () => startOAuthFlow())`.
  - 기존 5개 disconnect case에 `void captureEvent("platform_disconnected", { platform })` 추가. 반환값(`{ ok: true }`) 불변.
  - **`case "jira.disconnect"` 신규 추가**(`{ ok: true }` 반환 + `void captureEvent("platform_disconnected", { platform: "jira" })`). 메시지 타입(`types/messages.ts`)·`bgRequestTypes.ts` 화이트리스트에 `jira.disconnect` 등록. side panel `JiraConnectForm`의 연결 해제 핸들러가 `removeAccount("jira")` 직전/직후에 `sendBg({ type: "jira.disconnect" })`를 호출하도록 한 줄 추가(다른 플랫폼 ConnectForm이 disconnect 메시지를 보내는 기존 패턴과 동일하게 맞춤).

### `src/background/connect-tracking.ts` (신규)
- 역할: OAuth 결과 분류 + 추적 래퍼. background에 둔다.
  - `classifyConnectResult(err: unknown): "cancelled" | "failed"` — 순수 함수. `import { OAuthError } from "./oauth"`(클래스는 `src/background/oauth.ts:25`, `cancelled` 플래그는 생성자에서 `options.cancelled ?? false`). `err instanceof OAuthError && err.cancelled` → `"cancelled"`, 그 외(일반 Error, raw TypeError "Failed to fetch", non-Error 값 포함) → `"failed"`.
  - `trackConnect<T>(platform, run): Promise<T>` — `run()` 실행, 성공 시 `captureEvent("platform_connect", { platform, result:"success" })` 후 결과 반환, 실패 시 `captureEvent(..., { platform, result: classifyConnectResult(err) })` 후 **원본 에러 객체를 그대로 rethrow(감싸기 금지)**.

> 신규 파일 근거: `classifyConnectResult`를 순수 함수로 분리해 단위 테스트(CLAUDE.md "테스트 우선"). `messages.ts`는 거대 디스패처라 테스트 진입점으로 부적합. `trackConnect`도 6개 case에서 재사용되므로 헬퍼화 정당.

## 데이터 흐름

```
[설치]      onInstalled(details.reason="install")
              → captureEvent("extension_installed", {version})
[패널 열림]  onConnect(port.name=PANEL_PORT_PREFIX+tabId), tabId 가드 통과
              → captureEvent("sidepanel_opened", {})
[연결]      onMessage("github.startOAuth" | ... | "oauth.start"(jira))
              → trackConnect("<platform>", startXxxOAuth)
                  성공 → captureEvent("platform_connect", {platform, result:"success"}) → return auth
                  실패 → captureEvent(..., result: classifyConnectResult(err)) → throw err(원본)
[해제]      onMessage("{platform}.disconnect" | "jira.disconnect"(신규))
              → captureEvent("platform_disconnected", {platform}) → {ok:true}

모든 captureEvent → distinctId = await getInstallationId()
              → buildCaptureBody(event, props, distinctId, key) → postCapture
getInstallationId: storage.local[INSTALL_ID_KEY] 읽기
              → resolveInstallationId(stored, crypto.randomUUID)
              → created면 storage.local에 저장 → id 반환
```

이벤트는 fire-and-forget(`void`). PostHog 실패는 콘솔 경고만(기존 `postCapture` 동작).

## 인터페이스 설계

```typescript
// src/background/analytics.ts
const INSTALL_ID_KEY = "bugshot:install-id";

// 순수 함수 (테스트 대상)
export function resolveInstallationId(
  stored: string | undefined,
  generate: () => string,
): { id: string; created: boolean } {
  // stored 유효 → {id: stored, created: false}
  // 그 외 → {id: generate(), created: true}
}

// async 헬퍼 (chrome.storage.local I/O)
async function getInstallationId(): Promise<string>;
// captureEvent 내부: buildCaptureBody(event, properties, await getInstallationId(), key)

// src/background/connect-tracking.ts (신규)
import { OAuthError } from "./oauth";
import type { PlatformId } from "@/types/...";   // 실제 경로는 oauth.ts의 PlatformId import에서 확인

export function classifyConnectResult(err: unknown): "cancelled" | "failed";
export function trackConnect<T>(platform: PlatformId, run: () => Promise<T>): Promise<T>;
```

이벤트별 프로퍼티(모두 `Record<string, string>`):

| 이벤트 | properties |
|---|---|
| `extension_installed` | `{ version: string }` |
| `sidepanel_opened` | `{}` |
| `platform_connect` | `{ platform: PlatformId, result: "success" \| "cancelled" \| "failed" }` |
| `platform_disconnected` | `{ platform: PlatformId }` |

## 기존 패턴 준수

- **이벤트명·프로퍼티 snake_case** — 기존 `issue_submitted` / `capture_mode` / `result` 컨벤션 유지. `result` 패턴도 `issue_submitted`(`success|failure`)와 일관(연결은 `success|cancelled|failed`).
- **captureEvent는 background 전용** — 신규 호출 대부분 background. 예외(Jira disconnect)는 기존 ConnectForm→bg 메시지 패턴(다른 5개 플랫폼 disconnect와 동일)을 그대로 따른다.
- **chrome.storage.local 사용** — 기존 `src/lib/settings-storage.ts`(키 `bugshot-settings`)와 동일한 storage 영역. 단순 단일 키라 별도 envelope 헬퍼 없이 `chrome.storage.local.get/set` 직접 사용.
- **익명화 속성 유지** — `buildCaptureBody`가 항상 `$process_person_profile/$ip/$geoip_disable` 부착.
- **순수 함수 단위 테스트** — `resolveInstallationId`, `classifyConnectResult`를 의존성 없는 순수 함수로 분리(기존 `buildCaptureBody` 테스트 패턴과 동일).

## 대안 검토

1. **완전 익명: distinct_id="anonymous" 고정** — 매-이벤트 UUID를 폐지하되 식별자 없이 단일 상수 사용. PII 0이지만 unique user 분모가 죽어 활성화율·플랫폼 인기도 **비율 계산이 불가**(이벤트 볼륨/순위만). funnel·취소율 분포는 가능하나 활성화율을 측정하지 못함. → 익명 random UUID로 분모를 복원하는 편이 PRD 목표(비율 측정)를 충족하면서도 PII가 없어 우월. **기각**.
2. **side panel ConnectForm 6곳에 추적 삽입** — 6개 파일을 건드리고 React↔bg 메시지 추가. background OAuth case에 수렴시키는 편이 외과적·single-source. **기각**(단 Jira disconnect는 background case가 없어 부득이 ConnectForm 한 줄 추가).
3. **`platform_connect` 성공/실패를 별도 이벤트명으로 분리** — 단일 이벤트 + `result` 프로퍼티가 기존 `issue_submitted` 컨벤션과 일관·단순. **기각**.
4. **설치 ID를 onInstalled에서만 생성** — 업데이트로 진입한 기존 사용자(install 이벤트 미수신)는 ID가 없어 누락. `captureEvent`에서 lazy get-or-create하면 모든 진입을 커버. **lazy 채택**.

## 위험 요소

- **`trackConnect`의 rethrow 누락 (회귀 1순위)** — 실패 시 반드시 **원본 에러 객체를 감싸지 않고** 다시 던져야 한다. 사이드패널 ConnectForm은 `catch (err) { if (!isOAuthCancelled(err)) toast.error(...) }` 구조이며, `isOAuthCancelled`는 background가 직렬화한 `OAuthError(cancelled:true)` → `body.oauthCancelled`(index.ts:226 부근) 체인을 읽는다. 에러를 삼키거나 다른 에러로 감싸면 (1) 취소가 실패로 오인되어 **불필요한 에러 토스트**, (2) Jira의 `NoJiraSitesError` 전용 안내 토스트/“switch account” 액션 유실.
- **설치 ID 생성 race** — 첫 두 이벤트가 거의 동시에 발화하면 둘 다 생성→마지막 `set`이 이긴다. distinct_id가 한 번 갈릴 수 있으나 실질 무해(직후 동일 ID로 수렴). 단순 lazy get-or-create로 둔다(락 없음).
- **`extension_installed` / `platform_connect{failed}` 유실** — MV3 SW가 fetch in-flight 중 종료되면 fire-and-forget 이벤트 유실 가능. best-effort 허용(익명이라 재시도 dedup 불가). 설계상 수용.
- **privacy.md 게이트** — 설치 단위 **persistent 익명 식별자 저장**(chrome.storage.local) + 신규 수집 이벤트는 manifest diff가 0이어도 수집·저장 동작이 늘어난 것. `docs/privacy.md` 대조·갱신 필요(식별자 성격 명시 + 시행일). CLAUDE.md privacy 게이트 해당.
- **PlatformId import 경로** — 신규 모듈에서 기존 타입 재사용(신규 타입 생성 금지). 실제 경로는 `src/background/oauth.ts`의 `PlatformId` import에서 확인.
- **`jira.disconnect` 신규 메시지 누락 지점** — 타입 정의(`types/messages.ts`) + `bgRequestTypes.ts` 화이트리스트 + JiraConnectForm 호출부, 세 곳을 함께 추가해야 동작(한 곳 빠지면 무음 실패).
