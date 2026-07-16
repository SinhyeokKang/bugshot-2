import type { LlmConfig } from "@/store/settings-ui-store";

interface LanguageModelInstance {
  prompt(
    input: string,
    options?: { responseConstraint?: unknown },
  ): Promise<string>;
  destroy(): void;
  // 신명칭. 구명칭(inputUsage/inputQuota/measureInputUsage)은 확장에서 deprecated라
  // 신명칭을 우선 읽고 구명칭으로 폴백한다.
  contextUsage?: number;
  contextWindow?: number;
  measureContextUsage?(
    input: string,
    options?: { responseConstraint?: unknown },
  ): Promise<number>;
  inputUsage?: number;
  inputQuota?: number;
  measureInputUsage?(
    input: string,
    options?: { responseConstraint?: unknown },
  ): Promise<number>;
}

interface LanguageModelLangOptions {
  outputLanguage?: string;
  expectedOutputs?: { type: string; languages: string[] }[];
}

interface LanguageModelInitialPrompt {
  role: "system" | "user" | "assistant";
  content: string;
}

declare global {
  interface LanguageModel {
    availability(options?: LanguageModelLangOptions): Promise<string>;
    create(
      options?: LanguageModelLangOptions & {
        initialPrompts?: LanguageModelInitialPrompt[];
      },
    ): Promise<LanguageModelInstance>;
  }
  // eslint-disable-next-line no-var
  var LanguageModel: LanguageModel | undefined;
}

// Chrome Built-in AI 출력 언어 옵션 단일 출처. 잘못 명시하면 "No output language
// was specified" 경고가 뜬다. availability와 create에 동일 옵션을 넘겨야 한다.
export const CHROME_AI_LANG_OPTIONS: LanguageModelLangOptions = {
  outputLanguage: "en",
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

export type ProviderKind = "openai" | "anthropic";

// 프로바이더 능력은 등급 스칼라가 아니라 독립된 3축이다 — 저가 BYOK 모델(gpt-4o-mini)은
// 싸지만 나노 제약이 없고, 로컬 소형 모델(Ollama 3B)은 나노와 같은 제약을 갖는다.
export type PromptStyle = "compact" | "rich";

export interface ProviderCapabilities {
  readonly promptStyle: PromptStyle;
  readonly supportsImages: boolean;
  readonly contextBudgetChars: number;
}

export const NANO_CAPABILITIES: ProviderCapabilities = {
  promptStyle: "compact",
  supportsImages: false,
  contextBudgetChars: 10_000,
};

export const BYOK_CAPABILITIES: ProviderCapabilities = {
  promptStyle: "rich",
  supportsImages: true,
  contextBudgetChars: Number.MAX_SAFE_INTEGER,
};

// 로컬 엔드포인트(Ollama 등)에서 도는 건 통상 소형 모델이라 나노와 같은 제약을 갖는다.
// rich 본문·스크린샷·무제한 예산을 그대로 밀면 3단 가드가 통째로 우회된다.
export const LOCAL_BYOK_CAPABILITIES: ProviderCapabilities = {
  promptStyle: "compact",
  supportsImages: false,
  contextBudgetChars: 8_000,
};

// loopback만 로컬로 본다. LAN에 띄운 Ollama(`OLLAMA_HOST=0.0.0.0` → 192.168.*·*.local)는
// 원격으로 잡혀 rich 좌표를 받는다 — 의도된 한계다. 주소만으론 그 뒤에 3B가 있는지
// 사내 vLLM 대형 모델이 있는지 알 수 없어, 추측으로 강등시키지 않는다.
function isLocalEndpoint(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname;
    return (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

export function byokCapabilities(baseUrl: string): ProviderCapabilities {
  return isLocalEndpoint(baseUrl) ? LOCAL_BYOK_CAPABILITIES : BYOK_CAPABILITIES;
}

// few-shot 1쌍. systemPrompt 문자열이 아니라 별도 채널(Chrome initialPrompts / BYOK
// messages 선주입)로 나가야 compact 본문의 "JSON 규칙 없음" 불변식과 충돌하지 않는다.
export interface FewShotExample {
  user: string;
  assistant: string;
}

export interface AISession {
  prompt(
    input: string,
    options?: {
      responseSchema?: Record<string, unknown>;
      images?: string[];
    },
  ): Promise<string>;
  destroy(): void;
  measureContextUsage?(
    input: string,
    options?: { responseSchema?: Record<string, unknown> },
  ): Promise<number>;
  readonly contextUsage?: number;
  readonly contextWindow?: number;
}

export interface AIProvider {
  readonly capabilities: ProviderCapabilities;

  generate(params: {
    systemPrompt?: string;
    prompt: string;
    images?: string[];
    responseSchema?: Record<string, unknown>;
  }): Promise<string>;

  createSession(
    systemPrompt: string,
    fewShot?: FewShotExample[],
  ): Promise<AISession>;
}

export interface ModelEntry {
  id: string;
}

export class LlmQuotaError extends Error {
  constructor() {
    super("quota_exceeded");
    this.name = "LlmQuotaError";
  }
}

export class LlmOverloadedError extends Error {
  constructor() {
    super("overloaded");
    this.name = "LlmOverloadedError";
  }
}

export class LlmAuthError extends Error {
  constructor() {
    super("auth_failed");
    this.name = "LlmAuthError";
  }
}

// 호출은 성공했으나 모델이 빈/파싱 불가 응답을 준 경우. LLM 의존 기능 공통(초안·스타일링·재현단계)
// 에서 toastLlmError로 "다시 시도" 안내를 띄우기 위한 에러.
export class LlmEmptyResponseError extends Error {
  constructor() {
    super("empty_response");
    this.name = "LlmEmptyResponseError";
  }
}

export class AiContextOverflowError extends Error {
  constructor() {
    super("context_overflow");
    this.name = "AiContextOverflowError";
  }
}

// create()/prompt()가 던지는 QuotaExceededError를 컨텍스트 초과로 승격한다.
// 실측 API가 없는 구버전 Chrome에서는 이게 유일한 초과 신호다.
// DOMException은 Error 서브클래스가 아니라 name으로 판별한다.
export function mapQuotaError(err: unknown): never {
  const name = (err as { name?: unknown } | null)?.name;
  if (name === "QuotaExceededError") throw new AiContextOverflowError();
  throw err;
}

// 일시적 오버로드/게이트웨이 오류에 한해 1s → 2s 백오프로 2회 재시도.
const RETRY_DELAYS_MS = [1000, 2000];

// 출력 토큰 상한 — 모든 프로바이더 공통. 초안/스타일링 출력은 한참 밑이라 잘림 방지용 방어값.
const LLM_MAX_TOKENS = 4096;

export function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds) * 1000;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retryStatuses: number[],
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    if (!retryStatuses.includes(res.status) || attempt >= RETRY_DELAYS_MS.length) {
      return res;
    }
    const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
    const wait = retryAfterMs ?? RETRY_DELAYS_MS[attempt];
    console.warn(
      `[ai-provider] ${res.status} from ${url} → retry in ${wait}ms (${attempt + 1}/${RETRY_DELAYS_MS.length})`,
    );
    await new Promise((r) => setTimeout(r, wait));
  }
}

export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  kind: ProviderKind;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", kind: "openai" },
  { id: "anthropic", label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", kind: "anthropic" },
  { id: "gemini", label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", kind: "openai" },
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", kind: "openai" },
  { id: "together", label: "Together", baseUrl: "https://api.together.xyz/v1", kind: "openai" },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", kind: "openai" },
  { id: "ollama", label: "Ollama", baseUrl: "http://localhost:11434/v1", kind: "openai" },
];

export const ANTHROPIC_MODELS: ModelEntry[] = [
  { id: "claude-sonnet-4-6" },
  { id: "claude-haiku-4-5-20251001" },
  { id: "claude-opus-4-8" },
];

export const GEMINI_MODELS: ModelEntry[] = [
  { id: "gemini-2.5-flash" },
  { id: "gemini-2.5-pro" },
  { id: "gemini-2.0-flash" },
];

export function detectProviderKind(baseUrl: string): ProviderKind {
  const preset = PROVIDER_PRESETS.find((p) => p.baseUrl === baseUrl);
  if (preset) return preset.kind;
  try {
    const hostname = new URL(baseUrl).hostname;
    if (hostname === "api.anthropic.com") return "anthropic";
  } catch { /* invalid URL → fallback */ }
  return "openai";
}

export function getProviderLabel(baseUrl: string): string {
  const preset = PROVIDER_PRESETS.find((p) => p.baseUrl === baseUrl);
  return preset?.label ?? "Custom";
}

function buildInitialPrompts(
  systemPrompt: string,
  fewShot?: FewShotExample[],
): LanguageModelInitialPrompt[] {
  const prompts: LanguageModelInitialPrompt[] = [
    { role: "system", content: systemPrompt },
  ];
  for (const ex of fewShot ?? []) {
    prompts.push({ role: "user", content: ex.user });
    prompts.push({ role: "assistant", content: ex.assistant });
  }
  return prompts;
}

function wrapChromeSession(native: LanguageModelInstance): AISession {
  const measure = native.measureContextUsage ?? native.measureInputUsage;
  return {
    prompt: (input, options) =>
      native
        .prompt(
          input,
          options?.responseSchema
            ? { responseConstraint: options.responseSchema }
            : undefined,
        )
        .catch(mapQuotaError),
    destroy: () => native.destroy(),
    get contextUsage() {
      return native.contextUsage ?? native.inputUsage;
    },
    get contextWindow() {
      return native.contextWindow ?? native.inputQuota;
    },
    measureContextUsage: measure
      ? (input, options) =>
          measure.call(
            native,
            input,
            options?.responseSchema
              ? { responseConstraint: options.responseSchema }
              : undefined,
          )
      : undefined,
  };
}

export function createChromeAIProvider(): AIProvider {
  return {
    capabilities: NANO_CAPABILITIES,

    async generate({ systemPrompt, prompt, responseSchema }) {
      if (!globalThis.LanguageModel) throw new Error("Chrome AI unavailable");
      const session = await globalThis.LanguageModel.create({
        initialPrompts: buildInitialPrompts(systemPrompt ?? ""),
        ...CHROME_AI_LANG_OPTIONS,
      }).catch(mapQuotaError);
      try {
        return await session
          .prompt(
            prompt,
            responseSchema ? { responseConstraint: responseSchema } : undefined,
          )
          .catch(mapQuotaError);
      } finally {
        session.destroy();
      }
    },

    async createSession(systemPrompt, fewShot) {
      if (!globalThis.LanguageModel) throw new Error("Chrome AI unavailable");
      const native = await globalThis.LanguageModel.create({
        initialPrompts: buildInitialPrompts(systemPrompt, fewShot),
        ...CHROME_AI_LANG_OPTIONS,
      }).catch(mapQuotaError);
      return wrapChromeSession(native);
    },
  };
}

type OpenAIContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

function buildOpenAIContent(text: string, images?: string[]): OpenAIContent {
  if (!images?.length) return text;
  return [
    ...images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
    { type: "text" as const, text },
  ];
}

export function createOpenAICompatibleProvider(config: LlmConfig): AIProvider {
  async function callChatCompletions(
    messages: Array<{ role: string; content: OpenAIContent }>,
    jsonMode: boolean,
  ): Promise<string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

    const body: Record<string, unknown> = {
      model: config.modelId,
      messages,
      max_tokens: LLM_MAX_TOKENS,
    };
    if (jsonMode) body.response_format = { type: "json_object" };

    const res = await fetchWithRetry(
      `${config.baseUrl}/chat/completions`,
      { method: "POST", headers, body: JSON.stringify(body) },
      [502, 503, 504],
    );
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new LlmAuthError();
      if (res.status === 429) throw new LlmQuotaError();
      if (res.status === 503) throw new LlmOverloadedError();
      const text = await res.text().catch(() => "");
      throw new Error(`LLM API error ${res.status}: ${text}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("LLM API: empty or malformed response");
    }
    return content;
  }

  return {
    capabilities: byokCapabilities(config.baseUrl),

    async generate({ systemPrompt, prompt, images, responseSchema }) {
      const messages: Array<{ role: string; content: OpenAIContent }> = [];
      if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
      messages.push({ role: "user", content: buildOpenAIContent(prompt, images) });
      return callChatCompletions(messages, !!responseSchema);
    },
    async createSession(systemPrompt, fewShot) {
      const messages: Array<{ role: string; content: OpenAIContent }> = [
        { role: "system", content: systemPrompt },
      ];
      for (const ex of fewShot ?? []) {
        messages.push({ role: "user", content: ex.user });
        messages.push({ role: "assistant", content: ex.assistant });
      }
      return {
        async prompt(input, options) {
          messages.push({ role: "user", content: buildOpenAIContent(input, options?.images) });
          const result = await callChatCompletions(messages, !!options?.responseSchema);
          messages.push({ role: "assistant", content: result });
          return result;
        },
        destroy() {
          messages.length = 0;
        },
      };
    },
  };
}

const ANTHROPIC_VERSION = "2023-06-01";

type AnthropicContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
    >;

function buildAnthropicContent(text: string, images?: string[]): AnthropicContent {
  if (!images?.length) return text;
  return [
    ...images.map((dataUrl) => {
      const [meta, data] = dataUrl.split(",");
      const mediaType = meta.match(/data:(.*?);/)?.[1] ?? "image/png";
      return {
        type: "image" as const,
        source: { type: "base64" as const, media_type: mediaType, data },
      };
    }),
    { type: "text" as const, text },
  ];
}

export function createAnthropicProvider(config: LlmConfig): AIProvider {
  async function callMessages(
    system: string,
    messages: Array<{ role: string; content: AnthropicContent }>,
  ): Promise<string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
    };
    if (config.apiKey) headers["x-api-key"] = config.apiKey;

    const res = await fetchWithRetry(
      `${config.baseUrl}/messages`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: config.modelId,
          max_tokens: LLM_MAX_TOKENS,
          system,
          messages,
        }),
      },
      [502, 504, 529],
    );
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new LlmAuthError();
      if (res.status === 429) throw new LlmQuotaError();
      if (res.status === 529) throw new LlmOverloadedError();
      const text = await res.text().catch(() => "");
      throw new Error(`Anthropic API error ${res.status}: ${text}`);
    }
    const data = await res.json();
    const text = data?.content?.[0]?.text;
    if (typeof text !== "string") {
      throw new Error("Anthropic API: empty or malformed response");
    }
    return text;
  }

  return {
    capabilities: byokCapabilities(config.baseUrl),

    async generate({ systemPrompt, prompt, images, responseSchema }) {
      const sys = responseSchema
        ? `${systemPrompt ?? ""}\n\nRespond with valid JSON only. Schema: ${JSON.stringify(responseSchema)}`
        : (systemPrompt ?? "");
      return callMessages(sys, [{ role: "user", content: buildAnthropicContent(prompt, images) }]);
    },
    async createSession(systemPrompt, fewShot) {
      const messages: Array<{ role: string; content: AnthropicContent }> = [];
      for (const ex of fewShot ?? []) {
        messages.push({ role: "user", content: ex.user });
        messages.push({ role: "assistant", content: ex.assistant });
      }
      return {
        async prompt(input, options) {
          const sys = options?.responseSchema
            ? `${systemPrompt}\n\nRespond with valid JSON only. Schema: ${JSON.stringify(options.responseSchema)}`
            : systemPrompt;
          messages.push({ role: "user", content: buildAnthropicContent(input, options?.images) });
          const result = await callMessages(sys, messages);
          messages.push({ role: "assistant", content: result });
          return result;
        },
        destroy() {
          messages.length = 0;
        },
      };
    },
  };
}

export async function pingAnthropic(
  baseUrl: string,
  apiKey: string,
): Promise<void> {
  const res = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODELS[0].id,
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }
}

export async function fetchModels(
  baseUrl: string,
  apiKey: string,
): Promise<ModelEntry[]> {
  const headers: Record<string, string> = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const res = await fetch(`${baseUrl}/models`, { headers });
  if (!res.ok) throw new Error(`Failed to fetch models: ${res.status}`);
  const data = await res.json();
  return (data.data ?? [])
    .map((m: { id: string }) => ({ id: m.id }))
    .sort((a: ModelEntry, b: ModelEntry) => a.id.localeCompare(b.id));
}

export async function requestHostPermission(
  baseUrl: string,
): Promise<boolean> {
  const url = new URL(baseUrl);
  const origin = `${url.protocol}//${url.host}/*`;
  return chrome.permissions.request({ origins: [origin] });
}
