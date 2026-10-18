# 무료 AI 연결 — 구현 태스크

## 선행 조건

- Task 0 스파이크 결과에 따라 범위가 갈린다. OpenRouter callback이 거부되면 Task 3·5의 OpenRouter 분기를 빼고 **Gemini만으로 출시**한다(design R1).
- 새 의존성·manifest 권한 변경 없음(`identity`는 기존 권한, `chrome.windows.create`는 권한 불요).
- 착수 전 `docs/POSTMORTEM.md`를 `llm`·`ai-provider`·`analytics`·`oauth`로 grep하고, `docs/DESIGN.md`와 기존 선택 카드 UI를 읽는다.

## 태스크

### Task 0: 실측 스파이크 (코드 변경 없음, 결과는 이 문서에 기록)
- **변경 대상**: 없음. 결과를 이 파일 하단 "스파이크 결과"에 적는다.
- **작업 내용**:
  1. OpenRouter `https://openrouter.ai/auth?callback_url=https://<dev ID>.chromiumapp.org/&code_challenge=…&code_challenge_method=S256&state=…`로 실제 로그인·승인해서, 리다이렉트가 `chromiumapp.org`로 `code`·`state`를 싣고 돌아오는지 본다. 받은 code를 `POST /api/v1/auth/keys`로 교환해 `key`를 받는지도 확인한다.
  2. Gemini OpenAI 호환 `GET /v1beta/openai/models`로 현재 모델 ID를 확인하고, 무료 티어 키로 `chat/completions`(이미지 1장 포함)가 되는 모델을 고른다. `GEMINI_MODELS` 갱신안(+`freeTier` 표기)을 확정한다.
  3. OpenRouter `GET /api/v1/models`에서 `:free`+`image` 모델이 실제로 이미지 입력 chat에 응답하는지 1개 이상 확인한다.
- **검증**:
  - [x] callback 허용 여부 확정 → 허용 (전체 범위)
  - [x] state echo 여부 → echo됨
  - [ ] `GEMINI_MODELS` 새 목록과 무료 티어 대상 확정 — 공식 문서 기준 갱신안 확정, **무료 키 실호출 미수행**
  - [x] OpenRouter 무료 vision 모델 응답 확인 (3/8 정상)
  - [ ] [거부] 시 리다이렉트 형태(error 파라미터 이름·값)와 key_label 반영 여부 기록 — `parseOpenRouterCallback` fixture의 출처. key_label은 `OAuth: <label>`로 반영됨을 확인했고, [거부]는 미수행
  - [ ] 인증 창 안에서 신규 계정 Google SSO 로그인 완주 — 미수행(이번엔 ego-browser 일반 탭에서 가입)

### Task 1: 공용 leaf + 집계 가드
- **변경 대상**: `src/lib/llm-provider-ids.ts`(신규), `src/background/analytics.ts`, `src/sidepanel/lib/track-llm.ts`(신규), `src/sidepanel/lib/ai-provider.ts`(`presetIdOf`만)
- **작업 내용**: `LLM_PROVIDER_IDS` 정의. `ALLOWED_EVENTS.llm_connect` 추가 + `filterProperties`에 이 이벤트 스코프의 값 enum 가드. `presetIdOf`·`llmConnectProperties`·`trackLlmConnect` 구현.
- **검증**:
  - [ ] `analytics` 테스트: `llm_connect` 허용 키 3개만 통과, provider에 URL·임의 문자열을 넣으면 그 키가 빠짐, path/result도 enum 밖이면 빠짐
  - [ ] enum 가드는 이벤트 스코프로만 건다(키 이름 기준 금지): `filterProperties("issue_submitted", {result:"failure"})`·`filterProperties("platform_connect", {result:"cancelled", reason:"cancelled_window"})`가 그대로 통과
  - [ ] 송신↔허용목록 왕복: `llmConnectProperties`(프리셋 8종·custom × path 2 × result 3) → `filterProperties("llm_connect", …)`가 항등
  - [ ] `track-llm` 테스트: 프리셋 baseUrl → ID, 프리셋과 다른 URL(`http://localhost:1234/v1`, 사내 vLLM) → `custom`, trailing slash 붙은 URL → `custom`(getProviderLabel과 같은 정확 일치)
  - [ ] `lib/llm-provider-ids.ts` 런타임 import 0 — 자동 스캔이 없으므로 session-keys 블록(`bundleBoundary.test.ts:151-165`)과 같은 형태의 describe를 새로 추가
  - [ ] `PROVIDER_PRESETS`의 id 집합 == `LLM_PROVIDER_IDS` (테스트로 대조)

### Task 2: `ai-provider` 정리 — 연결 로직 추출 + 모델 표기
- **변경 대상**: `src/sidepanel/lib/ai-provider.ts`, `src/sidepanel/tabs/settings/LlmConnectDialog.tsx`, `src/store/settings-ui-store.ts`
- **작업 내용**: `ModelEntry.freeTier`, `LlmConfig.freeTier` 추가. Task 0 결과(T0-2)로 `GEMINI_MODELS` 갱신 + `GEMINI_FREE_MODELS` 상수. `connectProvider`와 에러 클래스 3종, `connectErrorKey` 추출. `handleConnect`를 `connectProvider`·`connectErrorKey` 호출로 교체하고, 모달 닫힘 시 1회 `trackLlmConnect(…, "byok", …)`(prd 목표 7 규칙). `LlmModelDialog` export.
- **검증**:
  - [ ] **추출 전에** `connectProvider` 테스트 작성(red): invalid URL / insecure http 원격 / 권한 거부 / anthropic ping / gemini → `GEMINI_MODELS` / 그 외 → fetched / redirect → `LlmRedirectError`
  - [ ] `connectErrorKey` 표 테스트: InvalidUrl→invalidUrl, Insecure→insecureUrl, PermissionDenied→permission, Redirect→redirect, 그 외(LlmAuthError 포함)→fetch (toastLlmError로 바꾸지 않는다)
  - [ ] `LlmConnectDialog.test.tsx`(jsdom, 신규): 성공 → 닫힘 시 `trackLlmConnect(baseUrl,"byok","success")` 1회 + `setLlm` 인자에 `freeTier` 키 없음 / redirect → `llm.error.redirect` 토스트 + 닫힘 시 `"failed"` / 아무것도 안 하고 닫기 → `"cancelled"`
  - [ ] `GEMINI_FREE_MODELS.length >= 1` (Gemini 경로엔 0개 차단 규칙이 없다)
  - [ ] `settings-ui-store` 테스트: `freeTier` 포함 config가 persist 왕복(난독화 경로 포함)에서 보존, 없는 기존 데이터는 그대로

### Task 3: 무료 경로 순수 로직
- **변경 대상**: `src/sidepanel/lib/free-llm.ts`(신규)
- **작업 내용**: design 인터페이스 그대로 구현.
- **검증**:
  - [ ] `createPkcePair`: RFC 7636 Appendix B 벡터(verifier `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` → challenge `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`), 주입 random으로 결정적, verifier 길이 43~128·base64url 문자셋
  - [ ] `buildOpenRouterAuthUrl`: `callback_url`·`code_challenge`·`code_challenge_method=S256`·`state`·`key_label` 포함, 인코딩 정확
  - [ ] `parseOpenRouterCallback`: 정상 / state 불일치 throw / code 누락 throw / `error=access_denied` → cancelled / malformed throw
  - [ ] `exchangeOpenRouterCode`: body `{code, code_verifier, code_challenge_method:"S256"}`, `redirect:"manual"`, !ok throw, `key` 누락 throw
  - [ ] `pickFreeVisionModels`: 2026-10 실측 응답 축약 fixture로 `:free`+image만 남고 정렬, `architecture` 누락 항목 제외, `:free`인데 텍스트 전용 제외
  - [ ] `isAuthFlowCancelled`: background `LAUNCH_FLOW_ERRORS` cancelled 행 메시지와 대조
  - [ ] `fetchOpenRouterFreeVisionModels`: Bearer 헤더, `redirect:"manual"`, opaqueredirect → `LlmRedirectError`, `data` 누락 → `[]`
  - [ ] `runOpenRouterAuth`(deps 주입): `"The user did not approve access."` reject → cancelled / `"Authorization page could not be loaded."` → throw / state 불일치 → throw / 정상 → key
  - [ ] `OPENROUTER_BASE_URL` == `PROVIDER_PRESETS` openrouter baseUrl

### Task 4: OpenRouter 런처 바인딩 (browser-bound)
- **변경 대상**: `src/sidepanel/openrouter-auth.ts`(신규), `scripts/coverage-report.mjs`
- **작업 내용**: 조립 로직은 Task 3의 `runOpenRouterAuth(deps)`에 있다. `openrouter-auth.ts`는 chrome API(`identity.launchWebAuthFlow`·`identity.getRedirectURL`·`crypto.getRandomValues`·`fetch`)를 deps로 바인딩만 한다(분기 0). `BROWSER_BOUND_EXACT` 등재.
- **검증**:
  - [ ] `pnpm typecheck`
  - [ ] 파일에 `if`/`catch` 분기가 없음(리뷰로 확인)
  - [ ] 커버리지 리포트에서 로직 스코프 분모에 안 잡힘

### Task 5: `FreeLlmConnectDialog` + 온보딩·연결 화면
- **변경 대상**: `src/sidepanel/tabs/settings/FreeLlmConnectDialog.tsx`(신규), `src/sidepanel/tabs/settings/LlmConnectForm.tsx`, `src/i18n/namespaces/settings.ts`, `e2e/fixtures/settings.ts`
- **작업 내용**: design의 데이터 흐름대로 2단계 모달. 온보딩 버튼 2개 배치(무료 = outline, 왼쪽, `flex-wrap`). `LlmConnected`의 `freeTier` 필터. i18n 6로케일. testid 부착: `settings-sub-ai`, `llm-connect-free`·`llm-connect-byok`, `free-llm-card-{gemini,openrouter}`, `free-llm-next`·`free-llm-back`, `free-llm-gemini-key`·`free-llm-reopen`. `openSettings`에 `"ai"` 추가.
- **검증** (`FreeLlmConnectDialog.test.tsx`, jsdom):
  - [ ] 카드 미선택 시 [다음] 비활성, 카드마다 모델·한도·프라이버시 문구 렌더, 카드 재클릭으로 선택 해제 안 됨
  - [ ] Gemini + [다음] → `chrome.windows.create`가 `AI_STUDIO_KEY_URL`·`type:"popup"`으로 1회 호출, step=geminiKey, 키 Input 포커스
  - [ ] `chrome.windows.create`가 reject돼도 step=geminiKey
  - [ ] "발급 페이지 다시 열기" → 다시 호출 / [이전] → pick, 입력 리셋, 선택 카드 포커스
  - [ ] 키가 공백만이면 [연결] 비활성
  - [ ] Gemini 잘못된 키 → 토스트, step·입력값 유지
  - [ ] Gemini [연결] → 모델 다이얼로그에 `GEMINI_FREE_MODELS`만, 선택 시 `setLlm`에 `freeTier:true` / 모델 다이얼로그 닫기 → 키 유지
  - [ ] OpenRouter cancelled → 토스트 없음, pick 유지
  - [ ] OpenRouter throw → 토스트, step=pick
  - [ ] OpenRouter 0개 모델 → `noFreeVisionModel` 토스트, `setLlm` 미호출
  - [ ] OpenRouter 모델 다이얼로그 닫기 → 다시 열었을 때 이전 키 없음
  - [ ] `dblClick([다음])` → `launchOpenRouterAuth` 1회 (ref 동기 가드)
  - [ ] 닫힌 뒤 도착한 결과 무시 + 닫기→재오픈 후 이전 시도 결과가 도착해도 무시(step=pick, pendingModels 없음, setLlm 미호출)
  - [ ] 바깥 클릭으로 닫히지 않음, Esc로 닫힘
  - [ ] 닫을 때 `trackLlmConnect` 정확히 1회: success / failed(토스트 후 닫기) / cancelled(아무 일 없이 닫기, provider 생략)
  - [ ] 닫기 후 다시 열면 상태 리셋
  - [ ] `locales.test.ts` 대칭 green
- **검증** (`LlmConnectForm.test.tsx`, jsdom, 신규 — mock 선례 `WebhookConnectForm.test.tsx:5-22`):
  - [ ] 온보딩: 버튼 순서(무료 → API 키)와 variant(outline / default)
  - [ ] `freeTier` OpenRouter: 초기 fetch와 새로고침이 무료 경로를 탐, fetch 실패 시 기존 modelId 표시 유지
  - [ ] `freeTier` 없는 Gemini(BYOK): 전체 `GEMINI_MODELS`
  - [ ] 모델 변경 후 `freeTier:true` 보존

### Task 6: 문서
- **변경 대상**: `docs/privacy.ko.md`·`docs/privacy.en.md`, `docs/PERMISSION.md`, `docs/ARCHITECTURE.md`, `docs/DIRECTORY.md`
- **작업 내용**:
  - privacy:
    - ① 외부 전송 표에 OpenRouter 키 발급(`openrouter.ai/auth`, `POST /api/v1/auth/keys` — 인가 code·PKCE verifier만, 캡처 데이터 없음)과 모델 목록 조회 추가
    - ② LLM 프로바이더 절(:104)에 무료 티어 고지: Gemini 학습 사용 가능성, OpenRouter 무료 모델 로깅, 해제해도 OpenRouter 키는 계정에 남음
    - ③ 익명 집계 표(:114-118)와 요약 행(:162 "익명 집계 이벤트 (설치·…)")에 `llm_connect` 추가: provider는 프리셋 ID 또는 custom, 경로, 결과. base URL·키·모델 ID는 미전송
    - ④ 시행일
  - PERMISSION: `identity` 사용처에 OpenRouter 키 발급 추가, `chrome.windows.create` 사용(권한 불요)
  - ARCHITECTURE: :666 AI 통합 절에 무료 경로 단락 추가(PKCE 패널 직행 근거, `freeTier` 필드), :397 "이벤트 5종" → 6종
  - DIRECTORY: 신규 파일 5개(`lib/llm-provider-ids.ts`·`sidepanel/lib/free-llm.ts`·`sidepanel/lib/track-llm.ts`·`sidepanel/openrouter-auth.ts`·`tabs/settings/FreeLlmConnectDialog.tsx`)
- **검증**:
  - [ ] ko/en 섹션 대칭, 시행일 동일
  - [ ] privacy 집계 표·요약 행·ARCHITECTURE 이벤트 수가 `ALLOWED_EVENTS` 키와 일치
  - [ ] privacy의 프리셋 목록 문장과 `PROVIDER_PRESETS` 일치

## 테스트 계획

- **단위 테스트**: Task 1~3, 5의 체크 항목. 신규 파일: `src/sidepanel/lib/__tests__/free-llm.test.ts`·`track-llm.test.ts`, `src/background/__tests__/analytics*.test.ts` 확장, `src/sidepanel/lib/__tests__/ai-provider.test.ts` 확장, `src/store/__tests__/settings-ui-store*.test.ts` 확장, `src/store/__tests__/bundleBoundary.test.ts` 확장, `src/sidepanel/tabs/settings/__tests__/FreeLlmConnectDialog.test.tsx`·`LlmConnectDialog.test.tsx`·`LlmConnectForm.test.tsx`.
- **e2e 시나리오**:
  - 설정 > AI 모델(연결 전)을 열면 [무료 AI 연결]과 [API 키 연결] 두 버튼이 보이고, 무료 버튼이 왼쪽에 있다.
  - [무료 AI 연결]을 누르면 Gemini·OpenRouter 카드 2개가 있는 다이얼로그가 뜨고, 카드를 고르기 전에는 [다음]이 비활성이다.
  - Gemini 카드 + [다음]을 누르면 `chrome.windows.getAll({windowTypes:["popup"],populate:true})`에 `aistudio.google.com/apikey` 탭을 가진 popup이 1개 생기고(`context.route("https://aistudio.google.com/**")`로 stub), 다이얼로그에 API 키 입력란이 보인다.
  - 2단계에서 [이전]을 누르면 카드 선택 화면으로 돌아간다.
  - `/v1beta/openai/models`를 stub한 상태에서 키를 넣고 [연결]하면 모델 다이얼로그에 freeTier 모델만 보이고, 하나 고르면 연결 화면으로 바뀐다.
- **수동 테스트**:
  - [ ] S1 실제 Gemini 무료 키로 연결 → AI 초안이 스크린샷 포함으로 생성
  - [ ] S1 팝업 이후 원래 창의 활성 탭·패널·2단계가 유지됨
  - [ ] S2 실제 OpenRouter 로그인(신규 가입 포함) → 키 발급 → 무료 vision 모델로 AI 초안 생성
  - [ ] S2 로그인 창 닫기 → 토스트 없이 복귀 / [거부] → 토스트 없이 복귀
  - [ ] S2 대기 중 패널 닫기(R4) → 다시 열어 정상 재시도 가능
  - [ ] 연결 후 모델 콤보가 무료 모델로 필터됨(두 경로)
  - [ ] PostHog에서 `llm_connect` 이벤트 props 3개 확인(free·byok 각각), BYOK custom URL이 `provider=custom`으로 집계
  - [ ] 다크모드·좁은 패널 폭에서 카드 레이아웃, 낮은 패널 높이(≈600px)·de 로케일에서 [다음]이 보이는지

## 구현 순서 권장

Task 0 → (Task 1 ∥ Task 3) → Task 2 → Task 4 → Task 5 → Task 6.
Task 1과 Task 3은 서로 독립이다. Task 2는 Task 1의 `LlmProviderId`·`presetIdOf`를 쓴다. Task 5는 2·3·4 전부에 의존한다. Task 0에서 OpenRouter가 거부되면 Task 3의 OpenRouter 함수, Task 4, Task 5의 OpenRouter 분기를 건너뛴다.

## 가이드 영향

- `settings/ai.md`(ko·en) — "연결하기" 앞에 "무료로 연결하기" 절 추가(두 프리셋, 프라이버시 차이, 한도, 재현 단계 자동 채움도 한도를 쓴다는 점). `settings-ai-1.jpg`는 연결 상태 컷이라 버튼 변경과 무관하다 — `GEMINI_MODELS` 갱신으로 화면의 모델명이 바뀔 때만 재촬영한다. 온보딩 컷을 새로 만들지는 `/guide`에서 정한다.
- `settings/README.md`(ko·en) — AI 서브탭 요약에 무료 연결 한 줄.

## 스파이크 결과

2026-10-18 실측. dev 확장 ID `dhmffogmoohdjficicjjfolcheklngfm`, ego-browser + curl.

### T0-1. OpenRouter callback — **허용 (전체 범위 진행)**
- `callback_url=https://<ID>.chromiumapp.org/`로 인가 화면이 정상 렌더된다("You will be sent to https://<ID>.chromiumapp.org"). Authorize를 누르면 `https://<ID>.chromiumapp.org/?code=…&state=…`로 리다이렉트되고, `state`는 보낸 값 그대로 돌아온다.
- `POST /api/v1/auth/keys` `{code, code_verifier, code_challenge_method:"S256"}` → 200 `{ key, user_id }`. key는 `sk-or-v1-` 접두, 73자다.
- 발급 키 속성: 라벨이 **`OAuth: <key_label>`** 로 표시되고, 만료 없음, 한도 unlimited다. 인가 화면에서 사용자가 credit limit을 직접 넣을 수 있다.
- 인가 화면의 앱 이름이 **"An app"** 으로 뜬다(앱 식별 수단이 callback 도메인뿐). 사용자 신뢰에 영향이 있다 → design 위험 요소에 추가.
- **신규 가입 경로 함정**: 비로그인 상태로 인가 URL을 열면 `/sign-up?redirect_url=<인가 URL>`로 간다. 가입 후 인가 URL 위에 OpenRouter 온보딩이 끼어든다. 순서는 워크스페이스 생성 → **기본 API 키 자동 발급**($100 한도, 6개월 만료) → 결제수단 등록(건너뛰기 가능) → 유입 경로 설문 → "You're all set" 화면이다. 이 마지막 화면에는 **[Go to Dashboard]/[Read the Docs]만 있고 인가 화면으로 돌아가는 버튼이 없다.** 페이지를 새로 고침해야 인가 화면이 나온다. `launchWebAuthFlow` 창에서 사용자가 Dashboard를 누르면 흐름을 잃는다. → 설계 반영 필요(R8).
- 신규 가입자 계정에는 키가 2개 생긴다(온보딩 기본 키 + BugShot OAuth 키). BugShot은 온보딩 키를 모르고 관여하지도 않는다.

### T0-2. Gemini 모델 목록 — **`gemini-2.0-flash` 종료 확인, 목록 갱신 필요**
공식 deprecations 페이지 기준.
- `gemini-2.0-flash`는 **2026-06-01 종료**(후속 `gemini-3.6-flash`). 지금 `GEMINI_MODELS`에 남아 있어서 **기존 BYOK 사용자에게도 해당하는 현행 결함**이다.
- `gemini-2.5-flash`·`gemini-2.5-pro`는 종료일 미정("until further notice"). Google은 신규 프로젝트에 3.5 Flash-Lite / 3.8 Flash를 권장한다.
- 공식 pricing 페이지상 무료 티어 가능 모델(채팅): `gemini-3.8-flash`·`gemini-3.6-flash`·`gemini-3.5-flash-lite`·`gemini-3.1-flash-lite`·`gemini-3-flash-preview`·`gemini-2.5-flash`·`gemini-2.5-flash-lite`. 무료 불가: `gemini-4-argon`·`gemini-3.1-pro-preview`. `gemini-2.5-pro`는 같은 페이지 안에서 표기가 엇갈려 **미확정**이다. 무료 티어는 전부 "Used to improve our products: Yes"다.
- **미수행**: 무료 키로 OpenAI 호환 `/models`·이미지 chat 실호출(키 없음). Task 2 착수 시 또는 수동 테스트 S1에서 확인한다.
- 갱신안(Task 2): `gemini-3.8-flash`(freeTier)·`gemini-3.6-flash`(freeTier)·`gemini-3.5-flash-lite`(freeTier)·`gemini-2.5-flash`(freeTier)·`gemini-2.5-pro`. `gemini-2.0-flash`는 삭제한다. 실호출로 OpenAI 호환 엔드포인트의 모델 ID 표기를 먼저 확인한다.

### T0-3. OpenRouter `:free`+image 모델 실응답
`/models` 필터 결과 8개를 단색(빨강) 64px PNG + "무슨 색?" 질문으로 호출했다(`max_tokens` 2000).

| 모델 | 결과 |
|---|---|
| `nvidia/nemotron-3.5-super-vl:free` | ✅ "Red" (0.7s) |
| `dots-studio/dots-3-note-preview:free` | ✅ "Red" (3.4s) |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | ✅ "Red" (3.9s) |
| `google/gemma-4-31b-it:free` · `google/gemma-4-26b-a4b-it:free` | ⚠️ 429 upstream rate-limited (일시적, 두 번 시도 모두) |
| `thinkingmachines/inkling:free` · `inkling-small:free` | ❌ **403 "only available on agentic harnesses"** — 메타데이터로는 구분 불가 |
| `nvidia/nemotron-3.5-content-safety:free` | ⚠️ 분류기. max_tokens 40에서 빈 응답(재시험 안 함) |

- 세 모델 모두 `reasoning` 필드를 동반한다. `max_tokens` 40에서는 content가 비었다. 현행 `LLM_MAX_TOKENS = 4096`이면 충분하지만 reasoning 토큰이 예산을 먹는다는 점은 기록해 둔다.
- **필터만으로는 "부를 수 있는 모델"이 보장되지 않는다** — 403 계열(정책 제한)과 429 계열(상류 혼잡)이 섞인다. → 설계 반영 필요(R9).

### 설계 반영 대기 항목 (feature-review 결과와 함께 처리)
- **R8 (신규 가입 함정)**: 모달 OpenRouter 카드나 대기 상태에 "처음 가입하면 OpenRouter 안내가 끝난 뒤 창을 닫고 [다음]을 다시 누르세요" 안내를 둔다. 또는 대기 중 [다시 시도]를 노출한다. 결정 필요.
- **R9 (호출 불가 모델 섞임)**: 모델 선택 직후 1회 프로브(이미지 없는 짧은 요청)로 403을 걸러낼지 결정 필요(무료 일일 한도 1회 소모). 아니면 목록에 그대로 두고 실패를 기존 에러 토스트에 맡긴다.
- **인가 화면 "An app" 표기**: 신뢰 저하 요인이라 카드 문구에 "OpenRouter 승인 화면에 'An app'으로 표시됩니다"를 넣을지 결정 필요.
