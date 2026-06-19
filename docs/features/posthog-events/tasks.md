# PostHog 이벤트 확장 — 구현 태스크

## 선행 조건

- `PlatformId` 타입의 정확한 import 경로 확인(`src/types/` 추정). 신규 타입 만들지 말고 재사용.
- `messages.ts`의 6개 `*.startOAuth` / `*.disconnect` case가 모두 존재하는지 확인(GitHub 확인됨, 나머지 5개 동일 패턴 가정). disconnect case가 일부 없으면 해당 플랫폼은 side panel `removeAccount` 경로에서 `sendBg("analytics.capture")`로 대체(차선).
- `onConnect`에서 패널 포트(`PANEL_PORT_PREFIX`) 분기의 실제 위치 확인(`index.ts:82` 또는 `tab-bindings.ts`의 핸들러).
- 권한·env·의존성 추가 없음. 빌드 자동 실행 금지.

## 태스크

### Task 1: distinct_id 완전 익명화
- **변경 대상**: `src/background/analytics.ts`
- **작업 내용**: `const ANONYMOUS_DISTINCT_ID = "anonymous";` 추가. `captureEvent`의 `crypto.randomUUID()` → `ANONYMOUS_DISTINCT_ID` 교체. 다른 함수 불변.
- **검증**:
  - [ ] `captureEvent` 호출 시 `buildCaptureBody`에 `"anonymous"`가 distinctId로 전달됨
  - [ ] analytics 경로에 `crypto.randomUUID()` 호출 없음 (`grep`)
  - [ ] 기존 `analytics.test.ts` 통과

### Task 2: 연결 결과 분류 + 추적 래퍼 (신규 모듈)
- **변경 대상**: `src/background/connect-tracking.ts` (신규), `src/background/__tests__/connect-tracking.test.ts` (신규)
- **작업 내용**:
  - `classifyConnectResult(err): "cancelled" | "failed"` — `OAuthError`의 `cancelled` 플래그 기반(`src/lib/oauth.ts`의 클래스). 순수 함수.
  - `trackConnect(platform, run)` — `run()` 실행, 성공 시 `captureEvent("platform_connect", {platform, result:"success"})`, 실패 시 `classifyConnectResult` 후 동일 이벤트 전송 + **rethrow**.
- **검증**:
  - [ ] `classifyConnectResult(new OAuthError(..., {cancelled:true}))` → `"cancelled"`
  - [ ] `classifyConnectResult(new Error("x"))` → `"failed"`
  - [ ] `classifyConnectResult("string"|null|undefined)` → `"failed"`
  - [ ] (테스트는 순수 함수 `classifyConnectResult`에 집중. `trackConnect`는 captureEvent 모킹 비용 대비 가치 낮으면 스킵 가능)

### Task 3: 설치 이벤트
- **변경 대상**: `src/background/index.ts`
- **작업 내용**: `onInstalled(details)` 핸들러에 `if (details.reason === "install") void captureEvent("extension_installed", { version: chrome.runtime.getManifest().version });` 추가. 기존 호출 유지.
- **검증**:
  - [ ] reason `"install"`일 때만 발화 (`"update"` 제외)
  - [ ] `pnpm typecheck` 통과

### Task 4: 패널 열림 이벤트
- **변경 대상**: `src/background/index.ts` (또는 `tab-bindings.ts`의 패널 포트 핸들러)
- **작업 내용**: `onConnect`에서 `port.name`이 `PANEL_PORT_PREFIX`로 시작하는 분기 **안쪽**에 `void captureEvent("sidepanel_opened", {})` 추가. picker 등 다른 포트와 섞이지 않게 분기 위치 정확히.
- **검증**:
  - [ ] picker 포트 연결 시에는 발화 안 함
  - [ ] 패널 포트 연결마다 1회 발화
  - [ ] `pnpm typecheck` 통과

### Task 5: 플랫폼 연결 추적 (6개 startOAuth case)
- **변경 대상**: `src/background/messages.ts`
- **작업 내용**: 6개 `case "*.startOAuth": return startXxxOAuth();`를 `return trackConnect("<platform>", () => startXxxOAuth());`로 교체.
- **검증**:
  - [ ] 실제 탭에서 한 플랫폼 연결 성공 → `platform_connect` result="success"
  - [ ] OAuth 창 취소 → result="cancelled", side panel 토스트 억제 동작 유지
  - [ ] 6개 플랫폼 모두 동일 패턴 적용
  - [ ] 에러가 정상 rethrow되어 기존 toast 동작 보존

### Task 6: 플랫폼 해제 추적 (6개 disconnect case)
- **변경 대상**: `src/background/messages.ts`
- **작업 내용**: 6개 `case "*.disconnect"`에 `void captureEvent("platform_disconnected", { platform: "<platform>" });` 추가. 반환값 불변.
- **검증**:
  - [ ] 연결 해제 시 `platform_disconnected` 발화, platform 정확
  - [ ] disconnect 동작(removeAccount) 회귀 없음

### Task 7: privacy.md 갱신
- **변경 대상**: `docs/privacy.md`
- **작업 내용**: 익명 분석 수집 항목에 신규 이벤트(설치·패널 오픈·플랫폼 연결/해제) 반영. distinct_id가 식별자가 아닌 고정 더미값(`"anonymous"`)임을 명시. 시행일 bump.
- **검증**:
  - [ ] 수집하는 이벤트 종류가 실제 코드와 일치
  - [ ] 시행일 갱신

## 테스트 계획

- **단위 테스트**: `connect-tracking.test.ts` — `classifyConnectResult`의 cancelled/failed/non-Error 케이스. 기존 `analytics.test.ts`는 distinct_id 상수화 후에도 통과 확인(필요 시 distinctId 기대값 갱신).
- **e2e 시나리오**: 자동화 가치 낮음. PostHog 전송은 외부 네트워크 fire-and-forget이고 OAuth는 e2e에서 실제 인증이 어려움. **e2e 영향: 없음.**
- **수동 테스트** (Chrome, `VITE_POSTHOG_KEY` 설정된 빌드 또는 네트워크 탭으로 `/capture/` 페이로드 확인):
  - [ ] 새 설치 → `extension_installed` 1회, distinct_id="anonymous"
  - [ ] 패널 열기 → `sidepanel_opened`
  - [ ] 한 플랫폼 연결 성공/취소 → `platform_connect` result 정확
  - [ ] 연결 해제 → `platform_disconnected`
  - [ ] `issue_submitted` 포함 모든 이벤트 distinct_id="anonymous" 동일

## 구현 순서 권장

1. **Task 1** (distinct_id) — 독립, 먼저.
2. **Task 2** (connect-tracking 모듈 + 테스트) — Task 5의 선행.
3. **Task 3·4** (설치·패널) — Task 1만 의존, 서로 병렬 가능.
4. **Task 5** (연결) — Task 2 의존.
5. **Task 6** (해제) — 독립.
6. **Task 7** (privacy.md) — 구현 완료 후.

Task 3·4·6은 서로 병렬 가능.

## 가이드 영향

없음 (사용자 비노출 백그라운드 텔레메트리, UI 변화 없음).
