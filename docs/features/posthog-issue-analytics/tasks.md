# PostHog 이슈 제출 집계 — 구현 태스크

## 선행 조건

- PostHog 프로젝트 생성 후 **Project API Key**(write-only, 공개 가능) 확보. 프로젝트·키는 1개면 충분(dev 전송 없음).
- PostHog 호스트 결정(US: `https://us.i.posthog.com` / EU: `https://eu.i.posthog.com`).
- **prod 데이터만 누적**: 확보한 키를 `.env.local`의 `VITE_POSTHOG_KEY_PROD`에 넣고 `VITE_POSTHOG_KEY`(dev)는 **비워둔다**. → `pnpm build:store`에서만 키가 주입돼 전송, dev/일반 `pnpm build`/e2e는 no-op. (GitHub `VITE_GITHUB_CLIENT_ID` / `_PROD`와 동형)
- 권한·매니페스트 변경 없음(CORS 의존, design.md 위험 요소 참조). vite.config.ts에 dev/prod 키 분기 define 1줄 추가(Task 1).

## 태스크

### Task 1: env 항목 + dev/prod 키 분기 (vite.config)
- **변경 대상**: `.env.example`, `vite.config.ts`
- **작업 내용**:
  - `.env.example`에 `VITE_POSTHOG_KEY=`(dev — 비우면 전송 안 함), `VITE_POSTHOG_KEY_PROD=`(store 빌드 시 승격), `VITE_POSTHOG_HOST=`(기본 `https://us.i.posthog.com`) + "prod 데이터만 누적" 정책 주석 추가.
  - `vite.config.ts`: GitHub 키 옆에 `const posthogKey = isStoreBuild ? env.VITE_POSTHOG_KEY_PROD ?? "" : env.VITE_POSTHOG_KEY ?? "";` 추가 + `define`에 `"import.meta.env.VITE_POSTHOG_KEY": JSON.stringify(posthogKey)` 한 줄 추가.
- **검증**:
  - [ ] `.env.example`에 세 항목 + 정책 주석 존재.
  - [ ] `vite.config.ts` define에 POSTHOG 키 분기가 GitHub 키와 동형으로 추가됨.
  - [ ] (수동) `pnpm build`(dev) 산출물엔 키가 빈 문자열, `pnpm build:store` 산출물엔 PROD 키가 박힘.

### Task 2: PostHog 전송 모듈 (background)
- **변경 대상**: `src/background/analytics.ts` (신규)
- **작업 내용**: (`VITE_POSTHOG_KEY`는 vite define 치환 대상 → `vi.stubEnv` 무효. 키·host를 **인자로 받는 순수/주입 함수**로 분리해 테스트하고, env 읽기는 얇은 wrapper에만 둔다.)
  - `analyticsEnabled(key): boolean` — `!!(key ?? "").trim()` (순수, 게이팅 테스트 대상).
  - `posthogHost(): string` — `import.meta.env.VITE_POSTHOG_HOST` 재독(기본 `https://us.i.posthog.com`, trim/슬래시 제거).
  - `isAnalyticsConfigured(): boolean` — `analyticsEnabled(import.meta.env.VITE_POSTHOG_KEY)`.
  - `buildCaptureBody(event, properties, distinctId, apiKey): PosthogCaptureBody` — `{ api_key: apiKey, event, distinct_id: distinctId, properties: { ...properties, $process_person_profile: false, $ip: "", $geoip_disable: true } }` (순수).
  - `postCapture(host, body): Promise<void>` — `fetch(host + "/capture/", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body) })`. try/catch로 reject·non-ok 모두 `console.warn`만(격리).
  - `captureEvent(event, properties): Promise<void>` — `const key = (import.meta.env.VITE_POSTHOG_KEY ?? "").trim(); if (!key) return;` 후 `postCapture(posthogHost(), buildCaptureBody(event, properties, crypto.randomUUID(), key))`.
- **검증**:
  - [ ] (Task 7) `analyticsEnabled`: `""`·공백 → false, `"phc_x"` → true.
  - [ ] (Task 7) `buildCaptureBody` 단위: `api_key`가 인자값, `$process_person_profile:false`·`$ip:""`·`$geoip_disable:true` 포함, 입력 properties 병합·손실 없음, distinct_id가 인자값.
  - [ ] (Task 7) `postCapture` 단위(fetch mock): `host+"/capture/"`로 POST, body가 직렬화된 입력 body. fetch reject·non-ok 응답 둘 다에서 reject 안 함(throw 격리).

### Task 3: 메시지 타입 + 라우팅 (3곳)
- **변경 대상**: `src/types/messages.ts`, `src/background/bgRequestTypes.ts`, `src/background/messages.ts`
- **작업 내용**:
  - `BgRequest` union에 `{ type: "analytics.capture"; event: string; properties: Record<string, string> }` 추가.
  - `bgRequestTypes.ts`의 `BG_REQUEST_TYPE_MAP`에 `"analytics.capture": true` 추가. **누락 시 onMessage 화이트리스트(`BG_REQUEST_TYPES` Set)에서 빠져 메시지가 런타임에 silently drop**되고, `Record<BgRequest["type"], true>`라 컴파일도 깨진다.
  - `handleMessage()` switch에 `case "analytics.capture": return captureEvent(message.event, message.properties);` 추가(반환 흐름은 기존 핸들러와 동일, `{ ok: true }` 래핑).
- **검증**:
  - [ ] `pnpm typecheck` 통과(union 추가로 switch exhaustiveness + `BG_REQUEST_TYPE_MAP` exhaustive Record 충족).
  - [ ] `BG_REQUEST_TYPES.has("analytics.capture") === true`(화이트리스트 통과).
  - [ ] background에서 `analytics.capture` 수신 시 `captureEvent` 호출(코드 경로 확인).

### Task 4: sidepanel 추적 헬퍼
- **변경 대상**: `src/sidepanel/lib/track-submit.ts` (신규)
- **작업 내용**:
  - `submitEventProperties(platform, captureMode, result): Record<string,string>` — `{ platform, capture_mode: captureMode ?? "unknown", result }` 반환(순수 함수). `?? "unknown"`은 도달하지 않는 1줄 방어(전용 테스트 없음).
  - `trackSubmit(platform, captureMode, result): void` — `sendBg({ type:"analytics.capture", event:"issue_submitted", properties: submitEventProperties(...) }).catch(() => {})`. 동기적으로 throw하지 않는다.
- **검증**:
  - [ ] (Task 7) `submitEventProperties` 단위: 6 platform·4 captureMode 매핑, 반환 키가 정확히 `{platform, capture_mode, result}` 3개(식별 정보 없음).
  - [ ] `trackSubmit`는 await 없이 호출되고 sendBg reject를 삼킨다(동기 throw 없음).

### Task 5: SubmitFieldsDialog choke point 연결
- **변경 대상**: `src/sidepanel/tabs/SubmitFieldsDialog.tsx`
- **작업 내용**:
  - props에 `captureMode?: CaptureMode` 추가.
  - `handleSubmit()`에서 **`await onSubmit(platform)` 리졸브 직후·`onOpenChange(false)`/`onSuccess?.()` 이전**에 `trackSubmit(platform, captureMode, "success")`. (onSuccess/onOpenChange가 throw해도 success로 이미 집계 → catch의 failure와 중복·오분류 방지.)
  - catch 블록에서 `trackSubmit(platform, captureMode, "failure")`.
- **검증**:
  - [ ] 제출 성공 시 success, 실패 시 failure 이벤트가 정확히 1회 호출(수동/네트워크 확인).
  - [ ] `onSuccess`가 throw해도 `failure`가 추가 전송되지 않는다(success만 1회).
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
- **작업 내용**: 익명 집계 수집 섹션 추가 — 수집 항목(platform, capture_mode, result), 목적(제품 사용량 집계 + 연동/캡처 모드 우선순위 판단), 익명성(개인 식별자·이슈 내용 미수집, 이벤트별 랜덤 distinct_id, `$ip` 비움·GeoIP 비활성으로 IP 비저장), 수신처(PostHog), 옵트아웃 부재를 명시. 시행일 갱신. (확장 UI에는 privacy 링크를 두지 않고 웹스토어 대시보드 privacy URL 등록으로 정책 공개 요건 충족 — design 위험 요소 참조.)
- **검증**:
  - [ ] `/push` 문서 신선도 검사 통과(privacy.md 동작 정합).
  - [ ] 수집 항목 목록이 실제 전송 properties와 일치.
  - [ ] IP 비저장 조치(`$ip:""`·`$geoip_disable:true`)가 명시돼 "완전 익명" 주장과 정합.

## 테스트 계획

- **단위 테스트** (키 게이팅·전송은 `import.meta.env.VITE_POSTHOG_KEY`가 vite define 치환 대상이라 `vi.stubEnv` 불가 → **인자 주입 함수**로 검증):
  - `analyticsEnabled(key)`: `""`·공백 → false, `"phc_x"` → true. (`isAnalyticsConfigured`는 env wrapper라 단위 비대상 — `analyticsEnabled`로 로직 커버.)
  - `buildCaptureBody`: (a) `api_key`가 인자값 (b) `properties`에 `$process_person_profile:false`·`$ip:""`·`$geoip_disable:true` 포함 (c) 입력 properties가 병합되고 손실 없음 (d) `distinct_id`가 인자값.
  - `postCapture(host, body)`(fetch mock — `vi.stubGlobal("fetch", …)` 또는 `globalThis.fetch = vi.fn()`, 기존 `github-api.test.ts`/`linear-api.test.ts` 패턴): (a) `host+"/capture/"`로 POST, body가 직렬화된 입력 (b) fetch reject 시 throw 안 함 (c) non-ok(4xx/5xx) 응답 시 throw 안 함.
  - `submitEventProperties`: (a) 6개 platform 각각 그대로 매핑 (b) captureMode 4종 매핑 (c) 반환 객체 키가 정확히 3개(`platform`/`capture_mode`/`result`)로 식별 정보 없음.
- **e2e 시나리오**: **없음(전면 강등)**. 근거: PostHog fetch는 service worker에서 발생하는데 Playwright `page.route`/`context.route`는 SW의 native fetch를 가로채지 못한다(현 e2e 스위트에 route/fulfill 사용 0건). 또한 e2e 빌드는 `VITE_POSTHOG_KEY`를 주입하지 않아 "미발생" 단언이 키 게이팅이 아니라 키 부재로 vacuously true가 돼 회귀 방지 가치가 없다. 위 단위 테스트(키 게이팅·fetch 호출·격리)로 대체한다.
- **수동 테스트**(Chrome):
  - 구현 중 1회: PostHog `/capture/`로 가는 요청의 **preflight(OPTIONS)**가 200 + `ACAO: *`/`Access-Control-Allow-Headers: content-type`로 통과하는지 DevTools Network에서 확인(설계 CORS 가정 검증).
  - 전송 검증용: `VITE_POSTHOG_KEY_PROD`를 채우고 `pnpm build:store`로 빌드(또는 일시적으로 `VITE_POSTHOG_KEY`에 키를 넣고 `pnpm build`) → 로드. 6개 플랫폼 중 인증된 1~2개로 실제 제출. (평상시 dev 빌드는 키가 비어 전송되지 않음을 함께 확인.)
  - DevTools Network에서 `/capture/` 요청 payload 확인: `event:"issue_submitted"`, `properties` = {platform, capture_mode, result, `$process_person_profile:false`, `$ip:""`, `$geoip_disable:true`}.
  - 일부러 잘못된 토큰으로 제출 실패 유발 → `result:"failure"` 전송 확인 + 제출 에러 토스트 정상.
  - PostHog 대시보드에서 이벤트 수신, person profile 미생성, IP/위치 미기록, platform/capture_mode breakdown 확인.

## 구현 순서 권장

1. **Task 1**(env) → **Task 2**(analytics.ts) → **Task 3**(메시지) : background 전송 경로 완성. (Task 2,3 순차 — 3이 2의 `captureEvent` 의존)
2. **Task 4**(track-submit) : sidepanel 헬퍼. Task 3의 메시지 타입 의존.
3. **Task 5**(SubmitFieldsDialog) → **Task 6**(prop 전달) : UI 연결. 5,6 순차(6이 5의 prop 시그니처 의존).
4. **Task 7**(테스트) : Task 2·4 완료 후 작성(TDD로 앞당겨도 됨 — 순수 함수라 `/tdd interface`로 선작성 권장).
5. **Task 8**(privacy.md) : 병렬 가능(코드 의존 없음). `/push` 전 필수.

병렬 가능: Task 1·Task 8은 코드와 독립. Task 7은 대상 함수 시그니처만 정해지면 선작성 가능.

## 가이드 영향

없음 — 사용자 노출 UI·동작 변화가 없는 백그라운드 집계라 `guide/` 갱신 불필요. 단, `docs/privacy.md`는 가이드와 별개로 **반드시** 갱신한다(Task 8).
