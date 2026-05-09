import type { LlmConfig } from "@/store/settings-ui-store";

interface LanguageModelInstance {
  prompt(
    input: string,
    options?: { responseConstraint?: unknown },
  ): Promise<string>;
  destroy(): void;
}

declare global {
  interface LanguageModel {
    availability(options?: {
      expectedOutputLanguages?: string[];
    }): Promise<string>;
    create(options?: {
      systemPrompt?: string;
      expectedOutputLanguages?: string[];
      outputLanguages?: string[];
    }): Promise<LanguageModelInstance>;
  }
  // eslint-disable-next-line no-var
  var LanguageModel: LanguageModel | undefined;
}

export type ProviderKind = "openai" | "anthropic";

export interface AISession {
  prompt(
    input: string,
    options?: { responseSchema?: Record<string, unknown> },
  ): Promise<string>;
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

export interface ModelEntry {
  id: string;
}

export class LlmQuotaError extends Error {
  constructor() {
    super("quota_exceeded");
    this.name = "LlmQuotaError";
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
  { id: "claude-opus-4-6" },
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
      if (!globalThis.LanguageModel) throw new Error("Chrome AI unavailable");
      const session = await globalThis.LanguageModel.create({
        systemPrompt,
        expectedOutputLanguages: ["en"],
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

export function createOpenAICompatibleProvider(config: LlmConfig): AIProvider {
  async function callChatCompletions(
    messages: Array<{ role: string; content: string }>,
    jsonMode: boolean,
  ): Promise<string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

    const body: Record<string, unknown> = { model: config.modelId, messages };
    if (jsonMode) body.response_format = { type: "json_object" };

    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      if (res.status === 429) throw new LlmQuotaError();
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
        destroy() {
          messages.length = 0;
        },
      };
    },
  };
}

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
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: config.modelId,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        system,
        messages,
      }),
    });
    if (!res.ok) {
      if (res.status === 429) throw new LlmQuotaError();
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
      model: "claude-haiku-4-5-20251001",
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
