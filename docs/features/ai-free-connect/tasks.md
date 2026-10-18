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
  - [ ] callback 허용 여부 확정 (허용 → 전체 범위 / 거부 → Gemini만, DROPPED.md 항목 초안)
  - [ ] `GEMINI_MODELS` 새 목록과 무료 티어 대상 확정
  - [ ] OpenRouter 무료 vision 모델 응답 확인

### Task 1: 공용 leaf + 집계 가드
- **변경 대상**: `src/lib/llm-provider-ids.ts`(신규), `src/background/analytics.ts`, `src/sidepanel/lib/track-llm.ts`(신규)
- **작업 내용**: `LLM_PROVIDER_IDS` 정의. `ALLOWED_EVENTS.llm_connect` 추가 + `filterProperties`에 이 이벤트의 값 enum 가드. `llmConnectProperties`·`trackLlmConnect` 구현.
- **검증**:
  - [ ] `analytics` 테스트: `llm_connect` 허용 키 3개만 통과, provider에 URL·임의 문자열을 넣으면 그 키가 빠짐, path/result도 enum 밖이면 빠짐
  - [ ] `track-llm` 테스트: 프리셋 baseUrl → ID, 프리셋과 다른 URL(`http://localhost:1234/v1`, 사내 vLLM) → `custom`, trailing slash 차이 처리 규칙 고정
  - [ ] `lib/llm-provider-ids.ts`가 런타임 import 0 (`bundleBoundary`/소스 스캔 그물에 걸리면 등재)
  - [ ] `PROVIDER_PRESETS`의 id 집합 == `LLM_PROVIDER_IDS` (테스트로 대조)

### Task 2: `ai-provider` 정리 — 연결 로직 추출 + 모델 표기
- **변경 대상**: `src/sidepanel/lib/ai-provider.ts`, `src/sidepanel/tabs/settings/LlmConnectDialog.tsx`, `src/store/settings-ui-store.ts`
- **작업 내용**: `ModelEntry.freeTier`, `LlmConfig.freeTier` 추가. Task 0 결과로 `GEMINI_MODELS` 갱신. `presetIdOf`·`connectProvider`와 에러 클래스 3종 추출. `handleConnect`를 `connectProvider` 호출로 교체하고 `trackLlmConnect(…, "byok", …)` 호출을 추가한다(성공 = `handleModelSelect`, 실패 = catch). `LlmModelDialog` export.
- **검증**:
  - [ ] **추출 전에** `connectProvider` 테스트 작성(red): invalid URL / insecure http 원격 / 권한 거부 / anthropic ping / gemini → `GEMINI_MODELS` / 그 외 → fetched / redirect → `LlmRedirectError`
  - [ ] 추출 후 green, BYOK 다이얼로그 토스트 키 매핑이 기존과 동일
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
  - [ ] `OPENROUTER_BASE_URL` == `PROVIDER_PRESETS` openrouter baseUrl

### Task 4: OpenRouter 런처 (browser-bound)
- **변경 대상**: `src/sidepanel/openrouter-auth.ts`(신규), `scripts/coverage-report.mjs`
- **작업 내용**: `launchOpenRouterAuth()`. `crypto.getRandomValues`로 state를 만들고, `chrome.identity.getRedirectURL()`로 callback을 정한 뒤 `launchWebAuthFlow`를 연다. reject 메시지가 `isAuthFlowCancelled`면 `{status:"cancelled"}`를 돌려준다. 그 다음 파싱 → 교환. `BROWSER_BOUND_EXACT` 등재.
- **검증**:
  - [ ] `pnpm typecheck`
  - [ ] 커버리지 리포트에서 로직 스코프 분모에 안 잡힘

### Task 5: `FreeLlmConnectDialog` + 온보딩·연결 화면
- **변경 대상**: `src/sidepanel/tabs/settings/FreeLlmConnectDialog.tsx`(신규), `src/sidepanel/tabs/settings/LlmConnectForm.tsx`, `src/i18n/namespaces/settings.ts`
- **작업 내용**: design의 데이터 흐름대로 2단계 모달. 온보딩 버튼 2개 배치(무료 = outline, 왼쪽). `LlmConnected`의 `freeTier` 필터. i18n 6로케일.
- **검증** (`FreeLlmConnectDialog.test.tsx`, jsdom):
  - [ ] 카드 미선택 시 [다음] 비활성, 카드마다 모델·한도·프라이버시 문구 렌더
  - [ ] Gemini + [다음] → `chrome.windows.create`가 `AI_STUDIO_KEY_URL`·`type:"popup"`으로 1회 호출, step=geminiKey
  - [ ] "발급 페이지 다시 열기" → 다시 호출 / [이전] → pick, 입력 리셋
  - [ ] Gemini [연결] → 모델 다이얼로그에 `freeTier` 모델만, 선택 시 `setLlm`에 `freeTier:true`
  - [ ] OpenRouter cancelled → 토스트 없음, pick 유지, `trackLlmConnect(...,"cancelled")`
  - [ ] OpenRouter 0개 모델 → `noFreeVisionModel` 토스트, `setLlm` 미호출
  - [ ] 진행 중 [다음] 비활성(중복 실행 없음), 닫힌 뒤 도착한 결과 무시
  - [ ] `LlmConnectForm`: `freeTier` OpenRouter 연결 시 모델 목록이 무료 필터 경로를 탐
  - [ ] `locales.test.ts` 대칭 green

### Task 6: 문서
- **변경 대상**: `docs/privacy.ko.md`·`docs/privacy.en.md`, `docs/PERMISSION.md`, `docs/ARCHITECTURE.md`(LLM 연결 절이 있으면 무료 경로 한 단락)
- **작업 내용**:
  - privacy: ① 외부 전송 표에 OpenRouter 키 발급(`openrouter.ai/auth`, `POST /api/v1/auth/keys` — 인가 code·PKCE verifier만, 캡처 데이터 없음)과 모델 목록 조회 추가 ② LLM 프로바이더 절에 무료 티어 고지(Gemini 학습 사용 가능성, OpenRouter 무료 모델 로깅, 해제해도 OpenRouter 키는 계정에 남음) ③ 익명 집계 절에 `llm_connect`(provider 프리셋 ID/custom·경로·결과, base URL·키·모델 ID 미전송) ④ 시행일
  - PERMISSION: `identity` 사용처에 OpenRouter 키 발급 추가, `chrome.windows.create` 사용(권한 불요)
- **검증**:
  - [ ] ko/en 섹션 대칭, 시행일 동일
  - [ ] privacy의 프리셋 목록 문장과 `PROVIDER_PRESETS` 일치

## 테스트 계획

- **단위 테스트**: Task 1~3, 5의 체크 항목. 신규 파일: `src/sidepanel/lib/__tests__/free-llm.test.ts`·`track-llm.test.ts`, `src/background/__tests__/analytics*.test.ts` 확장, `src/sidepanel/lib/__tests__/ai-provider.test.ts` 확장, `src/store/__tests__/settings-ui-store*.test.ts` 확장, `src/sidepanel/tabs/settings/__tests__/FreeLlmConnectDialog.test.tsx`.
- **e2e 시나리오**:
  - 설정 > AI 모델(연결 전)을 열면 [무료 AI 연결]과 [API 키 연결] 두 버튼이 보이고, 무료 버튼이 왼쪽에 있다.
  - [무료 AI 연결]을 누르면 Gemini·OpenRouter 카드 2개가 있는 다이얼로그가 뜨고, 카드를 고르기 전에는 [다음]이 비활성이다.
  - Gemini 카드 + [다음]을 누르면 `aistudio.google.com/apikey` 페이지가 새 창으로 열리고, 다이얼로그에 API 키 입력란이 보인다.
  - 2단계에서 [이전]을 누르면 카드 선택 화면으로 돌아간다.
- **수동 테스트**:
  - [ ] S1 실제 Gemini 무료 키로 연결 → AI 초안이 스크린샷 포함으로 생성
  - [ ] S2 실제 OpenRouter 로그인(신규 가입 포함) → 키 발급 → 무료 vision 모델로 AI 초안 생성
  - [ ] S2 로그인 창 닫기 → 토스트 없이 복귀
  - [ ] 연결 후 모델 콤보가 무료 모델로 필터됨(두 경로)
  - [ ] PostHog에서 `llm_connect` 이벤트 props 3개 확인(free·byok 각각)
  - [ ] 다크모드·좁은 패널 폭에서 카드 레이아웃

## 구현 순서 권장

Task 0 → (Task 1 ∥ Task 3) → Task 2 → Task 4 → Task 5 → Task 6.
Task 1과 Task 3은 서로 독립이다. Task 2는 Task 1의 `LlmProviderId`를 쓴다. Task 5는 2·3·4 전부에 의존한다. Task 0에서 OpenRouter가 거부되면 Task 3의 OpenRouter 함수, Task 4, Task 5의 OpenRouter 분기를 건너뛴다.

## 가이드 영향

- `settings/ai.md`(ko·en) — "연결하기" 앞에 "무료로 연결하기" 절 추가(두 프리셋, 프라이버시 차이, 한도). 연결 화면 스크린샷 `settings-ai-1.jpg` 재촬영 대상(`/guide-shots`).
- `settings/README.md`(ko·en) — AI 서브탭 요약에 무료 연결 한 줄.

## 스파이크 결과

(Task 0 완료 후 기록)
