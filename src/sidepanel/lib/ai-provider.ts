import type { LlmConfig } from "@/store/settings-ui-store";

interface LanguageModelInstance {
  prompt(
    input: string,
    options?: { responseConstraint?: unknown },
  ): Promise<string>;
  destroy(): void;
}

interface LanguageModelLangOptions {
  outputLanguage?: string;
  expectedOutputs?: { type: string; languages: string[] }[];
}

declare global {
  interface LanguageModel {
    availability(options?: LanguageModelLangOptions): Promise<string>;
    create(
      options?: LanguageModelLangOptions & { systemPrompt?: string },
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

export interface AISession {
  prompt(
    input: string,
    options?: {
      responseSchema?: Record<string, unknown>;
      images?: string[];
    },
  ): Promise<string>;
  destroy(): void;
}

export interface AIProvider {
  generate(params: {
    systemPrompt?: string;
    prompt: string;
    images?: string[];
    responseSchema?: Record<string, unknown>;
  }): Promise<string>;

  createSession(systemPrompt: string): Promise<AISession>;
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

export function createChromeAIProvider(): AIProvider {
  return {
    async generate({ systemPrompt, prompt, responseSchema }) {
      if (!globalThis.LanguageModel) throw new Error("Chrome AI unavailable");
      const session = await globalThis.LanguageModel.create({
        systemPrompt,
        ...CHROME_AI_LANG_OPTIONS,
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
      if (!globalThis.LanguageModel) throw new Error("Chrome AI unavailable");
      const session = await globalThis.LanguageModel.create({
        systemPrompt,
        ...CHROME_AI_LANG_OPTIONS,
      });
      return {
        prompt: (input, options) =>
          session.prompt(
            input,
            options?.responseSchema
              ? { responseConstraint: options.responseSchema }
              : undefined,
          ),
        destroy: () => session.destroy(),
      };
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
      if (res.status === 429) throw new LlmQuotaError();
      if (res.status === 503) throw new LlmOverloadedError();
      const text = await res.text().catch(() => "");
      throw new Error(`LLM API error ${res.status}: ${text}`);
    }
    const data = await res.json();
    return data.choices[0].message.content;
  }

  return {
    async generate({ systemPrompt, prompt, images, responseSchema }) {
      const messages: Array<{ role: string; content: OpenAIContent }> = [];
      if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
      messages.push({ role: "user", content: buildOpenAIContent(prompt, images) });
      return callChatCompletions(messages, !!responseSchema);
    },
    async createSession(systemPrompt) {
      const messages: Array<{ role: string; content: OpenAIContent }> = [
        { role: "system", content: systemPrompt },
      ];
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
      if (res.status === 429) throw new LlmQuotaError();
      if (res.status === 529) throw new LlmOverloadedError();
      const text = await res.text().catch(() => "");
      throw new Error(`Anthropic API error ${res.status}: ${text}`);
    }
    const data = await res.json();
    return data.content[0].text;
  }

  return {
    async generate({ systemPrompt, prompt, images, responseSchema }) {
      const sys = responseSchema
        ? `${systemPrompt ?? ""}\n\nRespond with valid JSON only. Schema: ${JSON.stringify(responseSchema)}`
        : (systemPrompt ?? "");
      return callMessages(sys, [{ role: "user", content: buildAnthropicContent(prompt, images) }]);
    },
    async createSession(systemPrompt) {
      const messages: Array<{ role: string; content: AnthropicContent }> = [];
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
