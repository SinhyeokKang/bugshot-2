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
| `src/sidepanel/lib/free-llm.ts` | 무료 경로 순수 로직: 프리셋 메타(`FREE_LLM_PRESETS`), AI Studio URL, OpenRouter PKCE(`createPkcePair`), 인가 URL 빌드, 콜백 파싱, 키 교환(`exchangeOpenRouterCode` — `fetch` 주입), 무료+이미지 모델 필터(`pickFreeVisionModels`), 모델 조회(`fetchOpenRouterFreeVisionModels`), 런처 취소 판정(`isAuthFlowCancelled`). |
| `src/sidepanel/lib/track-llm.ts` | `llmConnectProperties(baseUrl, path, result)` 순수 함수와 `trackLlmConnect()`(`sendBg` fire-and-forget). `track-submit.ts`와 같은 형태다. |
| `src/sidepanel/openrouter-auth.ts` | browser-bound 런처: `launchOpenRouterAuth()` = PKCE 생성 → `launchWebAuthFlow` → 콜백 파싱 → 교환. 결과는 `{ status: "ok", key } \| { status: "cancelled" }`이고 실패는 throw. `scripts/coverage-report.mjs` `BROWSER_BOUND_EXACT`에 등재한다. |
| `src/sidepanel/tabs/settings/FreeLlmConnectDialog.tsx` | 2단계 모달(UI). |

### 변경 파일

| 파일 | 현재 역할 | 변경 |
|---|---|---|
| `src/sidepanel/lib/ai-provider.ts` | 프리셋·모델 상수·`fetchModels`·`requestHostPermission` | ① `ModelEntry`에 `freeTier?: true` 추가 ② `GEMINI_MODELS`를 선행 스파이크 결과로 갱신하고, 무료 티어 모델에 `freeTier: true` 표기 ③ `PROVIDER_PRESETS`의 `id`를 `LlmProviderId`로 타입 고정 ④ `connectProvider(baseUrl, apiKey): Promise<ModelEntry[]>` 추출(URL 검증·`isCredentialSafeUrl`·`requestHostPermission`·kind별 모델 결정 — 지금 `handleConnect` 본문 그대로) ⑤ `presetIdOf(baseUrl): LlmProviderId \| "custom"` 추가 |
| `src/sidepanel/tabs/settings/LlmConnectDialog.tsx` | BYOK 연결 다이얼로그 | `handleConnect`가 `connectProvider()`를 호출하도록 교체(동작 동일). 성공·실패 시 `trackLlmConnect(baseUrl, "byok", …)` 호출. `LlmModelDialog`를 export해 무료 모달이 재사용한다. |
| `src/sidepanel/tabs/settings/LlmConnectForm.tsx` | 온보딩/연결 화면 | `LlmOnboarding`: 버튼 영역을 `flex gap-2`로 바꾸고 [무료 AI 연결](outline)을 [API 키 연결](primary) 왼쪽에 둔다. `FreeLlmConnectDialog`를 마운트한다. `LlmConnected`: `llm.freeTier`일 때 OpenRouter는 `fetchOpenRouterFreeVisionModels`, Gemini는 `GEMINI_MODELS.filter(m => m.freeTier)`를 쓴다. |
| `src/store/settings-ui-store.ts` | `LlmConfig` | `freeTier?: true` 추가. 선택 필드라 persist version bump·migration이 없다(없으면 기존 동작). API 키 난독화 경로는 `apiKey`만 건드리므로 무관하다. |
| `src/background/analytics.ts` | `ALLOWED_EVENTS` | `llm_connect: ["provider", "path", "result"]` 추가. `filterProperties`에서 이 이벤트의 값을 enum으로 검사한다: provider ∈ `LLM_PROVIDER_IDS ∪ {custom}`, path ∈ `{free, byok}`, result ∈ `{success, cancelled, failed}`. 목록 밖 값은 키째 뺀다. 지금은 값이 원문 통과라, 이 이벤트에서는 그게 custom base URL 유출 통로가 된다. |
| `src/i18n/namespaces/settings.ts` | settings 사전 6로케일 | `llm.free.*` 키 추가(아래 목록). ko·en·fr·es·de·ja 동시 갱신. |
| `scripts/coverage-report.mjs` | 로직 스코프 판정 | `src/sidepanel/openrouter-auth.ts`를 `BROWSER_BOUND_EXACT`에 추가. |
| `docs/privacy.ko.md` · `docs/privacy.en.md` | 개인정보처리방침 | 아래 "문서 영향" 참조. 시행일 갱신. |
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
llm.free.error.openrouter        OpenRouter 연결에 실패했습니다
llm.free.error.noFreeVisionModel 지금 쓸 수 있는 무료 이미지 모델이 없습니다. Gemini로 연결해 보세요
```

기존 키 재사용: `llm.apiKey`·`llm.apiKeyPlaceholder`·`platform.connect`·`common.close`·`llm.error.*`·`llm.model.*`.

## 데이터 흐름

```
LlmOnboarding ─[무료 AI 연결]→ FreeLlmConnectDialog(step="pick")
  │
  ├─ Gemini 선택 + [다음]
  │    chrome.windows.create({ url: AI_STUDIO_KEY_URL, type:"popup", width:480, height:720 })
  │    step="geminiKey" → 키 입력 → [연결]
  │      connectProvider(GEMINI_BASE_URL, key)          // requestHostPermission → fetchModels(검증)
  │      → models = GEMINI_MODELS.filter(freeTier)
  │      → LlmModelDialog(pending) → onSelect(modelId)
  │      → setLlm({ baseUrl, apiKey, modelId, freeTier:true })
  │      → trackLlmConnect(baseUrl, "free", "success")
  │
  └─ OpenRouter 선택 + [다음] (busy=true)
       launchOpenRouterAuth()
         createPkcePair() → buildOpenRouterAuthUrl({ callbackUrl: identity.getRedirectURL(), challenge, state })
         → identity.launchWebAuthFlow({ url, interactive:true })
         → parseOpenRouterCallback(redirect, state) → code
         → exchangeOpenRouterCode(code, verifier)   // POST /api/v1/auth/keys → { key }
       ├ cancelled → trackLlmConnect(..., "cancelled"), step 유지, 토스트 없음
       ├ throw     → toast(llm.free.error.openrouter), "failed"
       └ ok(key)
           fetchOpenRouterFreeVisionModels(key)    // GET /api/v1/models → pickFreeVisionModels
           ├ []    → toast(noFreeVisionModel), "failed", key 폐기
           └ list  → LlmModelDialog → setLlm({ OPENROUTER_BASE_URL, key, modelId, freeTier:true }) → "success"

LlmConnected (llm.freeTier)
  OpenRouter → fetchOpenRouterFreeVisionModels(llm.apiKey)
  Gemini     → GEMINI_MODELS.filter(freeTier)
  그 외/표식 없음 → 기존 경로

trackLlmConnect → sendBg({ type:"analytics.capture", event:"llm_connect", properties })
  → background filterProperties(enum 가드) → PostHog
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
export function presetIdOf(baseUrl: string): LlmProviderId | "custom";
// handleConnect 본문 이동. 실패는 throw. 에러 → 토스트 키 매핑은 호출부가 유지한다
// (URL 오류·insecure·권한 거부는 각자 Error 서브클래스로 구분).
export class LlmInvalidUrlError extends Error {}
export class LlmInsecureUrlError extends Error {}
export class LlmPermissionDeniedError extends Error {}
export function connectProvider(baseUrl: string, apiKey: string): Promise<ModelEntry[]>;

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

// src/sidepanel/lib/track-llm.ts
export type LlmConnectPath = "free" | "byok";
export type LlmConnectResult = "success" | "cancelled" | "failed";
export function llmConnectProperties(
  baseUrl: string, path: LlmConnectPath, result: LlmConnectResult,
): { provider: LlmProviderId | "custom"; path: LlmConnectPath; result: LlmConnectResult };
export function trackLlmConnect(baseUrl: string, path: LlmConnectPath, result: LlmConnectResult): void;

// src/sidepanel/openrouter-auth.ts (browser-bound)
export type OpenRouterAuthResult = { status: "ok"; key: string } | { status: "cancelled" };
export function launchOpenRouterAuth(): Promise<OpenRouterAuthResult>;
```

`FreeLlmConnectDialog` props는 `{ open: boolean; onOpenChange(v: boolean): void }`로 `LlmConnectDialog`와 같다. 내부 상태는 `step: "pick" | "geminiKey"`, `selected: FreeLlmPresetId | null`, `apiKey`, `busy`, `pendingModels`다. 닫힐 때 전부 리셋한다. `cancelledRef` 패턴은 `LlmConnectDialog`를 따라, 닫힌 뒤 도착한 비동기 결과를 무시한다.

## 기존 패턴 준수

- **번들 경계**: 패널은 `@/background/oauth`의 `launchOAuthWebFlow`·`classifyLaunchFlowError`를 import하지 않는다. 취소 정규식 하나만 `free-llm.ts`에 복제하고 출처 주석을 단다. 공유 enum은 `src/lib/` leaf(`llm-provider-ids.ts`)로 둔다(`lib/jira-sprint.ts` 선례).
- **집계 허용목록은 값까지 잠근다**: `analytics.ts` 주석이 경고하는 "임의 문자열 통과"를 새 이벤트에서 되풀이하지 않는다. `platform_connect.reason`이 고정 enum만 받는 것과 같은 원칙이다.
- **i18n 동시 갱신**: `settings.ts` 6로케일. 훅이 `locales.test.ts`로 대칭을 검사한다. log-viewer 사전은 무관하다(설정 화면 키).
- **UI**: shadcn `Dialog`·`Button`·`Input` 재사용, 카드는 `RadioGroup` 또는 `button[aria-pressed]`. 기존 `LlmConnectDialog`의 `DialogContent` 클래스(`w-[90vw] max-w-[800px] gap-5 rounded-3xl p-6`)와 `FieldRow`를 그대로 쓴다. `bg-muted` 위 `text-muted-foreground` 금지(대비 테스트). 착수 전 DESIGN.md와 기존 선택 카드 UI(연동 탭 플랫폼 선택 등)를 읽고 패턴을 맞춘다.
- **테스트 2트랙**: 순수 함수는 `*.test.ts`, 모달 단계 전이는 `*.test.tsx`(jsdom).
- **Privacy 문서는 동작에 묶인다**: `chrome.identity` 새 목적 사용과 신규 외부 fetch 2건이 트리거다. ko 원본, en 번역, 시행일.

## 대안 검토

1. **Gemini도 기존 `LlmConnectDialog`를 preset 선택 상태로 열기** — 코드는 적지만 모달이 한 번 바뀌고 provider 콤보가 노출된다. 사용자가 "같은 모달 2단계"를 선택해 기각.
2. **AI Studio를 새 탭으로 열기** — 탭 스코프라 새 탭으로 가면 패널이 닫힌다. 키를 붙여넣을 곳이 사라지고 모달 상태 보존도 미검증이다. 팝업 창은 원래 창의 활성 탭을 바꾸지 않는다.
3. **OpenRouter PKCE를 background 메시지로 처리** — 기존 OAuth 레인과 대칭이지만, 키가 패널 store(`settings-ui-store`)로 가야 하므로 왕복만 는다. `PlatformId`·`ConnectReason` 체계에 LLM을 끼워 넣어야 하는 비용도 있다. secret이 없어 background에 둘 이유가 없다.
4. **무료 판정을 `pricing.prompt === "0"`으로** — 실측(2026-10) 응답에 시간대별 `pricing.overrides`가 있어 base 값만으로는 정확하지 않다. `:free` 접미사는 OpenRouter의 무료 변형 명명 규약이라 그쪽을 쓴다.
5. **텍스트 전용 무료 모델 폴백 + 모델 단위 capability** — 0개 문제를 풀지만 `byokCapabilities`를 모델 축으로 넓혀야 한다. 사용자가 "연결 막고 안내"를 선택해 기각.

## 위험 요소

- **R1. OpenRouter가 `https://<ID>.chromiumapp.org/`를 callback으로 받는지 미확인.** 문서는 localhost 외 제약을 명시하지 않는다. 선행 스파이크(tasks Task 0)에서 실패하면 **Gemini만으로 출시**한다(사용자 결정). 이 경우 OpenRouter는 DROPPED.md에 "재검토 조건: callback 허용"으로 기록한다.
- **R2. `GEMINI_MODELS` 하드코딩이 이미 죽었을 가능성.** 외부 보도상 `gemini-2.0-flash`는 2026-06-01 종료, 2.5 계열은 2026-10-16 종료 예정이었다(미검증). **기존 BYOK Gemini 사용자에게도 해당하는 현행 결함**일 수 있다. Task 0에서 실제 `/models` 응답과 무료 티어 호출로 확인해 목록을 갱신한다. 무료 경로를 Gemini 우선으로 내보내는 이상, 죽은 기본 목록은 첫 경험 실패로 직결된다.
- **R3. 무료 모델 목록 변동.** OpenRouter `:free` 목록은 수시로 바뀐다(2026-10 실측: :free+image 8개). 그래서 하드코딩 없이 매번 조회한다. 목록에 content-safety 분류기 같은 비채팅 모델이 섞일 수 있지만 이번 범위에서 의미 필터는 하지 않는다.
- **R4. `launchWebAuthFlow`를 패널 문서에서 호출.** 대기 중에 패널 문서가 사라지면(사용자가 탭을 옮겨 패널이 닫힘) Promise가 버려진다. 발급된 키는 사용자 계정에만 남는다. 손실은 "다시 연결" 한 번이라 수용한다.
- **R5. 무료 한도 문구의 신선도.** "하루 50회" 같은 수치는 provider 정책이라 바뀔 수 있다. 정적 문구로 두고 privacy·가이드와 같은 출처를 갖게 한다. 바뀌면 i18n 6곳과 문서 2곳을 갱신한다.
- **R6. `connectProvider` 추출 회귀.** BYOK 연결은 지금 테스트가 없다. 추출 전에 에러 분기(invalid URL·insecure·권한 거부·redirect·fetch 실패)를 단위 테스트로 먼저 고정한다.
- **R7. 연결 해제 후에도 OpenRouter 키가 살아 있음.** revoke는 비목표다. 카드 문구·privacy·가이드 3곳에 고지한다.
