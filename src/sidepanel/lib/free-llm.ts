import {
  LlmRedirectError,
  PROVIDER_PRESETS,
  type ModelEntry,
  type ProviderPreset,
} from "@/sidepanel/lib/ai-provider";

export type FreeLlmPresetId = "gemini" | "openrouter";

export const FREE_LLM_PRESETS = PROVIDER_PRESETS.filter(
  (preset): preset is ProviderPreset & { id: FreeLlmPresetId } =>
    preset.id === "gemini" || preset.id === "openrouter",
);
export const AI_STUDIO_KEY_URL = "https://aistudio.google.com/apikey";
export const OPENROUTER_AUTH_URL = "https://openrouter.ai/auth";
export const OPENROUTER_KEYS_URL = "https://openrouter.ai/api/v1/auth/keys";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export interface PkcePair {
  verifier: string;
  challenge: string;
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function createPkcePair(
  random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
): Promise<PkcePair> {
  const verifier = base64url(random(32));
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(hash)) };
}

export function buildOpenRouterAuthUrl(p: {
  callbackUrl: string;
  challenge: string;
  state: string;
  keyLabel: string;
}): string {
  const url = new URL(OPENROUTER_AUTH_URL);
  url.search = new URLSearchParams({
    callback_url: p.callbackUrl,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
    state: p.state,
    key_label: p.keyLabel,
  }).toString();
  return url.toString();
}

export type OpenRouterCallback = { code: string } | { cancelled: true };

export function parseOpenRouterCallback(
  redirectUrl: string,
  expectedState: string,
): OpenRouterCallback {
  const params = new URL(redirectUrl).searchParams;
  if (params.has("error")) return { cancelled: true };
  // OpenRouter Deny returns the bare callback URL without OAuth parameters.
  if (!params.has("code") && !params.has("state")) return { cancelled: true };
  if (params.get("state") !== expectedState) throw new Error("OpenRouter state mismatch");
  const code = params.get("code");
  if (!code) throw new Error("OpenRouter authorization code missing");
  return { code };
}

function assertOpenRouterResponse(res: Response): void {
  if (res.type === "opaqueredirect" || res.status === 0) throw new LlmRedirectError();
  if (!res.ok) throw new Error(`OpenRouter API error ${res.status}`);
}

export async function exchangeOpenRouterCode(
  code: string,
  verifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchImpl(OPENROUTER_KEYS_URL, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
  });
  assertOpenRouterResponse(res);
  const data = await res.json() as { key?: unknown } | null;
  if (typeof data?.key !== "string" || !data.key) throw new Error("OpenRouter API key missing");
  return data.key;
}

export interface OpenRouterModelRaw {
  id: string;
  architecture?: { input_modalities?: string[] };
}

export function pickFreeVisionModels(raw: OpenRouterModelRaw[]): ModelEntry[] {
  return raw
    .filter((model) => model.id.endsWith(":free") && model.architecture?.input_modalities?.includes("image"))
    .map(({ id }) => ({ id }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function fetchOpenRouterFreeVisionModels(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ModelEntry[]> {
  const res = await fetchImpl(`${OPENROUTER_BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    redirect: "manual",
  });
  assertOpenRouterResponse(res);
  const data = await res.json() as { data?: OpenRouterModelRaw[] };
  return pickFreeVisionModels(data.data ?? []);
}

export function isAuthFlowCancelled(message: string): boolean {
  // Mirrors background/oauth.ts LAUNCH_FLOW_ERRORS without importing its browser bundle.
  return /did not approve access/i.test(message);
}

export interface OpenRouterAuthDeps {
  launch(url: string): Promise<string | undefined>;
  redirectUrl: string;
  random(n: number): Uint8Array;
  fetchImpl: typeof fetch;
}

export type OpenRouterAuthResult = { status: "ok"; key: string } | { status: "cancelled" };

export async function runOpenRouterAuth(deps: OpenRouterAuthDeps): Promise<OpenRouterAuthResult> {
  const { verifier, challenge } = await createPkcePair(deps.random);
  const state = base64url(deps.random(32));
  const url = buildOpenRouterAuthUrl({
    callbackUrl: deps.redirectUrl,
    challenge,
    state,
    keyLabel: "BugShot",
  });
  let redirect: string | undefined;
  try {
    redirect = await deps.launch(url);
  } catch (err) {
    if (isAuthFlowCancelled(err instanceof Error ? err.message : String(err))) {
      return { status: "cancelled" };
    }
    throw err;
  }
  if (!redirect) return { status: "cancelled" };
  const callback = parseOpenRouterCallback(redirect, state);
  if ("cancelled" in callback) return { status: "cancelled" };
  const key = await exchangeOpenRouterCode(callback.code, verifier, deps.fetchImpl);
  return { status: "ok", key };
}

export type ProbeResult = "ok" | "unavailable" | "transient";

export async function probeOpenRouterModel(
  apiKey: string,
  modelId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProbeResult> {
  let res: Response;
  try {
    res = await fetchImpl(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 16,
      }),
    });
  } catch {
    return "transient";
  }
  if (res.ok) return "ok";
  if (res.status === 403 || res.status === 404) return "unavailable";
  return "transient";
}
