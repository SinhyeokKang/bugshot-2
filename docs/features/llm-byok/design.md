# LLM BYOK — 기술 설계

## 개요

OpenAI-호환 Chat Completions API와 Anthropic Messages API를 지원하는 AI 프로바이더 추상화 레이어를 도입한다. 기존 Chrome LanguageModel API · OpenAI-호환 · Anthropic 세 프로바이더를 통합 인터페이스로 감싸, 호출부(DraftingPanel · AiStylingDialog)가 프로바이더를 의식하지 않고 동작하게 한다. base URL 호스트네임으로 프로바이더를 자동 감지한다 (`api.anthropic.com` → Anthropic, 그 외 → OpenAI-호환).

설정 탭은 3개 하위 탭([이슈 설정] · [AI 설정] · [기타])으로 분리하며, AI 설정 탭은 플랫폼 연동(IntegrationsTab) UX를 그대로 따른다.

## 변경 범위

### 새로 추가되는 파일

| 파일 | 역할 |
|---|---|
| `src/sidepanel/lib/ai-provider.ts` | AI 프로바이더 추상화. `AIProvider` / `AISession` 인터페이스 + Chrome AI · OpenAI-호환 · Anthropic 구현 + `fetchModels()` · `requestHostPermission()` · `detectProviderKind()` 유틸 |
| `src/sidepanel/hooks/useAI.ts` | `useChromeAI` 대체 훅. settings-ui-store의 `llm` 설정을 읽어 적절한 프로바이더 생성 · 상태(status) 관리 |
| `src/sidepanel/tabs/settings/LlmConnectForm.tsx` | AI 설정 하위 탭 컨텐츠. EmptyState(미연결) ↔ Connected(연결됨+모델 선택) 2-state. GithubConnectForm과 동일 구조 |
| `src/sidepanel/tabs/settings/LlmConnectDialog.tsx` | LLM 연결 다이얼로그. Base URL + API Key 입력 → 검증(OpenAI: models fetch, Anthropic: 즉시) → 저장. PatDialog와 동일 구조 |

### 변경되는 파일

| 파일 | 현재 역할 | 변경 내용 |
|---|---|---|
| `src/store/settings-ui-store.ts` | UI 설정 (theme, locale, issueSections) | `LlmConfig` 타입 export + `llm: LlmConfig \| null` 필드 + `setLlm` 액션 추가. 스토어 버전 v2 → v3 |
| `src/sidepanel/tabs/SettingsTab.tsx` | 설정 탭 UI (단일 페이지) | 3개 하위 탭으로 분리. IntegrationsTab과 동일한 `Tabs` > `TabsList` > `TabsContent` 구조. 기존 이슈 설정 → [이슈 설정] 탭, 테마+언어+푸터 → [기타] 탭, [AI 설정] 탭 → `LlmConnectForm` 렌더 |
| `src/sidepanel/tabs/DraftingPanel.tsx` | AI Draft 호출부 + 배너 | `useChromeAI()` → `useAI()` 교체. `generateDraft` → `generate`. Badge "Beta" → `providerLabel \|\| "Beta"` |
| `src/sidepanel/tabs/StyleEditorPanel.tsx` | AI Styling 배너 | Badge "Beta" → `providerLabel \|\| "Beta"` (`useAI()` 훅에서 `providerLabel` 구독) |
| `src/sidepanel/tabs/styleEditor/AiStylingDialog.tsx` | AI Styling 호출부 | 직접 `globalThis.LanguageModel` → `useAI().createSession()`. `sessionRef` 타입 `AISession`으로 변경, `responseConstraint` → `responseSchema` |
| `src/sidepanel/hooks/useChromeAI.ts` | Chrome AI 훅 | 삭제 (기능이 `ai-provider.ts` ChromeAIProvider로 이동) |
| `manifest.config.ts` | 매니페스트 생성 | `optional_host_permissions: ["https://*/*", "http://*/*"]` 추가 |
| `src/i18n/ko.ts` | 한국어 번역 | LLM 설정 UI 키 + 설정 하위 탭 키 추가 |
| `src/i18n/en.ts` | 영어 번역 | LLM 설정 UI 키 + 설정 하위 탭 키 추가 |

## 데이터 흐름

### 프로바이더 자동 감지

```
base URL 호스트네임 확인
  ├─ "api.anthropic.com" → ProviderKind = "anthropic"
  └─ 그 외                → ProviderKind = "openai"
```

### 설정 흐름

```
LlmConnectDialog (UI 입력: baseUrl + apiKey)
  → "연결" 클릭
  → requestHostPermission(baseUrl)
  → 프로바이더 감지
    ├─ openai   → GET {baseUrl}/models → 성공 시 저장
    └─ anthropic → 즉시 저장 (모델 목록은 하드코딩)
  → setLlm({ baseUrl, apiKey, modelId: "" })
  → 다이얼로그 종료

LlmConnectForm (Connected 상태)
  → 모델 콤보박스 표시
    ├─ openai   → 저장된 모델 목록 사용 (재로드 버튼으로 갱신 가능)
    └─ anthropic → 하드코딩 목록 (claude-sonnet-4-6, claude-haiku-4-5-20251001 등)
  → 사용자 모델 선택
  → setLlm({ ...llm, modelId: selected })
  → chrome.storage.local 영속화
```

### AI 호출 흐름

```
DraftingPanel / AiStylingDialog
  → useAI() 훅
  → llm?.modelId 확인
    ├─ modelId 있음 → detectProviderKind(baseUrl)
    │    ├─ "openai"    → OpenAICompatibleProvider
    │    │    → POST {baseUrl}/chat/completions
    │    │       headers: { Authorization: Bearer {apiKey} }
    │    │       body: { model, messages, response_format: { type: "json_object" } }
    │    │    → response.choices[0].message.content
    │    └─ "anthropic"  → AnthropicProvider
    │         → POST {baseUrl}/messages
    │            headers: { x-api-key: {apiKey}, anthropic-version: 2023-06-01 }
    │            body: { model, system, messages, max_tokens: 4096 }
    │         → response.content[0].text
    └─ modelId 없음 또는 llm 없음 → ChromeAIProvider
         → globalThis.LanguageModel.create()
         → session.prompt(input, { responseConstraint })
  → 파싱 (기존 parseAiDraftResponse / parseAiStylingResponse 그대로)
  → UI 반영
```

### 멀티턴 (AI Styling)

```
Chrome AI:
  session = LanguageModel.create({ systemPrompt })
  → session.prompt(msg1) → response1
  → session.prompt(msg2) → response2

OpenAI-compatible:
  messages = [{ role: "system", content: systemPrompt }]
  → messages.push(user msg1) → POST /chat/completions { messages }
  → messages.push(assistant response1) → messages.push(user msg2) → POST ...

Anthropic:
  system = systemPrompt (별도 필드)
  messages = []
  → messages.push(user msg1) → POST /messages { system, messages }
  → messages.push(assistant response1) → messages.push(user msg2) → POST ...
```

## 인터페이스 설계

### 설정 타입

```typescript
// src/store/settings-ui-store.ts에 추가

export interface LlmConfig {
  baseUrl: string;    // "https://api.openai.com/v1" | "https://api.anthropic.com/v1"
  apiKey: string;     // "" 가능 (Ollama 등)
  modelId: string;    // "gpt-4o-mini" | "claude-sonnet-4-6" | "" (미선택)
}
```

### 프로바이더 추상화

```typescript
// src/sidepanel/lib/ai-provider.ts

export type ProviderKind = "openai" | "anthropic";

export interface AISession {
  prompt(input: string, options?: { responseSchema?: Record<string, unknown> }): Promise<string>;
  destroy(): void;
}

export interface AIProvider {
  generate(params: {
    systemPrompt?: string;
    prompt: string;
    responseSchema?: Record<string, unknown>;
  }): Promise<string>;

  createSession(systemPrompt: string): Promise<AISession>;
}

/** 프리셋 매칭 → kind 반환. 커스텀 URL은 호스트네임 "api.anthropic.com" 체크 후 fallback "openai" */
export function detectProviderKind(baseUrl: string): ProviderKind;
export function getProviderLabel(baseUrl: string): string;
export function createChromeAIProvider(): AIProvider;
export function createOpenAICompatibleProvider(config: LlmConfig): AIProvider;
export function createAnthropicProvider(config: LlmConfig): AIProvider;
```

#### ChromeAIProvider

```typescript
export function createChromeAIProvider(): AIProvider {
  return {
    async generate({ systemPrompt, prompt, responseSchema }) {
      const session = await globalThis.LanguageModel.create({
        systemPrompt,
        expectedOutputLanguages: ["en"],
        outputLanguages: ["en"],
      });
      try {
        return await session.prompt(
          prompt,
          responseSchema ? { responseConstraint: responseSchema } : undefined,
        );
      } finally {
        session.destroy();
      }
    },
    async createSession(systemPrompt) {
      const session = await globalThis.LanguageModel.create({
        systemPrompt,
        expectedOutputLanguages: ["en"],
      });
      return {
        prompt: (input, options) =>
          session.prompt(
            input,
            options?.responseSchema ? { responseConstraint: options.responseSchema } : undefined,
          ),
        destroy: () => session.destroy(),
      };
    },
  };
}
```

#### OpenAICompatibleProvider

```typescript
export function createOpenAICompatibleProvider(config: LlmConfig): AIProvider {
  async function callChatCompletions(
    messages: Array<{ role: string; content: string }>,
    jsonMode: boolean,
  ): Promise<string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

    const body: Record<string, unknown> = { model: config.modelId, messages };
    if (jsonMode) body.response_format = { type: "json_object" };

    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`LLM API error ${res.status}: ${text}`);
    }
    const data = await res.json();
    return data.choices[0].message.content;
  }

  return {
    async generate({ systemPrompt, prompt, responseSchema }) {
      const messages: Array<{ role: string; content: string }> = [];
      if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
      messages.push({ role: "user", content: prompt });
      return callChatCompletions(messages, !!responseSchema);
    },
    async createSession(systemPrompt) {
      const messages: Array<{ role: string; content: string }> = [
        { role: "system", content: systemPrompt },
      ];
      return {
        async prompt(input, options) {
          messages.push({ role: "user", content: input });
          const result = await callChatCompletions(messages, !!options?.responseSchema);
          messages.push({ role: "assistant", content: result });
          return result;
        },
        destroy() { messages.length = 0; },
      };
    },
  };
}
```

#### AnthropicProvider

```typescript
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MAX_TOKENS = 4096;

export function createAnthropicProvider(config: LlmConfig): AIProvider {
  async function callMessages(
    system: string,
    messages: Array<{ role: string; content: string }>,
  ): Promise<string> {
    const res = await fetch(`${config.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: config.modelId,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        system,
        messages,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Anthropic API error ${res.status}: ${text}`);
    }
    const data = await res.json();
    return data.content[0].text;
  }

  return {
    async generate({ systemPrompt, prompt, responseSchema }) {
      const sys = responseSchema
        ? `${systemPrompt ?? ""}\n\nRespond with valid JSON only.`
        : (systemPrompt ?? "");
      return callMessages(sys, [{ role: "user", content: prompt }]);
    },
    async createSession(systemPrompt) {
      const messages: Array<{ role: string; content: string }> = [];
      return {
        async prompt(input, options) {
          const sys = options?.responseSchema
            ? `${systemPrompt}\n\nRespond with valid JSON only.`
            : systemPrompt;
          messages.push({ role: "user", content: input });
          const result = await callMessages(sys, messages);
          messages.push({ role: "assistant", content: result });
          return result;
        },
        destroy() { messages.length = 0; },
      };
    },
  };
}
```

### useAI 훅

```typescript
// src/sidepanel/hooks/useAI.ts

type AIStatus = "checking" | "available" | "unavailable";

export function useAI(): {
  status: AIStatus;
  providerLabel: string | null;  // BYOK 설정 시 프로바이더 표시명 ("OpenAI", "Anthropic", "Custom" 등), 미설정 시 null
  generate: AIProvider["generate"];
  createSession: AIProvider["createSession"];
} {
  const llm = useSettingsUiStore((s) => s.llm);

  // llm?.modelId 있으면 → detectProviderKind → 해당 프로바이더 생성, status = "available"
  //   providerLabel = getProviderLabel(llm.baseUrl)
  // llm 없거나 modelId 없으면 → Chrome AI availability 체크 (기존 useChromeAI 로직)
  //   providerLabel = null
  // provider를 useMemo로 llm 변경 시 재생성
  // Chrome AI 세션 cleanup은 useEffect return에서 처리
}
```

### 프로바이더 프리셋

```typescript
// src/sidepanel/lib/ai-provider.ts

export interface ProviderPreset {
  id: string;       // "openai" | "anthropic" | "gemini" | "groq" | "together" | "openrouter" | "ollama"
  label: string;    // 표시명 (배너 뱃지에도 사용)
  baseUrl: string;
  kind: ProviderKind; // "openai" | "anthropic"
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: "openai",     label: "OpenAI",     baseUrl: "https://api.openai.com/v1",                                kind: "openai" },
  { id: "anthropic",  label: "Anthropic",  baseUrl: "https://api.anthropic.com/v1",                             kind: "anthropic" },
  { id: "gemini",     label: "Gemini",     baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",   kind: "openai" },
  { id: "groq",       label: "Groq",       baseUrl: "https://api.groq.com/openai/v1",                           kind: "openai" },
  { id: "together",   label: "Together",   baseUrl: "https://api.together.xyz/v1",                               kind: "openai" },
  { id: "openrouter", label: "OpenRouter",  baseUrl: "https://openrouter.ai/api/v1",                             kind: "openai" },
  { id: "ollama",     label: "Ollama",     baseUrl: "http://localhost:11434/v1",                                  kind: "openai" },
];

/** baseUrl로 프로바이더 표시명 도출. 프리셋 매칭 → 없으면 "Custom" */
export function getProviderLabel(baseUrl: string): string {
  const match = PROVIDER_PRESETS.find((p) => p.baseUrl === baseUrl);
  return match?.label ?? "Custom";
}
```

### 모델 목록

```typescript
// OpenAI-compatible: API에서 가져오기
export async function fetchModels(baseUrl: string, apiKey: string): Promise<ModelEntry[]> {
  const headers: Record<string, string> = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const res = await fetch(`${baseUrl}/models`, { headers });
  if (!res.ok) throw new Error(`Failed to fetch models: ${res.status}`);
  const data = await res.json();
  return (data.data ?? [])
    .map((m: { id: string }) => ({ id: m.id }))
    .sort((a: ModelEntry, b: ModelEntry) => a.id.localeCompare(b.id));
}

// Anthropic: 하드코딩
export const ANTHROPIC_MODELS: ModelEntry[] = [
  { id: "claude-sonnet-4-6" },
  { id: "claude-haiku-4-5-20251001" },
  { id: "claude-opus-4-6" },
];
```

### 호스트 권한 요청

```typescript
export async function requestHostPermission(baseUrl: string): Promise<boolean> {
  const url = new URL(baseUrl);
  const origin = `${url.protocol}//${url.host}/*`;
  return chrome.permissions.request({ origins: [origin] });
}
```

## UI 설계

### 설정 탭 하위 탭 구조

기존 단일 `SettingsTab`을 IntegrationsTab과 동일한 Tabs 구조로 분리:

```
SettingsTab (Tabs container)
├─ TabsList: [이슈 설정] [AI 설정] [기타]  (grid-cols-3)
├─ TabsContent "issue"
│    → 기존 이슈 설정 섹션 그대로 (title prefix + issue composition)
├─ TabsContent "ai"
│    → LlmConnectForm
└─ TabsContent "general"
     → 테마 + 언어 + 푸터(개인정보/리뷰/문의)
```

### LlmConnectForm (AI 설정 탭 컨텐츠)

**미연결 상태 (EmptyState)**:

```
┌──────────────────────────────────┐
│                                  │
│          (🤖 Bot icon)           │
│                                  │
│     AI 모델을 연결하세요          │
│  API 키를 등록하면 더 나은 AI     │
│  기능을 사용할 수 있습니다        │
│                                  │
│       [ API 키 연결 ]            │
│                                  │
│  Chrome AI가 사용 가능하면       │
│  별도 설정 없이 동작합니다       │
│                                  │
└──────────────────────────────────┘
```

- 중앙 정렬 EmptyState (GithubOnboarding과 동일 레이아웃)
- "API 키 연결" 버튼 → LlmConnectDialog 열기

**연결됨 상태 (Connected)**:

```
┌──────────────────────────────────┐
│ 연결 정보                        │
│ ┌──────────────────────────────┐ │
│ │ api.openai.com    연결됨 ✓  │ │
│ │ sk-...a1b2                   │ │
│ └──────────────────────────────┘ │
│                                  │
│ 모델                             │
│ ┌──────────────────────────────┐ │
│ │ gpt-4o-mini           ▾     │ │
│ └──────────────────────────────┘ │
└──────────────────────────────────┘
── 푸터 ───────────────────────────
            [ 연결 해제 ]
```

- `Section("연결 정보")`: Card로 감싼 summary (호스트네임 + 마스킹된 API 키 + 녹색 뱃지)
- `Section("모델")`: 모델 콤보박스 (Popover + Command 패턴). OpenAI는 fetched 목록, Anthropic은 하드코딩 목록. 자유 입력도 허용.
- `PageFooter`: "연결 해제" 버튼 (AlertDialog 확인)

### LlmConnectDialog

PatDialog와 동일한 Dialog 구조:

```
┌──────────────────────────────────┐
│ AI 모델 연결                     │
│ 프로바이더를 선택하고 API 키를    │
│ 입력하세요                       │
│                                  │
│ 프로바이더                       │
│ ┌──────────────────────────────┐ │
│ │ OpenAI                   ▾  │ │
│ └──────────────────────────────┘ │
│                                  │
│ (직접 입력 선택 시)              │
│ 엔드포인트 URL                   │
│ ┌──────────────────────────────┐ │
│ │ https://...                  │ │
│ └──────────────────────────────┘ │
│                                  │
│ API Key                          │
│ ┌──────────────────────────────┐ │
│ │ sk-...                       │ │
│ └──────────────────────────────┘ │
│                                  │
│ (에러 Alert 영역)                │
│                                  │
│            [ 취소 ]  [ 연결 ]    │
└──────────────────────────────────┘
```

- `Dialog` > `DialogContent` (w-[80vw] max-w-[80vw] gap-5 rounded-3xl p-6)
- **프로바이더 Combobox** (`Popover + Command` 패턴):
  - `PROVIDER_PRESETS` 항목 + 마지막에 "직접 입력" 옵션
  - 프리셋 선택 시 `baseUrl` 자동 채움, "직접 입력" 선택 시 하단에 URL Input 노출
  - 기본 선택: OpenAI
- **엔드포인트 URL Input**: "직접 입력" 선택 시에만 표시
- **API Key Input**: placeholder `sk-...`, autoComplete="off"
- "연결" 클릭 시:
  1. `requestHostPermission(baseUrl)` → 실패 시 에러 Alert
  2. `detectProviderKind(baseUrl)`:
     - `"openai"` → `fetchModels(baseUrl, apiKey)` → 실패 시 에러 Alert
     - `"anthropic"` → 검증 스킵
  3. 성공: `setLlm({ baseUrl, apiKey, modelId: "" })` → 다이얼로그 종료
- 로딩 중: "연결" 버튼에 Loader2 스피너 (기존 패턴)

### AI 배너 프로바이더 뱃지

DraftingPanel · StyleEditorPanel의 AI 배너 버튼에 있는 `<Badge>Beta</Badge>`를 BYOK 설정 시 프로바이더명으로 교체한다.

**현재** (Chrome AI):
```tsx
<Badge variant="outline" className="... border-purple-500 text-purple-600 ...">Beta</Badge>
```

**BYOK 설정 시**:
```tsx
<Badge variant="outline" className="... border-purple-500 text-purple-600 ...">
  {providerLabel}  {/* "OpenAI" | "Anthropic" | "Gemini" | "Custom" 등 */}
</Badge>
```

- `useAI()`의 `providerLabel`이 `null`이면 `"Beta"` (Chrome AI fallback)
- `providerLabel`이 있으면 해당 문자열 표시
- 뱃지 색상(purple/teal)은 그대로 유지, 텍스트만 교체
- DraftingPanel과 StyleEditorPanel 양쪽 모두 동일 적용

### i18n 키

```typescript
// ko.ts
settings: {
  // 기존 키 유지
  tab: {
    issue: "이슈 설정",
    ai: "AI 설정",
    general: "기타",
  },
},
llm: {
  onboarding: {
    title: "AI 모델을 연결하세요",
    body: "API 키를 등록하면 더 나은 AI 기능을 사용할 수 있습니다",
    fallback: "Chrome AI가 사용 가능하면 별도 설정 없이 동작합니다",
  },
  connect: "API 키 연결",
  dialog: {
    title: "AI 모델 연결",
    body: "프로바이더를 선택하고 API 키를 입력하세요",
  },
  provider: "프로바이더",
  providerCustom: "직접 입력",
  baseUrl: "엔드포인트 URL",
  baseUrlPlaceholder: "https://...",
  apiKey: "API Key",
  apiKeyPlaceholder: "sk-...",
  section: {
    connection: "연결 정보",
    model: "모델",
  },
  model: {
    placeholder: "모델을 선택하세요",
    refresh: "새로고침",
  },
  connected: "연결됨",
  disconnect: "연결 해제",
  disconnectConfirm: {
    title: "AI 모델 연결을 해제할까요?",
    body: "Chrome AI가 사용 가능하면 자동으로 전환됩니다.",
  },
  error: {
    permission: "호스트 권한이 필요합니다. 다시 시도하세요.",
    fetch: "연결에 실패했습니다. URL과 API 키를 확인하세요.",
    api: "API 호출 실패. 설정에서 API 키를 확인하세요.",
  },
},
```

## 기존 패턴 준수

| 패턴 | 적용 |
|---|---|
| IntegrationsTab 하위 탭 | SettingsTab을 동일한 Tabs/TabsList/TabsContent 구조로 분리 |
| ConnectForm 2-state | LlmConnectForm: 미연결(EmptyState) ↔ 연결됨(Summary + Settings) |
| PatDialog 다이얼로그 | LlmConnectDialog: 동일 레이아웃 (DialogHeader/form/DialogFooter), 동일 에러 핸들링 |
| EmptyState 레이아웃 | GithubOnboarding과 동일: 중앙 정렬, 아이콘 + 제목 + 설명 + CTA |
| Summary Card | GithubSummary와 동일: Card 안에 왼쪽(info) + 오른쪽(Badge) |
| zustand persist + chromeLocalStorage | `llm` 필드를 settings-ui-store에 추가, 동일 persist 미들웨어 |
| 스토어 버전 마이그레이션 | v2 → v3, additive (기존 데이터 무손실) |
| i18n 동시 갱신 | ko/en 양쪽 모두 추가 |
| 에러 토스트 (sonner) | API 호출 실패 시 `toast.error()` |
| `data-[state=inactive]:hidden` | 하위 탭 TabsContent에 적용 (비활성 탭 동시 렌더 방지) |
| AlertDialog 확인 | "연결 해제" 시 IntegrationsTab과 동일한 AlertDialog 확인 |
| 세션 cleanup | useAI 훅 · AiStylingDialog에서 useEffect return으로 세션/메시지 정리 |

## 대안 검토

### 대안 1: background service worker 경유 API 호출

Jira/GitHub 등 플랫폼 API처럼 background SW를 통해 LLM API를 호출하는 방안.

**불채택 이유**: Chrome AI 호출이 이미 sidepanel에서 직접 이루어지고 있으며, API 키도 같은 chrome.storage.local에 저장되어 보안 이점이 없다. 메시지 라우팅 추가는 불필요한 복잡도.

### 대안 2: `response_format: { type: "json_schema" }` (Structured Outputs)

OpenAI의 Structured Outputs를 사용해 Chrome AI의 `responseConstraint`와 동일한 수준의 스키마 강제를 하는 방안.

**불채택 이유**: OpenAI 전용 기능으로, Groq/Together/Ollama/Anthropic 등이 미지원. `{ type: "json_object" }` (JSON mode) + 프롬프트 내 스키마 설명 + 기존 클라이언트 측 파싱으로 충분.

### 대안 3: 설정 탭 분리 없이 AI 섹션만 추가

기존 SettingsTab에 새 Section을 추가하는 방안.

**불채택 이유**: 설정 항목이 늘어나면 단일 스크롤이 길어진다. 하위 탭 분리가 기존 IntegrationsTab/IssueListTab 패턴과 일관되며, AI 설정은 연동 플랫폼 UX(EmptyState → Connected)를 따르기에 별도 탭이 자연스럽다.

## 위험 요소

1. **호스트 권한 UX**: `optional_host_permissions` 요청 시 Chrome이 권한 프롬프트를 표시한다. 사용자가 거부하면 연결 불가. LlmConnectDialog에서 명확한 에러 메시지 필요.

2. **JSON 응답 품질 (Anthropic)**: Anthropic API에는 `response_format: { type: "json_object" }` 같은 JSON 모드가 없다. 시스템 프롬프트에 "Respond with valid JSON only." 지시를 추가하지만, 모델이 이를 무시할 수 있다. 기존 `extractJson` 파서가 markdown fence 등을 처리하므로 대부분 커버 가능.

3. **Anthropic 모델 목록 동기화**: 하드코딩 목록은 새 모델 출시 시 확장 업데이트가 필요하다. 모델 콤보박스에서 자유 입력(직접 model ID 타이핑)을 허용해 대응.

4. **모델 목록 API 차이**: OpenAI-호환 프로바이더마다 `/v1/models` 응답 형식이 미묘하게 다를 수 있다. `data` 배열의 `id` 필드만 사용하고, 실패 시 자유 입력 허용.

5. **멀티턴 컨텍스트 길이**: OpenAI/Anthropic의 멀티턴(AI Styling)에서 메시지가 누적되면 토큰 제한 초과 가능. 현재 보통 1-3턴이라 실질적 위험은 낮음.

6. **설정 탭 분리 회귀**: SettingsTab 구조 변경 시 기존 이슈 설정 · 테마 · 언어 기능이 그대로 동작하는지 수동 확인 필수.
