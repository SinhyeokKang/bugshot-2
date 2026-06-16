# PostHog 이슈 제출 집계 — 구현 태스크

## 선행 조건

- PostHog 프로젝트 생성 후 **Project API Key**(write-only, 공개 가능) 확보.
- PostHog 호스트 결정(US: `https://us.i.posthog.com` / EU: `https://eu.i.posthog.com`).
- `.env.local`에 `VITE_POSTHOG_KEY`, (필요 시) `VITE_POSTHOG_HOST` 설정. 미설정이면 기능은 no-op으로 동작(전송 안 함).
- 권한·매니페스트 변경 없음(CORS 의존, design.md 위험 요소 참조).

## 태스크

### Task 1: env 항목 추가
- **변경 대상**: `.env.example`
- **작업 내용**: `VITE_POSTHOG_KEY=`, `VITE_POSTHOG_HOST=`(기본값 주석으로 `https://us.i.posthog.com`) 항목과 "빈 값이면 익명 집계 전송 비활성" 주석 추가.
- **검증**:
  - [ ] `.env.example`에 두 키가 존재하고 주석이 정책을 설명한다.

### Task 2: PostHog 전송 모듈 (background)
- **변경 대상**: `src/background/analytics.ts` (신규)
- **작업 내용**:
  - `POSTHOG_KEY`, `POSTHOG_HOST` 상수(`import.meta.env`에서 trim/슬래시 제거, host 기본값 포함).
  - `isAnalyticsConfigured(): boolean`.
  - `buildCaptureBody(event, properties, distinctId): PosthogCaptureBody` — `{ api_key, event, distinct_id, properties: { ...properties, $process_person_profile: false } }` 반환(순수 함수).
  - `captureEvent(event, properties): Promise<void>` — 키 없으면 return. 있으면 `crypto.randomUUID()`로 distinct_id 만들고 `fetch(POSTHOG_HOST + "/capture/", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(buildCaptureBody(...)) })`. 전체 try/catch로 감싸 실패 시 `console.warn`만.
- **검증**:
  - [ ] (Task 7) `buildCaptureBody` 단위 테스트 통과: api_key 세팅, `$process_person_profile:false` 포함, properties 병합.
  - [ ] (Task 7) 키 미설정 시 `isAnalyticsConfigured()===false`, `captureEvent`가 fetch 호출 안 함.
  - [ ] `captureEvent`가 어떤 입력에도 reject하지 않는다(throw 격리).

### Task 3: 메시지 타입 + 라우팅
- **변경 대상**: `src/types/messages.ts`, `src/background/messages.ts`
- **작업 내용**:
  - `BgRequest` union에 `{ type: "analytics.capture"; event: string; properties: Record<string, string> }` 추가.
  - `handleMessage()` switch에 `case "analytics.capture": return captureEvent(message.event, message.properties);` 추가(반환 흐름은 기존 핸들러와 동일, `{ ok: true }` 래핑).
- **검증**:
  - [ ] `pnpm typecheck` 통과(union 추가로 switch exhaustiveness 충족).
  - [ ] background에서 `analytics.capture` 수신 시 `captureEvent` 호출(코드 경로 확인).

### Task 4: sidepanel 추적 헬퍼
- **변경 대상**: `src/sidepanel/lib/track-submit.ts` (신규)
- **작업 내용**:
  - `submitEventProperties(platform, captureMode, result): Record<string,string>` — `{ platform, capture_mode: captureMode ?? "unknown", result }` 반환(순수 함수).
  - `trackSubmit(platform, captureMode, result): void` — `sendBg({ type:"analytics.capture", event:"issue_submitted", properties: submitEventProperties(...) }).catch(() => {})`.
- **검증**:
  - [ ] (Task 7) `submitEventProperties` 단위 테스트: 키 집합이 정확히 `{platform, capture_mode, result}`이고 captureMode undefined → `"unknown"`.
  - [ ] `trackSubmit`는 await 없이 호출되고 sendBg 실패를 삼킨다.

### Task 5: SubmitFieldsDialog choke point 연결
- **변경 대상**: `src/sidepanel/tabs/SubmitFieldsDialog.tsx`
- **작업 내용**:
  - props에 `captureMode?: CaptureMode` 추가.
  - `handleSubmit()` 성공 경로(`onOpenChange(false)` 직후)에서 `trackSubmit(platform, captureMode, "success")`.
  - catch 블록에서 `trackSubmit(platform, captureMode, "failure")`.
- **검증**:
  - [ ] 제출 성공 시 success, 실패 시 failure 이벤트가 정확히 1회 호출(수동/네트워크 확인).
  - [ ] 추적 호출 추가가 기존 onSuccess/toast 동작을 바꾸지 않는다.

### Task 6: captureMode prop 전달
- **변경 대상**: `src/sidepanel/tabs/DraftDetailDialog.tsx`, `src/sidepanel/tabs/IssueCreateModal.tsx`
- **작업 내용**:
  - DraftDetailDialog: `<SubmitFieldsDialog captureMode={issue?.captureMode} … />`.
  - IssueCreateModal: `<SubmitFieldsDialog captureMode={captureMode} … />`(이미 `useEditorStore((s)=>s.captureMode)` 보유).
- **검증**:
  - [ ] 두 경로 모두 올바른 captureMode가 이벤트에 실린다.
  - [ ] `pnpm typecheck` 통과.

### Task 7: 단위 테스트
- **변경 대상**: `src/background/__tests__/analytics.test.ts`, `src/sidepanel/lib/__tests__/track-submit.test.ts` (신규)
- **작업 내용**: 아래 테스트 계획대로 작성.
- **검증**:
  - [ ] `pnpm test` 통과.

### Task 8: 개인정보처리방침 갱신
- **변경 대상**: `docs/privacy.md`
- **작업 내용**: 익명 집계 수집 섹션 추가 — 수집 항목(platform, capture_mode, result), 목적(제품 사용량 집계), 익명성(개인 식별자·이슈 내용 미수집, 이벤트별 랜덤 distinct_id), 수신처(PostHog) 명시. 시행일 갱신.
- **검증**:
  - [ ] `/push` 문서 신선도 검사 통과(privacy.md 동작 정합).
  - [ ] 수집 항목 목록이 실제 전송 properties와 일치.

## 테스트 계획

- **단위 테스트**:
  - `buildCaptureBody`: (a) `api_key`가 PostHog 키로 세팅 (b) `properties.$process_person_profile === false` (c) 입력 properties가 병합되고 손실 없음 (d) `distinct_id`가 인자로 들어감.
  - `isAnalyticsConfigured`: 키 빈 문자열/공백 → false, 값 있으면 true. (env mock — `vi.stubEnv` 또는 모듈 mock)
  - `submitEventProperties`: (a) 6개 platform 각각 그대로 매핑 (b) captureMode 4종 매핑 (c) undefined → `"unknown"` (d) 반환 객체 키가 정확히 3개(`platform`/`capture_mode`/`result`)로 식별 정보 없음.
- **e2e 시나리오**(`/e2e-write` 입력): PostHog 실키 없이 검증하려면 `/capture/`로 가는 네트워크 요청을 Playwright `page.route`로 가로채 단언.
  - "제출 성공하면 `**/capture/`로 `event:"issue_submitted"`, `properties.result:"success"` 요청이 1건 발생한다." — 단, 실제 플랫폼 제출 성공은 OAuth 인증이 필요해 자동화 난이도가 높음. **`captureEvent` 경로를 별도로 트리거 가능한 테스트 훅이 없으면 이 시나리오는 수동으로 강등**(아래).
  - 자동화 가능 최소 단언: 빌드에 `VITE_POSTHOG_KEY` 미주입(e2e 빌드 기본)이면 제출 시도 시 `/capture/` 요청이 **발생하지 않는다**(no-op 게이팅 회귀 방지).
- **수동 테스트**(Chrome):
  - `.env.local`에 실제 키 주입 후 `pnpm build` → 로드. 6개 플랫폼 중 인증된 1~2개로 실제 제출.
  - DevTools Network에서 `/capture/` 요청 payload 확인: `event:"issue_submitted"`, `properties` = {platform, capture_mode, result}, person profile 미생성(`$process_person_profile:false`).
  - 일부러 잘못된 토큰으로 제출 실패 유발 → `result:"failure"` 전송 확인 + 제출 에러 토스트 정상.
  - PostHog 대시보드에서 이벤트 수신 및 platform/capture_mode breakdown 확인.

## 구현 순서 권장

1. **Task 1**(env) → **Task 2**(analytics.ts) → **Task 3**(메시지) : background 전송 경로 완성. (Task 2,3 순차 — 3이 2의 `captureEvent` 의존)
2. **Task 4**(track-submit) : sidepanel 헬퍼. Task 3의 메시지 타입 의존.
3. **Task 5**(SubmitFieldsDialog) → **Task 6**(prop 전달) : UI 연결. 5,6 순차(6이 5의 prop 시그니처 의존).
4. **Task 7**(테스트) : Task 2·4 완료 후 작성(TDD로 앞당겨도 됨 — 순수 함수라 `/tdd interface`로 선작성 권장).
5. **Task 8**(privacy.md) : 병렬 가능(코드 의존 없음). `/push` 전 필수.

병렬 가능: Task 1·Task 8은 코드와 독립. Task 7은 대상 함수 시그니처만 정해지면 선작성 가능.

## 가이드 영향

없음 — 사용자 노출 UI·동작 변화가 없는 백그라운드 집계라 `guide/` 갱신 불필요. 단, `docs/privacy.md`는 가이드와 별개로 **반드시** 갱신한다(Task 8).
