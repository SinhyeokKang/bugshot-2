export const LLM_PROVIDER_IDS = [
  "openai", "anthropic", "gemini", "mistral", "groq", "together", "openrouter", "ollama",
] as const;

export type LlmProviderId = (typeof LLM_PROVIDER_IDS)[number];
