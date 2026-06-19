# PostHog 이벤트 확장 — 구현 태스크

## 선행 조건

- `PlatformId` 타입의 실제 import 경로 확인 — `src/background/oauth.ts`가 이미 `PlatformId`를 import하므로 거기서 경로 확인. 신규 타입 생성 금지.
- `messages.ts` case 현황(검증됨): OAuth start는 Jira만 `case "oauth.start"`(L161, `startOAuthFlow()`), 나머지 5개는 `{platform}.startOAuth`. disconnect는 **5개만**(github L220 / linear L283 / notion L339 / gitlab L385 / asana L461), **Jira 없음**.
- `OAuthError`는 `src/background/oauth.ts:25`(생성자 `constructor(message, options={})`, `this.cancelled = options.cancelled ?? false`). import는 `./oauth`. `src/lib/oauth.ts`는 없음.
- `onInstalled` 콜백은 현재 `() => {...}`(index.ts:67) — details 인자 추가 필요. 패널 포트 분기는 index.ts:82-103 인라인, `sidepanel_opened`는 약 index.ts:84.
- 권한·env·의존성 추가 없음. 빌드 자동 실행 금지.

## 태스크

### Task 1: 설치 단위 익명 ID 도입
- **변경 대상**: `src/background/analytics.ts`, `src/background/__tests__/analytics.test.ts`
- **작업 내용**:
  - `const INSTALL_ID_KEY = "bugshot:install-id";`
  - 순수 함수 `resolveInstallationId(stored, generate)` export: stored가 유효 문자열이면 `{id: stored, created: false}`, 아니면 `{id: generate(), created: true}`.
  - async `getInstallationId()`: `chrome.storage.local.get(INSTALL_ID_KEY)` → `resolveInstallationId(stored, crypto.randomUUID)` → `created`면 `chrome.storage.local.set` → id 반환.
  - `captureEvent`의 `crypto.randomUUID()` → `await getInstallationId()`로 교체. 시그니처 불변.
  - `ANONYMOUS_*` 같은 고정 상수는 쓰지 않는다(완전 익명 안이 기각됐으므로).
- **검증**:
  - [ ] `resolveInstallationId("abc", gen)` → `{id:"abc", created:false}` (gen 미호출)
  - [ ] `resolveInstallationId(undefined, () => "new")` → `{id:"new", created:true}`
  - [ ] `resolveInstallationId("", gen)` → 빈 문자열은 무효 취급 → `created:true`
  - [ ] analytics 경로의 distinct_id 발급이 `getInstallationId` 단일 지점 경유 (`grep`로 매-이벤트 randomUUID 부재 확인)
  - [ ] 기존 `analytics.test.ts`(buildCaptureBody/postCapture 패스스루 단언)는 영향 없이 통과

### Task 2: 연결 결과 분류 + 추적 래퍼 (신규 모듈)
- **변경 대상**: `src/background/connect-tracking.ts` (신규), `src/background/__tests__/connect-tracking.test.ts` (신규)
- **작업 내용**:
  - `classifyConnectResult(err): "cancelled" | "failed"` — `import { OAuthError } from "./oauth"`. `err instanceof OAuthError && err.cancelled` → `"cancelled"`, 그 외 → `"failed"`.
  - `trackConnect(platform, run)` — `run()` 실행, 성공 시 `captureEvent("platform_connect", {platform, result:"success"})`, 실패 시 `classifyConnectResult` 후 동일 이벤트 전송 + **원본 에러 그대로 rethrow(감싸기 금지)**.
- **검증**:
  - [ ] `classifyConnectResult(new OAuthError("x", {cancelled:true}))` → `"cancelled"`
  - [ ] `classifyConnectResult(new OAuthError("x", {cancelled:false}))` → `"failed"`
  - [ ] `classifyConnectResult(new Error("x"))` / `new TypeError("Failed to fetch")` → `"failed"`
  - [ ] `classifyConnectResult("string" | null | undefined)` → `"failed"`
  - [ ] **trackConnect rethrow 테스트(스킵 금지)**: captureEvent를 mock하고, run이 던진 OAuthError(cancelled)와 raw TypeError가 **동일 객체로 rethrow**되는지(`await expect(...).rejects.toBe(원본)`) + 각각 result="cancelled"/"failed"로 captureEvent 호출됐는지 단언
  - [ ] 성공 시 run 반환값 그대로 반환 + result="success" 단언

### Task 3: 설치 이벤트
- **변경 대상**: `src/background/index.ts`
- **작업 내용**: `onInstalled` 콜백을 `(details) =>`로 변경, `if (details.reason === "install") void captureEvent("extension_installed", { version: chrome.runtime.getManifest().version });` 추가. 기존 `disableGlobalSidePanel()`/`setupContextMenu()` 유지.
- **검증**:
  - [ ] reason `"install"`일 때만 발화 (`"update"`/`"chrome_update"` 제외)
  - [ ] 기존 onInstalled 동작(사이드패널 비활성화·컨텍스트 메뉴) 회귀 없음
  - [ ] `pnpm typecheck` 통과

### Task 4: 패널 열림 이벤트
- **변경 대상**: `src/background/index.ts` (L82-103 인라인 핸들러)
- **작업 내용**: `onConnect`에서 `port.name`이 `PANEL_PORT_PREFIX`로 시작하고 `tabId` NaN 가드를 통과한 직후(약 L84)에 `void captureEvent("sidepanel_opened", {})` 추가. picker 등 다른 포트와 섞이지 않게 분기 안쪽에.
- **검증**:
  - [ ] picker 포트 연결 시에는 발화 안 함
  - [ ] 패널 포트 1회 연결 = 1회 발화(멱등 — onConnect 재진입 중복 없음)
  - [ ] 멀티탭 동시 사용 시 탭 수만큼 발화(의도 동작 확인)
  - [ ] `pnpm typecheck` 통과

### Task 5: 플랫폼 연결 추적 (6개 OAuth start case)
- **변경 대상**: `src/background/messages.ts`
- **작업 내용**: 5개 `case "{platform}.startOAuth": return startXxxOAuth();`를 `return trackConnect("<platform>", () => startXxxOAuth());`로 교체. **Jira는 `case "oauth.start"`(L161)** → `return trackConnect("jira", () => startOAuthFlow());`. platform 인자는 case별 명시 매핑.
- **검증**:
  - [ ] 실제 탭에서 한 플랫폼 연결 성공 → `platform_connect` result="success"
  - [ ] OAuth 창 취소 → result="cancelled", 6개 플랫폼 모두 side panel 토스트 억제 동작 유지
  - [ ] **Jira `NoJiraSitesError` 전용 안내 토스트·"switch account" 액션 보존**(에러 감싸기 없이 rethrow 확인)
  - [ ] 토큰 교환/네트워크 실패 → result="failed", 에러 토스트 정상
  - [ ] 6개 플랫폼(Jira 포함) 모두 적용

### Task 6: 플랫폼 해제 추적 (5개 disconnect case + Jira 신규)
- **변경 대상**: `src/background/messages.ts`, `src/types/messages.ts`, `src/background/bgRequestTypes.ts`, `src/sidepanel/tabs/connect/JiraConnectForm.tsx`
- **작업 내용**:
  - 기존 5개 `case "{platform}.disconnect"`에 `void captureEvent("platform_disconnected", { platform })` 추가. 반환값 불변.
  - **`case "jira.disconnect"` 신규**: `{ ok: true }` 반환 + `void captureEvent("platform_disconnected", { platform: "jira" })`. `types/messages.ts`에 `jira.disconnect` 타입 + `bgRequestTypes.ts` 화이트리스트 등록. `JiraConnectForm`의 연결 해제 핸들러(`removeAccount("jira")` 부근)에 `sendBg({ type: "jira.disconnect" })` 한 줄 추가.
- **검증**:
  - [ ] 5개 플랫폼 해제 시 `platform_disconnected` 발화, platform 정확
  - [ ] **Jira 해제 시 `jira.disconnect` 메시지 발화 → `platform_disconnected` {platform:"jira"}**
  - [ ] disconnect 동작(removeAccount, 토큰/필드 정리) 회귀 없음 (Jira 포함)
  - [ ] `pnpm typecheck` 통과 (신규 메시지 타입 등록 누락 없음)

### Task 7: privacy.md 갱신
- **변경 대상**: `docs/privacy.md`
- **작업 내용**: 익명 분석 수집 항목에 신규 이벤트(설치·패널 오픈·플랫폼 연결/해제) + **설치 단위 익명 식별자(random UUID, chrome.storage.local 저장, PII 아님, 어떤 PII와도 연결 안 됨)** 명시. 시행일 bump.
- **검증**:
  - [ ] 수집 이벤트·저장 식별자가 실제 코드와 일치
  - [ ] 식별자가 익명(무작위, 비-PII)임을 명시
  - [ ] 시행일 갱신

## 테스트 계획

- **단위 테스트**:
  - `analytics.test.ts` — `resolveInstallationId`의 stored-hit / 미보유-생성 / 빈문자열-무효 케이스. 기존 buildCaptureBody/postCapture 단언은 그대로 통과.
  - `connect-tracking.test.ts` — `classifyConnectResult`의 OAuthError(cancelled/non-cancelled)/일반Error/TypeError/non-Error 케이스 + `trackConnect`의 rethrow(원본 객체 동일성)·result 분류·성공 반환값.
- **e2e 시나리오**: 자동화 가치 낮음. 외부 PostHog는 fire-and-forget, OAuth 실인증은 e2e 곤란. **e2e 영향: 없음.**
- **수동 테스트** (Chrome, `VITE_POSTHOG_KEY` 설정 빌드 또는 네트워크 탭 `/capture/` 페이로드 확인):
  - [ ] 새 설치 → `extension_installed` 1회, distinct_id가 UUID 형태
  - [ ] SW 재기동/확장 재시작 후 다른 이벤트 → **distinct_id 동일** 유지
  - [ ] 패널 열기 → `sidepanel_opened`
  - [ ] 한 플랫폼 연결 성공/취소/실패 → `platform_connect` result 정확
  - [ ] Jira 포함 연결 해제 → `platform_disconnected`
  - [ ] `issue_submitted` 포함 모든 이벤트의 distinct_id가 동일 설치 ID

## 구현 순서 권장

1. **Task 1** (설치 ID + analytics) — 독립, 먼저.
2. **Task 2** (connect-tracking 모듈 + 테스트) — Task 5의 선행.
3. **Task 3·4** (설치·패널) — Task 1만 의존, 서로 병렬 가능.
4. **Task 5** (연결) — Task 2 의존.
5. **Task 6** (해제, Jira 신규 메시지 포함) — 독립이나 메시지 타입 등록 주의.
6. **Task 7** (privacy.md) — 구현 완료 후.

Task 3·4·6은 서로 병렬 가능.

## 가이드 영향

없음 (사용자 비노출 백그라운드 텔레메트리, UI 변화 없음). 고지 UI는 이번 스코프 밖(별도 백로그).
