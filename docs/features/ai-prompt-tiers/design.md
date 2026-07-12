# AI 프롬프트 tier 분리 — 기술 설계

## 개요

`AIProvider`에 **능력 표면**(`ProviderCapabilities`)을 추가해 프로바이더가 자기 능력을 선언하게 하고, 그 값을 `useAI` → 다이얼로그 → 프롬프트 컨텍스트로 흘려보낸다. 프롬프트 빌더(`buildAiDraftPrompt.ts`, `buildAiStylingPrompt.ts`)는 **디스패처**로 축소되고, 실제 프롬프트 본문은 `src/sidepanel/lib/prompts/` 아래 스타일별 파일에 **독립적으로** 작성한다 — 두 프롬프트가 한 함수 안에서 조건 분기로 얽히면 결국 지금과 같은 결합이 남기 때문이다. 파서·스키마·컨텍스트 수집은 능력과 무관하게 단일 출처로 유지한다(안전망은 프로바이더와 무관해야 한다).

### 왜 `tier` 단일 enum이 아닌가

"nano/full" 같은 등급 스칼라는 **지금 당장 틀린다**. 실제로 갈리는 것은 서로 독립적인 3개 축이다.

| | 컨텍스트 창 | 이미지 | 지시 따르기 |
|---|---|---|---|
| Gemini Nano | 4~6k | ✗ | 약함 |
| gpt-4o-mini | 128k | ✓ | 중간 |
| Ollama llama3.2:3b | 명목 128k, **실효 `num_ctx` 기본 4~8k** | ✗ | 약함 |
| Claude / GPT-5 | 20만+ | ✓ | 강함 |

gpt-4o-mini는 **싸지만 나노 제약이 하나도 없다**(풀 프롬프트를 그냥 주면 된다). 반대로 Ollama 로컬 소형 모델은 **나노와 거의 같은 제약**을 갖는다. 등급 스칼라로는 이 둘이 같은 칸에 안 들어간다.

따라서 능력을 축으로 쪼갠다:

```ts
export type PromptStyle = "compact" | "rich";

export interface ProviderCapabilities {
  promptStyle: PromptStyle;     // 어느 프롬프트 본문을 쓸지 (지시 따르기 능력)
  supportsImages: boolean;
  contextBudgetChars: number;   // 문자 예산 (토큰≈문자/4 근사)
}
```

프롬프트 파일은 **`promptStyle`로 키잉**한다(`draft.compact.ts` / `draft.rich.ts`). 이번에 출하하는 프로필은 2개다:

- **Chrome 나노** → `{ promptStyle: "compact", supportsImages: false, contextBudgetChars: 2000 }`
- **BYOK 전체** → `{ promptStyle: "rich", supportsImages: true, contextBudgetChars: MAX_SAFE_INTEGER }`

`PROVIDER_PRESETS`에 Ollama(`http://localhost:11434/v1`)가 이미 있어 **로컬 소형 모델은 선언된 지원 경로**지만, `modelId`가 임의 문자열(custom baseUrl·Ollama 임의 태그)이라 **자동 판정이 불가능**하다. 휴리스틱 blocklist는 유지보수 부채이므로 이번엔 대응하지 않는다. 다만 축을 쪼개뒀으므로 나중에 `{ compact, images: false, budget: 8000 }` **좌표 하나만 추가**하면 새 프롬프트 파일 없이 대응된다. compact 프롬프트의 이미지 언급은 `supportsImages`로 게이팅되므로 재사용이 안전하다.

### 예산 관리

**순수 함수 기반 문자 예산 절삭**(결정적·테스트 가능)을 1차 게이트로, 세션 생성 후 `session.inputUsage`/`measureInputUsage()` 실측을 2차 게이트로 둔다. 실측 API가 없는 구버전 Chrome에서도 1차 게이트만으로 동작한다. 절삭은 `contextBudgetChars`가 유한할 때만 돈다(BYOK는 no-op).

## 변경 범위

### 신규 파일

| 파일 | 역할 |
|---|---|
| `src/sidepanel/lib/prompts/caps.ts` | `promptStyle`별 컨텍스트 상한 테이블 (단일 출처) |
| `src/sidepanel/lib/prompts/context.ts` | 능력 무관 컨텍스트 선별 순수 함수 (토큰 관련성 정렬, 편집 prop 우선 보존, 레이아웃 prop 추출, 스타일 delta) |
| `src/sidepanel/lib/prompts/draft.compact.ts` | compact 초안 system prompt 본문 (나노 등 지시 따르기 약한 모델) |
| `src/sidepanel/lib/prompts/draft.rich.ts` | rich 초안 system prompt 본문 (고급 모델) |
| `src/sidepanel/lib/prompts/styling.compact.ts` | compact 스타일링 system prompt 본문 |
| `src/sidepanel/lib/prompts/styling.rich.ts` | rich 스타일링 system prompt 본문 |
| `src/sidepanel/lib/promptBudget.ts` | 문자 예산 절삭 (순수) + 실측 게이트 헬퍼. `contextBudgetChars`가 유한할 때만 동작 |

### 변경 파일

| 파일 | 현재 역할 | 변경 |
|---|---|---|
| `src/sidepanel/lib/ai-provider.ts` | 3개 프로바이더 팩토리 + 에러 타입 | `PromptStyle`·`ProviderCapabilities` 타입, `AIProvider.capabilities` 추가. `AISession`에 옵셔널 `measureInputUsage`/`inputQuota`. Chrome 세션이 그 둘을 실제로 배선. `AiContextOverflowError` 추가 |
| `src/sidepanel/hooks/useAI.ts` | 프로바이더 선택 | 반환값에 `capabilities` 추가 (provider에서 파생 — 새 판정 로직 없음) |
| `src/sidepanel/lib/buildAiDraftPrompt.ts` | 프롬프트 본문 + 스키마 + 파서 | 본문을 `prompts/draft.*.ts`로 이관. **디스패처 + 스키마 + 파서만 남긴다.** `AiDraftSessionContext`에 `caps: ProviderCapabilities` 추가 |
| `src/sidepanel/lib/buildAiStylingPrompt.ts` | 프롬프트 본문 + 스키마 + 파서 + 컨텍스트 블록 | 동상. `AiStylingContext`에 `caps`·`computedStyles`·`viewport`·`editedProps` 추가. `buildStyleContextBlock` → `buildStyleDeltaBlock`으로 대체 |
| `src/sidepanel/lib/buildAiDraftRequest.ts` | systemPrompt + images 조립 | **`caps.supportsImages`로 images 게이팅** (미지원이면 `undefined`) |
| `src/sidepanel/lib/mergeAiDraftSections.ts` | AI 섹션 병합 | **선행 픽스 B**: AI가 안 준 섹션은 기존 텍스트 보존 |
| `src/sidepanel/tabs/AiDraftDialog.tsx` | 초안 다이얼로그 | `capabilities` prop 수신, ctx에 실음, **이미지 미지원이면 인라인 이미지 resolve 스킵**, 예산 절삭 적용, 컨텍스트 초과 에러 처리 |
| `src/sidepanel/tabs/styleEditor/AiStylingDialog.tsx` | 스타일링 다이얼로그 | `capabilities` prop 수신, ctx에 computedStyles·viewport·editedProps 실음, **delta 블록으로 멀티턴 전환** |
| `src/sidepanel/tabs/DraftingPanel.tsx` | 초안 패널 | `useAI()`에서 `capabilities` 받아 다이얼로그로 전달 |
| `src/sidepanel/tabs/StyleEditorPanel.tsx` | 스타일 편집 패널 | 동상 |
| `src/i18n/namespaces/ai.ts` | AI i18n | 컨텍스트 초과 에러 문구 추가 (ko/en 동시) |

## 데이터 흐름

```
useSettingsUiStore.llm ──┐   llm?.modelId 있음 → BYOK_CAPABILITIES (rich)
                         ├─► useAI() ─► provider { capabilities, createSession }
globalThis.LanguageModel ┘   없음 → 나노 → NANO_CAPABILITIES (compact)
                                                 │
                                                 ▼
                              DraftingPanel / StyleEditorPanel
                                                 │  (capabilities를 prop으로)
                                                 ▼
                                    AiDraftDialog / AiStylingDialog
                                                 │
              ┌──────────────────────────────────┤
              ▼                                  ▼
   ctx 조립 (caps 포함)             images 게이팅 (caps.supportsImages)
              │                                  │  미지원 → resolve 스킵, images: undefined
              ▼                                  │
   promptBudget.fitDraftContext(caps.contextBudgetChars)
     level 0 캡 → 1 로그↓ → 2 기존초안↓ → 3 diff↓ │   (예산 무한이면 no-op)
              │                                  │
              ▼                                  │
   buildAiDraftSessionPrompt(ctx)  ◄─────────────┘
     ├─ promptStyle "compact" → prompts/draft.compact.ts
     └─ promptStyle "rich"    → prompts/draft.rich.ts
              │
              ▼
   createSession(systemPrompt)
              │
              ▼
   2차 게이트: session.inputUsage vs inputQuota (미지원이면 통과)
     초과 → AiContextOverflowError → 전용 토스트 (재시도 무의미 안내)
              │
              ▼
   session.prompt(msg, { responseSchema, images })
              │
              ▼
   parseAiDraftResponse (능력 무관 — 안전망은 단일 출처)
              │
              ▼
   mergeAiSectionsPreservingImages (누락 섹션 = 기존 보존)
```

스타일링 멀티턴:

```
1턴: createSession(systemPrompt)  ← 요소 상태 이미 포함
     session.prompt(msg)          ← delta 블록 없음 (중복 제거)
     lastSentStyles = ctx.specifiedStyles

N턴: delta = buildStyleDeltaBlock(lastSentStyles, ctx.specifiedStyles)
     session.prompt(delta ? `${delta}\n\n${msg}` : msg)
     lastSentStyles = ctx.specifiedStyles
```

## 인터페이스 설계

### `ai-provider.ts`

```ts
export type PromptStyle = "compact" | "rich";

export interface ProviderCapabilities {
  readonly promptStyle: PromptStyle;
  readonly supportsImages: boolean;
  readonly contextBudgetChars: number;   // 유한하면 절삭 대상. BYOK는 MAX_SAFE_INTEGER
}

export class AiContextOverflowError extends Error {
  constructor() {
    super("context_overflow");
    this.name = "AiContextOverflowError";
  }
}

export interface AISession {
  prompt(
    input: string,
    options?: { responseSchema?: Record<string, unknown>; images?: string[] },
  ): Promise<string>;
  destroy(): void;
  // 나노 전용 실측 게이트. 미지원 환경(구버전 Chrome·BYOK)에서는 undefined.
  measureInputUsage?(
    input: string,
    options?: { responseSchema?: Record<string, unknown> },
  ): Promise<number>;
  readonly inputUsage?: number;
  readonly inputQuota?: number;
}

export interface AIProvider {
  readonly capabilities: ProviderCapabilities;
  generate(params: { /* 기존 그대로 — 죽은 코드지만 제거는 비목표 */ }): Promise<string>;
  createSession(systemPrompt: string): Promise<AISession>;
}

export const NANO_CAPABILITIES: ProviderCapabilities = {
  promptStyle: "compact",
  supportsImages: false,
  contextBudgetChars: 2000,          // ≈500 토큰 (system prompt 목표)
};

export const BYOK_CAPABILITIES: ProviderCapabilities = {
  promptStyle: "rich",
  supportsImages: true,
  contextBudgetChars: Number.MAX_SAFE_INTEGER,
};
```

`createChromeAIProvider()` → `NANO_CAPABILITIES`
`createOpenAICompatibleProvider(config)` / `createAnthropicProvider(config)` → `BYOK_CAPABILITIES`

Chrome 세션은 네이티브 `LanguageModelInstance`의 `inputUsage`/`inputQuota`/`measureInputUsage`를 그대로 노출한다. 전역 타입 선언(`ai-provider.ts:3-9`)에 그 3개를 옵셔널로 추가한다.

### `prompts/caps.ts`

```ts
import type { PromptStyle } from "../ai-provider";

export interface PromptCaps {
  diffs: number;
  designTokens: number;
  styles: number;
  networkErrors: number;
  consoleErrors: number;
  actions: number;
  existingDraftChars: number;   // 0 = 기존 초안 미포함
  userPromptChars: number;
}

const UNLIMITED = Number.MAX_SAFE_INTEGER;

export const PROMPT_CAPS: Record<PromptStyle, PromptCaps> = {
  compact: { diffs: 8, designTokens: 5, styles: 12, networkErrors: 3, consoleErrors: 3, actions: 5, existingDraftChars: 400, userPromptChars: 600 },
  rich:    { diffs: 50, designTokens: 40, styles: 80, networkErrors: 5, consoleErrors: 5, actions: 20, existingDraftChars: UNLIMITED, userPromptChars: UNLIMITED },
};
```

> `Infinity`가 아니라 `Number.MAX_SAFE_INTEGER`를 쓴다 — `slice(0, Infinity)`는 동작하지만 캡 값이 스토어·직렬화 경로에 새면 `JSON.stringify(Infinity) === "null"`이라 조용히 깨진다.

> `buildLogSummary.ts`의 `MAX_ERRORS`/`MAX_ACTIONS`는 **건드리지 않는다**. 그건 요약 생성기의 상한이고, 프롬프트 캡은 싣는 시점에 추가로 slice한다. 요약 함수 시그니처를 바꾸면 로그 탭 등 다른 소비자에 파급된다.

### `prompts/context.ts` (전부 순수 함수)

```ts
// 요소가 실제 var()로 참조하는 토큰 → 같은 family 토큰 → 나머지 순으로 선별.
// 현재는 collectTokens의 이름순 정렬 앞에서 잘려 "쓰던 family 우선" 지시가 무력하다.
export function selectRelevantTokens(
  tokens: Token[],
  referencedNames: string[],   // specifiedStyles 값에서 파싱한 var(--x)
  limit: number,
): Token[];

// var(--x) 참조 이름을 스타일 값 맵에서 추출
export function extractVarRefs(styles: Record<string, string>): string[];

// 사용자가 편집한 prop을 cap에서 우선 보존. 현재는 spread tail이라 먼저 잘린다.
export function selectStyles(
  specifiedStyles: Record<string, string>,
  editedProps: string[],
  limit: number,
): Record<string, string>;

// rich 스타일링용 레이아웃 컨텍스트 (computedStyles에서 관련 prop만)
export const LAYOUT_PROPS: readonly string[]; // display, position, flex-direction, justify-content, align-items, gap, box-sizing, overflow, width, height, margin, padding
export function extractLayoutContext(
  computedStyles: Record<string, string>,
): Record<string, string>;

// 멀티턴 delta — 변경된 prop만. 동일하면 빈 문자열.
export function buildStyleDeltaBlock(
  prev: Record<string, string>,
  next: Record<string, string>,
): string;
```

### `promptBudget.ts`

```ts
import type { AiDraftSessionContext } from "./buildAiDraftPrompt";
import type { AISession } from "./ai-provider";

export type TrimLevel = 0 | 1 | 2 | 3;

// level 0: 캡만 / 1: +로그 제거 / 2: +기존 초안 제거 / 3: +diff·토큰 제거
export function trimDraftContext(
  ctx: AiDraftSessionContext,
  level: TrimLevel,
): AiDraftSessionContext;

// 예산에 맞을 때까지 level을 올리며 재빌드. 최종 level까지 가도 초과면 그대로 반환
// (2차 실측 게이트가 판정) — 여기서 던지지 않는다.
// budgetChars가 무한(BYOK)이면 level 0으로 즉시 반환 — no-op.
export function fitDraftContext(
  ctx: AiDraftSessionContext,
  build: (c: AiDraftSessionContext) => string,
  budgetChars: number,
): { ctx: AiDraftSessionContext; prompt: string; level: TrimLevel };

// 세션 생성 후 실측 2차 게이트. inputQuota 미지원이면 통과(false).
export function isSessionOverBudget(session: AISession): boolean;
```

### `AiDraftSessionContext` / `AiStylingContext` 확장

```ts
export interface AiDraftSessionContext {
  caps: ProviderCapabilities;   // 신규 — promptStyle·supportsImages·budget 단일 캐리어
  // ... 기존 필드 그대로
}

export interface AiStylingContext {
  caps: ProviderCapabilities;                     // 신규
  computedStyles?: Record<string, string>;        // 신규 — rich 레이아웃 컨텍스트
  viewport?: { width: number; height: number };   // 신규
  editedProps?: string[];                         // 신규 — cap 우선 보존용 (styleEdits.inlineStyle의 키)
  // ... 기존 필드 그대로
}
```

### 디스패처 (기존 파일에 남는 것)

```ts
// buildAiDraftPrompt.ts
export function buildAiDraftSessionPrompt(ctx: AiDraftSessionContext): string {
  return ctx.caps.promptStyle === "compact"
    ? buildCompactDraftPrompt(ctx)
    : buildRichDraftPrompt(ctx);
}
// buildAiDraftSchema / parseAiDraftResponse / stripLineNumbering 는 그대로 유지 (능력 무관)

// buildAiStylingPrompt.ts
export function buildAiStylingSystemPrompt(ctx: AiStylingContext): string {
  return ctx.caps.promptStyle === "compact"
    ? buildCompactStylingPrompt(ctx)
    : buildRichStylingPrompt(ctx);
}
// buildAiStylingResponseSchema / parseAiStylingResponse / isDeniedStyleProp 는 그대로 유지
```

기존 import 경로(`@/sidepanel/lib/buildAiDraftPrompt`)를 그대로 두므로 호출부 import 변경이 없다.

> compact 프롬프트 본문은 `caps.supportsImages`를 게이트로 이미지 언급을 넣고 뺀다. 지금 compact를 쓰는 유일한 프로필(나노)은 `supportsImages: false`라 결과적으로 이미지 언급이 0이지만, **본문이 나노에 하드코딩되지 않으므로** 나중에 `{compact, images:true}` 좌표가 생겨도 그대로 재사용된다.

## 프롬프트 본문 설계

### compact 초안 (`draft.compact.ts`) — 목표 ≤500토큰

현재 유일한 소비자는 Chrome 나노(BYOK 미설정 사용자)다.

`responseConstraint`가 구조를 강제하므로 **JSON 형식 규칙을 전부 삭제**한다. 지시는 **긍정형**으로만 쓴다(소형 모델은 부정 지시에서 오히려 그 개념을 활성화한다 — 현재 `"Do not include markdown picture embeds such as ![](...)"`는 나노에게 이미지 임베드를 가르쳐주는 셈이다).

**이미지 언급은 `caps.supportsImages`로 게이팅**한다. 나노는 `false`라 스크린샷·before/after 문장이 한 줄도 안 나간다.

> ⚠️ `responseConstraint`로 JSON 규칙을 뺄 수 있는 것은 **Chrome 경로 한정**이다. compact 프롬프트가 나중에 BYOK 소형 모델에 재사용되면 그쪽은 구조 강제가 없어(OpenAI 경로는 스키마를 전송조차 안 한다) JSON 규칙이 필요해진다. 그 좌표를 만들 때 `caps`에 `jsonEnforced: boolean` 축을 추가해 게이팅할 것. **지금은 추가하지 않는다**(쓰는 데가 없다).

구조:
```
You are a QA engineer. Write a bug report from the context below.
Use only facts stated in the context.

Page: <url> (<title>)
<모드별 최소 컨텍스트 — 캡 적용>

Sections:
- title: one short line
- description: what is broken now
- expectedResult: what should happen instead
- stepsToReproduce: one action per line
- notes: extra context, or empty

Write in <Korean|English>.
```
- 삭제: `"Output only valid JSON. No markdown fences"`, `"Do NOT include any other fields"`, `"If a section has no relevant information, use an empty string"`(스키마 `required`가 강제), `"(번호 없이)"`(`stripLineNumbering` 후처리가 담당), 부정형 규칙 5중 압축 줄.
- `MODE_HINTS` 접미사 생략 (제약 개수 축소).

### rich 초안 (`draft.rich.ts`)

소비자는 BYOK 전체(모델 등급 무관 — gpt-4o-mini도 여기로 온다).

- **역할 격상**: "시니어 QA 엔지니어. 개발자가 추가 질문 없이 착수할 수 있는 티켓을 쓴다."
- **분석 절차 명시**: ① 사용자 서술 ↔ 액션 타임라인 정렬 → ② 그 시점 전후의 console/network 에러만 인과 후보로 채택 → ③ 스크린샷·스타일 diff로 검증 → ④ 확증된 것만 본문에, 추론은 `notes`에 "가설:" 접두로 분리.
- **환각에 금지가 아니라 배출구를 준다**: "확실하지 않으면 notes에 open question으로 남겨라". 대형 모델에서는 금지보다 이쪽이 잘 먹는다.
- **title 규격**: `[영향 대상] 증상 (조건)`, 80자 이내(`MAX_TITLE_LENGTH`와 일치), 원인 추측 금지.
- **부정 지시를 긍정 규격으로 재작성**: `"no preamble, no hedging, no filler…"` → `"각 문장은 관찰된 사실 또는 값이다. 문장당 새 정보 1개."`
- **few-shot 1개**: 컨텍스트 → 이상적 JSON 응답 예시. 규칙 6줄보다 예시 1개가 싸고 정확하다.
- **이미지**: `supportsImages`이므로 스크린샷 지시 유지. screenshot 모드에서 annotated + raw를 **둘 다** 전달하도록 `getModeImages` 변경(사용자가 표시한 곳과 원본을 대조 가능).
- **JSON 형식 규칙은 유지** — BYOK structured output 연결이 비목표라 이게 유일한 방어선이다.

### compact 스타일링 (`styling.compact.ts`) — 목표 ≤400토큰

```
Modify CSS on this element.
Element: <div> at .foo
Current: color: red; padding: 8px   (캡 12개, 편집 prop 우선)
Tokens: --brand-500: #3b82f6        (캡 5개, 관련성 정렬)
Prefer var(--token) when it matches.
```
- 삭제: 거절방지 4줄, denied prop 목록(파서 `isDeniedStyleProp`가 이미 필터 — 나노에겐 금지 개념을 상기시키는 순손실), `"Output only valid JSON, no markdown fences"`, `"Do NOT include any other fields"`.
- **few-shot 1개로 거절 방지를 대체**: user `"배경을 파랗게"` → assistant `{"explanation":"...","inlineStyle":{"background-color":"var(--brand-500)"}}`. 소형 모델은 말로 하는 명령보다 예시 1개에 훨씬 강하게 정렬된다.

### rich 스타일링 (`styling.rich.ts`)

- 역할: "CSS 전문가. 최소 변경으로 의도를 달성한다." **거절방지 문구 제거.**
- **레이아웃 컨텍스트 추가**: `extractLayoutContext(computedStyles)` + 뷰포트 폭. 이미 `EditorSelection`에 수집돼 있어 새 수집이 없다.
- `explanation`에 **가정과 부작용**을 적게 한다: "가정: 부모가 flex라 가정하고 margin 대신 gap 사용. 부모가 block이면 무효."
- 스타일 캡 80, 토큰 캡 40 (관련성 정렬 적용).
- JSON 형식 규칙 유지 (위와 같은 이유).

## 기존 패턴 준수

- **테스트 우선** (CLAUDE.md): 신규 인터페이스(`prompts/context.ts`, `promptBudget.ts`, `prompts/caps.ts`)는 `/tdd interface`로 테스트를 먼저 박고 구현한다. 선행 픽스 3건은 회귀 재현 테스트(red) → 픽스(green).
- **i18n 동시 갱신**: `src/i18n/namespaces/ai.ts`를 Edit하면 PostToolUse 훅이 `locales.test.ts`(ko/en 키 대칭)를 자동 실행한다. 컨텍스트 초과 문구를 ko/en 양쪽에 넣는다.
- **테스트 파일 위치**: 대상과 같은 디렉터리의 `__tests__/*.test.ts`. 신규 `prompts/` 디렉터리에는 `prompts/__tests__/`.
- **주석 최소화**: WHY가 비자명할 때만 한 줄 (`src/components/ui/` 외).
- **외과적 변경**: `AIProvider.generate` 죽은 코드, 실패 시 입력 소실 등은 눈에 보여도 건드리지 않는다(비목표).
- **POSTMORTEM 회로**: 2026-07-08·07-09 항목이 **AI 스타일 적용 → CodeMirror doc 재동기화** 경로의 함정을 기록한다. `AiStylingDialog`의 `setStyleEdits(merged)` → `setAiStylingLoading(false)` **호출 순서에 의존하는 회복 로직**(`docSync.ts`의 `shouldResyncDoc({focused, aiApplied})`)이 있으므로, 이 다이얼로그를 수정할 때 **그 순서를 바꾸지 않는다.**

## 대안 검토

**대안 1 — 한 파일 안에서 조건 분기.** 파일 수가 안 늘고 diff가 작다. 그러나 두 프롬프트가 한 함수의 `lines.push` 스트림에 얽혀, "compact에서 이 줄을 빼면 rich도 영향받나?"를 매번 확인해야 한다. 지금 겪는 결합이 그대로 남는다. **기각.**

**대안 2 — 프로바이더 레이어에서 프롬프트 압축.** 프롬프트는 하나로 두고 Chrome 프로바이더가 받아서 잘라낸다. 호출부 변경이 0이다. 그러나 문장 단위 기계적 압축이라 품질 통제가 불가능하고, "이미지 언급 제거" 같은 의미 수준 변경을 할 수 없다. 나노 이미지 모순도 못 고친다. **기각.**

**대안 3 — `tier: "nano" | "full"` 단일 enum.** 가장 단순하다. 그러나 개요의 표대로 **등급이 스칼라가 아니다** — gpt-4o-mini(싸지만 128k·이미지 가능)와 Ollama llama3.2:3b(실효 4~8k·텍스트 전용)가 같은 "저가" 칸에 들어가는데 필요한 처리가 정반대다. enum을 늘려도(`"small"` 추가) `modelId`가 임의 문자열이라 **자동 판정이 불가능**하다. **기각 — 축 3개(`promptStyle`·`supportsImages`·`contextBudgetChars`)로 분해.**

**대안 4 — 저가 BYOK 모델용 3번째 프로필을 지금 추가.** 자동 판정이 불가능하니 LLM 설정에 "소형 모델 모드" 수동 토글이 필요하다. 설정 UI·i18n·영속화가 붙어 스코프가 커지고, CLAUDE.md의 "요청하지 않은 설정 가능성 추가 금지"에 걸린다. **기각 — 축만 쪼개두고 프로필은 2개로 출발. 필요해지면 좌표 하나 추가로 대응된다(새 프롬프트 파일 불필요).**

**대안 5 — 알려진 모델 테이블로 능력 판정.** `ANTHROPIC_MODELS`처럼 모델별 capabilities 테이블을 두고 미등록은 rich 기본값. 모델이 나올 때마다 유지보수 부채가 쌓이고 custom baseUrl·Ollama 임의 태그는 어차피 못 잡는다. **기각.**

**대안 6 — 나노에서 ko 로케일 비활성화.** Chrome Prompt API 문서상 지원 언어는 `en, ja, es, de, fr`로 한국어가 없어, 문서만 보면 ko 사용자에게 나노는 실패 경로다. 그러나 **실측상 현재 한국어를 출력한다**(사용자 확인). 문서를 근거로 되는 기능을 끄는 것은 손해다. **기각 — 현 동작 유지.**

**대안 7 — 예산을 실측만으로 관리** (고정 캡 없이 `measureInputUsage`만). 정확하지만 비결정적이라 단위 테스트가 불가능하고, 실측 API가 없는 구버전 Chrome에서 무방비다. **기각 — 순수 문자 예산을 1차, 실측을 2차로 두는 2단 게이트 채택.**

## 위험 요소

- **프롬프트 워딩 인질 테스트.** `buildAiDraftPrompt.test.ts:223`의 `not.toMatch(/image|이미지/i)`와 `:270`, `:462`의 negative 정규식, `:549`의 full-string 동등 단정이 프롬프트 문구를 고정하고 있다(프로덕션이 "markdown **picture** embeds"라는 우회 표현을 쓰는 이유). **이 단정들을 먼저 불변식 테스트로 교체하지 않으면 프롬프트를 고칠 수 없다.** 교체 방향: "compact 프롬프트 문자수 < 예산", "`supportsImages: false`면 이미지 지시 없음", "`true`면 이미지 지시 있음" 같은 **능력 계약 검증**.
- **`createChromeAIProvider`·`createSession` 테스트 0개.** 이번 작업의 주역인데 회귀 안전망이 없다. tier 착수 전에 이 경로 테스트부터 박는다.
- **`buildStyleContextBlock` 제거 → 테스트 3개 삭제.** `buildAiStylingPrompt.test.ts:97-128`이 이 함수에 묶여 있다. `buildStyleDeltaBlock` 테스트로 대체한다.
- **멀티턴 delta 전환의 회귀 위험.** 첫 턴에 상태 블록을 안 보내는 게 맞다는 전제는 "시스템 프롬프트에 이미 있다"에 의존한다. 시스템 프롬프트의 스타일 캡(compact 12)이 delta 기준선과 어긋나면 AI가 못 본 prop을 delta가 "변경 없음"으로 판단해 영원히 안 보낼 수 있다. **`lastSentStyles` 기준선을 "시스템 프롬프트에 실제로 실은 스타일 맵"으로 초기화**해야 한다(원본 `specifiedStyles` 전체가 아니라).

- **`ProviderCapabilities`가 축을 열어두지만 좌표는 2개뿐이다.** `{compact, images:true}`나 `{rich, budget:8000}` 같은 조합은 **현재 아무도 안 쓴다**. 프롬프트 본문에서 그 조합을 대비한 분기를 미리 심지 말 것 — 죽은 분기가 된다. 축은 타입에만 열어두고, 본문은 실제 좌표 2개에 대해서만 검증한다.
- **`mergeAiDraftSections` 픽스의 파급.** 현재 동작(누락 섹션 = 삭제)에 의존하는 테스트가 있는지 먼저 확인한다. "AI가 빈 문자열을 명시적으로 준 경우"(= 섹션 비우기 의도)와 "키 자체를 누락한 경우"(= 실수)를 구분해야 한다. 전자는 비우고 후자는 보존한다.
- **`Infinity`를 캡 값으로 쓰지 않는다.** `slice(0, Infinity)`는 동작하지만 `JSON.stringify(Infinity) === "null"`이라 캡 값이 직렬화 경로에 새면 조용히 깨진다. `Number.MAX_SAFE_INTEGER`로 통일.
- **`getModeImages`가 annotated + raw 둘 다 반환하도록 변경**하면 rich 경로의 이미지 수가 2배가 된다. Anthropic/OpenAI 토큰 비용이 증가하고, 기존 `src/sidepanel/tabs/__tests__/getModeImages.test.ts`가 깨진다(갱신 필요).
- **e2e 회귀**: `e2e/ai-styling.spec.ts`의 "CSS 탭 유지 상태에서 AI 스타일링" 케이스가 POSTMORTEM 2026-07-09 픽스의 회귀 감지 지점이다. 스타일링 다이얼로그 변경 후 반드시 green 확인.
