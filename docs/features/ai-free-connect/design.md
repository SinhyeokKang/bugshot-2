# 무료 AI 연결 — 기술 설계

## 개요

새 모달 `FreeLlmConnectDialog`를 추가하고, 연결 전 화면(`LlmOnboarding`)에서 연다. 결과물은 기존과 같은 `LlmConfig`다. 여기에 선택 필드 `freeTier?: true`만 얹으므로, 연결 후 화면(`LlmConnected`)과 AI 호출 경로(`createOpenAICompatibleProvider`·`byokCapabilities`)는 그대로 동작한다.

경로별 처리는 이렇다.

- **Gemini**: `chrome.windows.create({ type: "popup" })`로 발급 페이지를 띄운다. 키 입력·검증은 `LlmConnectDialog.handleConnect`에서 떼어낸 `connectProvider()`를 공유한다.
- **OpenRouter**: 사이드패널에서 `chrome.identity.launchWebAuthFlow`로 PKCE를 돌린다. background OAuth 체계(`PlatformId`·`oauth-proxy`)는 쓰지 않는다. secret이 없어 proxy가 필요 없다. 그리고 패널은 `@/background/*`를 value import할 수 없다(CLAUDE.md 번들 경계).

순수 로직(PKCE, URL 빌드, 콜백 파싱, 모델 필터, 키 교환, 집계 props)은 `sidepanel/lib/`에 두고 테스트로 고정한다. 브라우저 API를 호출하는 얇은 런처 하나만 browser-bound로 분리한다.

## 변경 범위

### 새 파일

| 파일 | 역할 |
|---|---|
| `src/lib/llm-provider-ids.ts` | `LLM_PROVIDER_IDS` 상수 tuple과 `LlmProviderId` 타입. 런타임 import 0인 leaf다. 패널 프리셋과 background 집계 가드가 공유한다(패널↔background 양방향 import 금지라 `src/lib/` leaf로 둔다). |
| `src/sidepanel/lib/free-llm.ts` | 무료 경로 순수 로직: 프리셋 메타(`FREE_LLM_PRESETS`), AI Studio URL, OpenRouter PKCE(`createPkcePair`), 인가 URL 빌드, 콜백 파싱, 키 교환(`exchangeOpenRouterCode` — `fetch` 주입), 무료+이미지 모델 필터(`pickFreeVisionModels`), 모델 조회(`fetchOpenRouterFreeVisionModels`), 런처 취소 판정(`isAuthFlowCancelled`), 그리고 **이 조각들을 조립하는 `runOpenRouterAuth(deps)`**. 조립까지 여기 둬야 reject→cancelled 매핑 분기가 테스트 안에 들어온다(POSTMORTEM 2026-07-30: 이 자리 분기 8곳이 dead code였다). |
| `src/sidepanel/lib/track-llm.ts` | `llmConnectProperties(baseUrl, path, result)` 순수 함수와 `trackLlmConnect()`(`sendBg` fire-and-forget). `track-submit.ts`와 같은 형태다. |
| `src/sidepanel/openrouter-auth.ts` | browser-bound 바인딩만 한다. `launchOpenRouterAuth()`는 `runOpenRouterAuth({ launch: (url) => chrome.identity.launchWebAuthFlow({ url, interactive: true }), redirectUrl: chrome.identity.getRedirectURL(), random: crypto.getRandomValues, fetchImpl: fetch })`이고 분기 로직은 없다. `scripts/coverage-report.mjs` `BROWSER_BOUND_EXACT`에 등재한다. |
| `src/sidepanel/tabs/settings/FreeLlmConnectDialog.tsx` | 2단계 모달(UI). |

### 변경 파일

| 파일 | 현재 역할 | 변경 |
|---|---|---|
| `src/sidepanel/lib/ai-provider.ts` | 프리셋·모델 상수·`fetchModels`·`requestHostPermission` | ① `ModelEntry`에 `freeTier?: true` 추가 ② `GEMINI_MODELS`를 스파이크 결과로 갱신하고(`gemini-2.0-flash` 삭제 — 2026-06-01 종료), 무료 티어 모델에 `freeTier: true` 표기, 모듈 상수 `GEMINI_FREE_MODELS = GEMINI_MODELS.filter(m => m.freeTier)` 추가(렌더 안에서 filter하면 `loadModels` useCallback·effect 의존성이 매번 바뀐다) ③ `PROVIDER_PRESETS`의 `id`를 `LlmProviderId`로 타입 고정 ④ `connectProvider(baseUrl, apiKey): Promise<ModelEntry[]>` 추출(URL 검증·`isCredentialSafeUrl`·`requestHostPermission`·kind별 모델 결정 — 지금 `handleConnect` 본문 그대로) ⑤ `presetIdOf(baseUrl): LlmProviderId \| "custom"` 추가(Task 1) ⑥ `connectErrorKey(err): TranslationKey` — 두 다이얼로그가 공유하는 에러→토스트 키 매핑 |
| `src/sidepanel/tabs/settings/LlmConnectDialog.tsx` | BYOK 연결 다이얼로그 | `handleConnect`가 `connectProvider()`·`connectErrorKey()`를 호출하도록 교체(동작 동일). 집계는 모달이 닫힐 때 1회 `trackLlmConnect(baseUrl, "byok", 결과)`(prd 목표 7 규칙). `LlmModelDialog`를 export해 무료 모달이 재사용한다. |
| `src/sidepanel/tabs/settings/LlmConnectForm.tsx` | 온보딩/연결 화면 | `LlmOnboarding`: 버튼 영역을 `flex flex-wrap justify-center gap-2`로 바꾼다(SettingsFooter 선례 — Button 기본 `whitespace-nowrap`이라 fr/es/de 360px에서 넘친다). [무료 AI 연결](outline)을 [API 키 연결](primary) 왼쪽에 두고 `FreeLlmConnectDialog`를 마운트한다. `LlmConnected`: `llm.freeTier`일 때 OpenRouter는 `fetchOpenRouterFreeVisionModels`, Gemini는 `GEMINI_FREE_MODELS`를 쓴다. `loadModels` 의존성에 `llm.freeTier`를 추가한다. |
| `src/store/settings-ui-store.ts` | `LlmConfig`·persist(v11) | `freeTier?: true` 추가. 이 필드는 선택 필드라 migration이 필요 없다(없으면 기존 동작). API 키 난독화 경로는 `apiKey`만 건드리므로 무관하다. **별도로 v12 migration을 추가한다**: `llm.baseUrl`이 Gemini preset이고 `modelId`가 `gemini-2.0-flash`로 시작하면 `gemini-2.5-flash`로 교체한다(2026-06-01 종료 모델 — 사용자 결정). 2.5-flash는 기존 목록에 있던 검증된 ID다. |
| `src/background/analytics.ts` | `ALLOWED_EVENTS` | `llm_connect: ["provider", "path", "result"]` 추가. `filterProperties`에서 이 이벤트의 값을 enum으로 검사한다: provider ∈ `LLM_PROVIDER_IDS ∪ {custom}`, path ∈ `{free, byok}`, result ∈ `{success, cancelled, failed}`. 목록 밖 값은 키째 뺀다. 지금은 값이 원문 통과라, 이 이벤트에서는 그게 custom base URL 유출 통로가 된다. |
| `src/i18n/namespaces/settings.ts` | settings 사전 6로케일 | `llm.free.*` 키 추가(아래 목록). ko·en·fr·es·de·ja 동시 갱신. |
| `scripts/coverage-report.mjs` | 로직 스코프 판정 | `src/sidepanel/openrouter-auth.ts`를 `BROWSER_BOUND_EXACT`에 추가. |
| `docs/privacy.ko.md` · `docs/privacy.en.md` | 개인정보처리방침 | tasks Task 6 참조. 시행일 갱신. |
| `docs/ARCHITECTURE.md` · `docs/DIRECTORY.md` | 설계·디렉터리 문서 | AI 통합 절에 무료 경로 단락, 집계 이벤트 수 5→6. DIRECTORY에 신규 파일 5개. |
| `e2e/fixtures/settings.ts` | e2e 설정 탭 진입 | `openSettings`에 `"ai"` 서브탭 추가. |
| `docs/PERMISSION.md` | 권한 레퍼런스 | `identity`(OpenRouter 키 발급, 플랫폼 OAuth와 별개 경로)와 `chrome.windows.create`(권한 불요) 사용처 추가. |
| `guide/ko/settings/ai.md` · `guide/en/settings/ai.md` | 사용자 가이드 | "무료로 연결하기" 절 추가. |

### i18n 키 (settings namespace)

```
llm.free.button                  무료 AI 연결
llm.free.dialog.title            무료로 AI 연결
llm.free.dialog.body             무료 티어로 AI 기능을 쓸 수 있습니다. 무료 티어는 데이터 취급이 유료와 다릅니다
llm.free.gemini.title            Gemini (Google AI Studio)
llm.free.gemini.model            Gemini Flash · 이미지 입력 지원
llm.free.gemini.limit            Google이 정한 무료 한도 안에서 사용 (Pro 모델은 무료 티어 미지원)
llm.free.gemini.privacy          무료 티어에서는 보낸 프롬프트·스크린샷이 Google 제품 개선에 쓰일 수 있습니다 (EEA·영국·스위스 제외)
llm.free.openrouter.title        OpenRouter
llm.free.openrouter.model        무료 공개 모델 중 이미지 입력 지원 모델
llm.free.openrouter.limit        하루 50회 (크레딧 $10 이상 구매 계정은 1,000회)
llm.free.openrouter.privacy      무료 모델은 제공사가 프롬프트를 기록할 수 있습니다. 발급된 키는 OpenRouter 계정에 남습니다
llm.free.next                    다음
llm.free.back                    이전
llm.free.gemini.keyTitle         AI Studio에서 발급한 키를 붙여넣으세요
llm.free.gemini.reopen           발급 페이지 다시 열기
llm.free.gemini.keyHelp          열린 창에서 [API 키 만들기]로 키를 만든 뒤 복사해 붙여넣으세요
llm.free.openrouter.waiting      OpenRouter 창에서 로그인하고 승인하세요. 처음 가입하면 안내가 끝난 뒤 창을 닫고 [다음]을 다시 누르세요
llm.free.openrouter.signupHint   처음 가입하면 OpenRouter 안내가 끝난 뒤 창을 닫고 [다음]을 다시 누르세요
llm.free.openrouter.appNameNote  승인 화면에 앱 이름이 "An app", 주소가 chromiumapp.org로 표시됩니다. BugShot이 맞습니다
llm.free.error.modelUnavailable  이 모델은 지금 쓸 수 없습니다. 다른 모델을 골라 주세요
llm.free.error.openrouter        OpenRouter 연결에 실패했습니다
llm.free.error.noFreeVisionModel 지금 쓸 수 있는 무료 이미지 모델이 없습니다. Gemini로 연결해 보세요
```

기존 키 재사용: `llm.apiKey`·`llm.apiKeyPlaceholder`·`platform.connect`·`common.close`·`llm.error.*`·`llm.model.*`.

## 데이터 흐름

```
LlmOnboarding ─[무료 AI 연결]→ FreeLlmConnectDialog(step="pick")
  │
  ├─ Gemini 선택 + [다음]
  │    chrome.windows.create({ url: AI_STUDIO_KEY_URL, type:"popup", width:520, height:760 })  // 위치는 Chrome 기본
  │    step="geminiKey" → 키 입력 → [연결]
  │      connectProvider(GEMINI_BASE_URL, key)          // requestHostPermission → fetchModels(검증)
  │      ├ throw → toast(connectErrorKey(err)), hadError=true, step 유지
  │      → models = GEMINI_FREE_MODELS
  │      → LlmModelDialog(pending) → onSelect(modelId)
  │      → setLlm({ baseUrl, apiKey, modelId, freeTier:true }), connected=true
  │
  └─ OpenRouter 선택 + [다음] (busy=true, attempt = ++attemptRef)
       issuedKeyRef.current 있으면 → 인가 생략, 곧장 ok(key) 분기로
       없으면 launchOpenRouterAuth() → runOpenRouterAuth(deps)
         createPkcePair() → buildOpenRouterAuthUrl({ callbackUrl: redirectUrl, challenge, state })
         → deps.launch(url)
         → parseOpenRouterCallback(redirect, state) → code
         → exchangeOpenRouterCode(code, verifier)   // POST /api/v1/auth/keys → { key, user_id }
       (도착 시 attempt !== attemptRef.current 이면 결과 전체 무시)
       ├ cancelled → step 유지, 토스트 없음
       ├ throw     → toast(llm.free.error.openrouter), hadError=true
       └ ok(key) → issuedKeyRef.current = key   // 모달 수명 동안만 메모리 보관
           fetchOpenRouterFreeVisionModels(key)    // GET /api/v1/models → pickFreeVisionModels
           ├ throw → toast(llm.free.error.openrouter), hadError=true
           ├ []    → toast(noFreeVisionModel), hadError=true
           └ list  → LlmModelDialog → [확인](modelId)
                probeOpenRouterModel(key, modelId)   // POST chat/completions, 고정 텍스트 "ping", max_tokens 16
                ├ "unavailable"(403·404) → toast(modelUnavailable), hadError=true, 다이얼로그 유지
                └ "ok" | "transient"(429·5xx·네트워크) → setLlm({ OPENROUTER_BASE_URL, key, modelId, freeTier:true }), connected=true
           모델 다이얼로그 닫기 → step=pick, issuedKeyRef 유지 → 다시 [다음]은 로그인 없이 목록부터

모달 닫힘(onOpenChange(false)) 시 1회
  trackLlmConnect(lastBaseUrl, "free", connected ? "success" : hadError ? "failed" : "cancelled")
  (아무 카드도 안 고르고 닫으면 provider 생략)
  ++attemptRef → 진행 중이던 OpenRouter 결과 무효화, issuedKeyRef = null, 상태 전부 리셋

LlmConnected (llm.freeTier)
  OpenRouter → fetchOpenRouterFreeVisionModels(llm.apiKey)
  Gemini     → GEMINI_MODELS.filter(freeTier)
  그 외/표식 없음 → 기존 경로

trackLlmConnect → sendBg({ type:"analytics.capture", event:"llm_connect", properties })
  → background filterProperties(event === "llm_connect" 스코프의 enum 가드) → PostHog
LlmConnectDialog(BYOK)도 같은 규칙: 닫힘 시 1회, path="byok"
```

스토리지: `chrome.storage.local`의 settings-ui persist(`llm`)에 `freeTier` 필드 하나가 늘어난다. 새 메시지 타입은 없다(`analytics.capture` 재사용).

## 인터페이스 설계

```ts
// src/lib/llm-provider-ids.ts
export const LLM_PROVIDER_IDS = [
  "openai", "anthropic", "gemini", "mistral", "groq", "together", "openrouter", "ollama",
] as const;
export type LlmProviderId = (typeof LLM_PROVIDER_IDS)[number];

// src/store/settings-ui-store.ts
export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  freeTier?: true;
}

// src/sidepanel/lib/ai-provider.ts
export interface ModelEntry {
  id: string;
  freeTier?: true;
}
export interface ProviderPreset {
  id: LlmProviderId;
  label: string;
  baseUrl: string;
  kind: ProviderKind;
}
// PROVIDER_PRESETS baseUrl과 정확 일치만 프리셋 ID (getProviderLabel과 같은 규칙 — trailing slash 붙으면 custom).
export function presetIdOf(baseUrl: string): LlmProviderId | "custom";
// handleConnect 본문 이동. 실패는 throw(URL 오류·insecure·권한 거부는 각자 Error 서브클래스).
// apiKey는 진입 시 trim한다 — 검증·저장 모두 trim된 값(BYOK의 공백 섞인 키 실패 결함도 함께 고친다).
// 호출부가 저장할 키를 알 수 있게 반환형에 trim된 키를 싣는다.
export class LlmInvalidUrlError extends Error {}
export class LlmInsecureUrlError extends Error {}
export class LlmPermissionDeniedError extends Error {}
export function connectProvider(
  baseUrl: string, apiKey: string,
): Promise<{ models: ModelEntry[]; apiKey: string }>;
// 에러→토스트 키 단일 출처. 두 다이얼로그가 공유한다(llmErrorToast 선례).
// InvalidUrl→llm.error.invalidUrl, Insecure→insecureUrl, PermissionDenied→permission,
// LlmRedirectError→redirect, 그 외(LlmAuthError 포함)→fetch. toastLlmError로 바꾸지 않는다.
export function connectErrorKey(err: unknown): TranslationKey;
export const GEMINI_FREE_MODELS: readonly ModelEntry[];

// src/sidepanel/lib/free-llm.ts
export type FreeLlmPresetId = "gemini" | "openrouter";
export const AI_STUDIO_KEY_URL = "https://aistudio.google.com/apikey";
export const OPENROUTER_AUTH_URL = "https://openrouter.ai/auth";
export const OPENROUTER_KEYS_URL = "https://openrouter.ai/api/v1/auth/keys";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"; // PROVIDER_PRESETS openrouter와 동일값(테스트로 대조)

export interface PkcePair { verifier: string; challenge: string; }
export function createPkcePair(random?: (n: number) => Uint8Array): Promise<PkcePair>; // S256, verifier 43~128자
export function buildOpenRouterAuthUrl(p: {
  callbackUrl: string; challenge: string; state: string; keyLabel: string;
}): string;
export type OpenRouterCallback = { code: string } | { cancelled: true };
// state 불일치·code 누락·malformed URL은 throw. 거부(error 파라미터) → cancelled.
export function parseOpenRouterCallback(redirectUrl: string, expectedState: string): OpenRouterCallback;
export function exchangeOpenRouterCode(
  code: string, verifier: string, fetchImpl?: typeof fetch,
): Promise<string>; // redirect:"manual", !ok·key 누락 throw
export interface OpenRouterModelRaw {
  id: string;
  architecture?: { input_modalities?: string[] };
}
// id가 ":free"로 끝나고 input_modalities에 "image"가 있는 것만, id 정렬.
// pricing은 보지 않는다 — 시간대별 overrides가 있어 base 값만으론 판정이 틀린다(2026-10 실측).
export function pickFreeVisionModels(raw: OpenRouterModelRaw[]): ModelEntry[];
export function fetchOpenRouterFreeVisionModels(apiKey: string, fetchImpl?: typeof fetch): Promise<ModelEntry[]>;
// launchWebAuthFlow reject 메시지 → 취소 여부. background LAUNCH_FLOW_ERRORS의 cancelled 행과 같은 정규식.
export function isAuthFlowCancelled(message: string): boolean;
export interface OpenRouterAuthDeps {
  launch(url: string): Promise<string | undefined>;
  redirectUrl: string;
  random(n: number): Uint8Array;
  fetchImpl: typeof fetch;
}
export type OpenRouterAuthResult = { status: "ok"; key: string } | { status: "cancelled" };
// PKCE·state 생성 → launch → reject면 isAuthFlowCancelled로 cancelled/throw → 콜백 파싱 → 교환.
export function runOpenRouterAuth(deps: OpenRouterAuthDeps): Promise<OpenRouterAuthResult>;
// 선택 모델 1회 프로브. 사용자 콘텐츠 없이 고정 텍스트만 보낸다.
// 403·404 → "unavailable"(정책 제한, Task 0: inkling "agentic harnesses only"), 429·5xx·네트워크 오류 → "transient"(통과), 2xx → "ok".
export type ProbeResult = "ok" | "unavailable" | "transient";
export function probeOpenRouterModel(apiKey: string, modelId: string, fetchImpl?: typeof fetch): Promise<ProbeResult>;

// src/sidepanel/lib/track-llm.ts
export type LlmConnectPath = "free" | "byok";
export type LlmConnectResult = "success" | "cancelled" | "failed";
export function llmConnectProperties(
  baseUrl: string, path: LlmConnectPath, result: LlmConnectResult,
): { provider: LlmProviderId | "custom"; path: LlmConnectPath; result: LlmConnectResult };
export function trackLlmConnect(baseUrl: string, path: LlmConnectPath, result: LlmConnectResult): void;

// src/sidepanel/openrouter-auth.ts (browser-bound, 바인딩만)
export function launchOpenRouterAuth(): Promise<OpenRouterAuthResult>;
```

`FreeLlmConnectDialog`의 형태는 아래와 같다.

- **props**: `{ open: boolean; onOpenChange(v: boolean): void }`로 `LlmConnectDialog`와 같다.
- **내부 상태**: `step: "pick" | "geminiKey"`, `selected: FreeLlmPresetId | null`, `apiKey`, `busy`, `pendingModels`, 집계용 `connected`·`hadError`, 그리고 발급 키 `issuedKeyRef`(ref — 렌더에 안 쓰이고 store·storage에 쓰지 않는다).
- **OpenRouter 카드 문구**: 모델·한도·프라이버시에 더해 `signupHint`·`appNameNote` 두 줄을 넣는다. 카드가 길어지는 건 위 스크롤 영역으로 흡수한다.
- **바깥 클릭 차단**: 외부 창을 오가는 모달이라 `DialogContent`에 `onInteractOutside={(e) => e.preventDefault()}`를 건다(JiraConnectForm SetupDialog 선례). 닫기는 X·Esc로만 한다.
- **닫힐 때**: 상태를 전부 리셋한다.
- **이전 시도 무효화**: 시도마다 증가하는 `attemptRef`(세대 번호)로 결과를 대조해, 닫힌 뒤 또는 재오픈 뒤 도착한 이전 시도의 결과를 무시한다. boolean `cancelledRef`는 재오픈하면 false로 돌아가서 이전 결과를 통과시킨다(`LlmConnectDialog.tsx:124-129`).
- **중복 실행 방지**: `busy`는 state가 아니라 ref로 동기 가드한다. dblclick 한 번에 flow가 두 번 뜨지 않게 하려는 것이다.
- **제목·설명**: `DialogTitle`은 `llm.free.dialog.title`로 고정한다. `DialogDescription`은 하나만 렌더하고 step별 문구만 바꾼다.
- **포커스**: geminiKey로 진입하면 키 Input에 autoFocus를 준다. [이전]으로 돌아오면 선택돼 있던 카드에 `focus()`한다.
- **키 입력란**: 라벨은 기존 `llm.apiKey`, 도움말은 `llm.free.gemini.keyHelp`. 키는 `trim()`한 값이 비어 있으면 [연결]을 비활성화한다.
- **OpenRouter 대기 중**: `role="status"` 한 줄로 `llm.free.openrouter.waiting`을 보여준다.

## 기존 패턴 준수

- **번들 경계**: 패널은 `@/background/oauth`의 `launchOAuthWebFlow`·`classifyLaunchFlowError`를 import하지 않는다. 취소 정규식 하나만 `free-llm.ts`에 복제하고 출처 주석을 단다. 공유 enum은 `src/lib/` leaf(`llm-provider-ids.ts`)로 둔다(`lib/jira-sprint.ts` 선례). 이 leaf의 "런타임 import 0"은 자동 스캔이 없으므로 `bundleBoundary.test.ts`에 session-keys 블록과 같은 형태의 describe를 새로 둔다. PKCE 구현은 `gitlab-oauth.ts`·`linear-oauth.ts`에 이어 세 번째 사본이 된다(통합은 범위 밖).
- **집계 허용목록은 값까지 잠근다**: `analytics.ts` 주석이 경고하는 "임의 문자열 통과"를 새 이벤트에서 되풀이하지 않는다. 런타임 값 검사의 선례는 locale 3키(`analytics.ts:74-76`)다. `platform_connect.reason`은 TS 타입으로만 enum이고 런타임 검사는 없다. 이번 가드는 **`event === "llm_connect"` 스코프**로 건다. 키 이름 기준으로 걸면 `issue_submitted.result: "failure"`가 무음으로 버려진다. 송신 함수 ↔ 허용목록 왕복 테스트로 POSTMORTEM `trim_source` 드리프트(송신부에만 있고 허용목록에 없어 무음으로 버려진 사례)를 막는다.
- **i18n 동시 갱신**: `settings.ts` 6로케일. 훅이 `locales.test.ts`로 대칭을 검사한다. log-viewer 사전은 무관하다(설정 화면 키).
- **UI**: shadcn `Dialog`·`Button`·`Input`을 재사용한다.
  - **모달 높이**: `DialogContent`는 `flex max-h-[80vh] w-[90vw] max-w-[800px] flex-col gap-5 rounded-3xl p-6`로 둔다(DraftEditDialog 선례). 기본값 `h-fit overflow-hidden`은 max-h가 없어서, de/fr에서 [다음]이 잘린다(`dialog.tsx:46`, `WebhookConnectForm.tsx:106-108` 선례 주석).
  - **스크롤**: 카드 목록은 `min-h-0 flex-1 overflow-y-auto overscroll-contain`으로 감싸 푸터가 항상 보이게 한다. 카드는 1열로 쌓는다(콘텐츠 폭 240~276px). `DialogFooter`는 `className="flex-row justify-end"`.
  - **카드 시맨틱**: 이미 설치된 `ToggleGroup type="single"`로 만든다. root에 `role="radiogroup"`을 두고, 각 item에 `aria-labelledby`=제목 id, `aria-describedby`=모델·한도·프라이버시 id를 건다. 다시 눌러 선택이 풀리지 않도록 `onValueChange={(v) => v && setSelected(v)}`. RadioGroup은 미설치고, `aria-pressed`는 둘 중 하나를 고르는 의미와 맞지 않는다.
  - **선택 표시와 대비**: 선택 상태는 배경 대신 `border-primary ring-1 bg-background`로 보여준다. 프라이버시 문구는 `text-foreground/80`이다. `bg-accent`는 `--muted`와 같은 값이라, 그 위에 `text-muted-foreground`를 쓰면 4.34:1이 된다. 자식으로 나뉜 클래스라 대비 테스트가 이 조합을 못 잡는다.
  - `FieldRow`는 그대로 쓴다.
  - 착수 전 DESIGN.md를 읽는다.
- **테스트 2트랙**: 순수 함수는 `*.test.ts`, 모달 단계 전이는 `*.test.tsx`(jsdom).
- **Privacy 문서는 동작에 묶인다**: `chrome.identity` 새 목적 사용과 신규 외부 fetch 2건이 트리거다. ko 원본, en 번역, 시행일.

## 대안 검토

1. **Gemini도 기존 `LlmConnectDialog`를 preset 선택 상태로 열기** — 코드는 적지만 모달이 한 번 바뀌고 provider 콤보가 노출된다. 사용자가 "같은 모달 2단계"를 선택해 기각.
2. **AI Studio를 새 탭으로 열기** — 탭 스코프라 새 탭으로 가면 패널이 닫힌다. 키를 붙여넣을 곳이 사라지고 모달 상태 보존도 미검증이다. 팝업 창은 원래 창의 활성 탭을 바꾸지 않는다.
3. **OpenRouter PKCE를 background 메시지로 처리** — 기존 OAuth 레인과 대칭이지만, 키가 패널 store(`settings-ui-store`)로 가야 하므로 왕복만 는다. `PlatformId`·`ConnectReason` 체계에 LLM을 끼워 넣어야 하는 비용도 있다. secret이 없어 background에 둘 이유가 없다.
4. **무료 판정을 `pricing.prompt === "0"`으로** — 실측(2026-10) 응답에 시간대별 `pricing.overrides`가 있어 base 값만으로는 정확하지 않다. `:free` 접미사는 OpenRouter의 무료 변형 명명 규약이라 그쪽을 쓴다.
5. **텍스트 전용 무료 모델 폴백 + 모델 단위 capability** — 0개 문제를 풀지만 `byokCapabilities`를 모델 축으로 넓혀야 한다. 사용자가 "연결 막고 안내"를 선택해 기각.

## 위험 요소

- **R1. OpenRouter callback — 해소(2026-10-18 Task 0).** `chromiumapp.org` callback이 허용되고 `state`도 그대로 돌아온다. 정책이 바뀌어 거부되면 **Gemini만으로 출시**한다(사용자 결정). 그때 OpenRouter는 DROPPED.md에 "재검토 조건: callback 허용"으로 기록한다.
- **R1-b. state echo — 해소.** Task 0에서 보낸 `state`가 그대로 돌아오는 것을 확인했다. 앞으로 echo가 끊기면 state를 callback_url 쿼리(`getRedirectURL()+"?s=<state>"`)에 실어 검증한다. 그것도 막히면 PKCE만으로 간다(verifier가 code를 바인딩한다).
- **R2. `GEMINI_MODELS` 하드코딩 — 부분 해소.** 공식 문서로 `gemini-2.0-flash` 종료(2026-06-01)를 확인했다. **기존 BYOK Gemini 사용자에게도 해당하는 현행 결함**이다. 갱신안은 tasks 스파이크 결과 T0-2에 있다. 무료 키로 실호출해서 OpenAI 호환 모델 ID 표기를 확인하는 단계가 남아 있다.
- **R3. 무료 모델 목록 변동.** OpenRouter `:free` 목록은 수시로 바뀐다(2026-10 실측: :free+image 8개). 그래서 하드코딩 없이 매번 조회한다. 목록에 content-safety 분류기 같은 비채팅 모델이 섞일 수 있지만 이번 범위에서 의미 필터는 하지 않는다.
- **R4. `launchWebAuthFlow`를 패널 문서에서 호출.** 대기 중에 패널 문서가 사라지면(사용자가 탭을 옮겨 패널이 닫힘) Promise가 버려진다. 발급된 키는 사용자 계정에만 남는다. 손실은 "다시 연결" 한 번이라 수용한다.
- **R5. 무료 한도 문구의 신선도.** "하루 50회" 같은 수치는 provider 정책이라 바뀔 수 있다. 정적 문구로 두고 privacy·가이드와 같은 출처를 갖게 한다. 바뀌면 i18n 6곳과 문서 2곳을 갱신한다.
- **R6. `connectProvider` 추출 회귀.** BYOK 연결은 지금 테스트가 없다(`tabs/settings/` 테스트 0개). 추출 전에 에러 분기(invalid URL·insecure·권한 거부·redirect·fetch 실패)를 단위 테스트로 먼저 고정하고, `LlmConnectDialog.test.tsx`를 새로 만든다. 추출하면 `cancelledRef` 중간 체크(`LlmConnectDialog.tsx:168`)가 사라져서, 닫힌 뒤에도 네트워크 요청이 1회 더 나갈 수 있다. 이건 허용한다.
- **R7. 연결 해제 후에도 OpenRouter 키가 살아 있음.** revoke는 비목표다. 카드 문구·privacy·가이드 3곳에 고지한다. 같은 모달 안의 재시도는 `issuedKeyRef` 재사용으로 키를 새로 만들지 않는다.
- **R8. 신규 가입 온보딩이 인가로 돌아오지 않음(Task 0 실측).** 온보딩 마지막 화면이 [Go to Dashboard]뿐이다. 그래서 카드(`signupHint`)와 대기 문구(`waiting`)로 "창을 닫고 [다음]을 다시 누르라"를 안내한다. 창을 닫는 것은 cancelled 경로라 추가 코드가 없다. OpenRouter가 온보딩 흐름을 고치면 문구만 걷어낸다.
- **R9. 필터를 통과해도 부를 수 없는 모델(Task 0 실측 8개 중 정상 3개).** 403(정책 제한)은 선택 직후 프로브로 거른다. 429(상류 혼잡)는 일시적이라 통과시킨다. 그래서 첫 초안이 429로 실패할 수는 있고, 이건 기존 `llm.error.quota` 토스트가 안내한다. 프로브는 고정 텍스트만 보내므로 privacy의 "모델 목록 조회" 항목과 같은 성격(사용자 콘텐츠 없음)으로 고지한다.
- **R10. 승인 화면 "An app" 표기.** 앱 이름이 표시되지 않아 사용자가 거부할 수 있다. 카드(`appNameNote`)로 미리 알린다.
