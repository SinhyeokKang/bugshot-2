import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { LlmRedirectError, PROVIDER_PRESETS } from "../ai-provider";
import {
  AI_STUDIO_KEY_URL,
  FREE_LLM_PRESETS,
  OPENROUTER_AUTH_URL,
  OPENROUTER_BASE_URL,
  OPENROUTER_KEYS_URL,
  buildOpenRouterAuthUrl,
  createPkcePair,
  exchangeOpenRouterCode,
  fetchOpenRouterFreeVisionModels,
  isAuthFlowCancelled,
  parseOpenRouterCallback,
  pickFreeVisionModels,
  probeOpenRouterModel,
  runOpenRouterAuth,
  type OpenRouterAuthDeps,
} from "../free-llm";

const REDIRECT_URL = "https://test-extension.chromiumapp.org/";
const TEST_KEY = `sk-or-v1-${"a".repeat(64)}`;
const RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

// Task 0 T0-3 response shape; pricing overrides deliberately disagree with the suffix.
const MODEL_FIXTURE = [
  { id: "z/vision:free", pricing: { prompt: "1", completion: "1", overrides: [{ prompt: "0", completion: "0" }] }, architecture: { input_modalities: ["text", "image"] } },
  { id: "text/only:free", pricing: { prompt: "0", completion: "0", overrides: [] }, architecture: { input_modalities: ["text"] } },
  { id: "paid/vision", pricing: { prompt: "0", completion: "0", overrides: [] }, architecture: { input_modalities: ["image"] } },
  { id: "missing/architecture:free", pricing: { prompt: "0", completion: "0", overrides: [] } },
  { id: "a/vision:free", pricing: { prompt: "0", completion: "0", overrides: [] }, architecture: { input_modalities: ["image", "text"] } },
];

function mockFetch(body: unknown, status = 200) {
  return vi.fn<typeof fetch>().mockResolvedValue(Response.json(body, { status }));
}

function authDeps() {
  const random = vi.fn((n: number) => new Uint8Array(n).fill(1));
  const launch = vi.fn<OpenRouterAuthDeps["launch"]>().mockImplementation(async (url) => {
    const state = new URL(url).searchParams.get("state")!;
    return `${REDIRECT_URL}?code=issued-code&state=${state}`;
  });
  return { launch, redirectUrl: REDIRECT_URL, random, fetchImpl: mockFetch({ key: TEST_KEY, user_id: "test-user" }) };
}

describe("free preset metadata", () => {
  it("reuses the existing provider metadata for Gemini and OpenRouter", () => {
    expect(FREE_LLM_PRESETS.map((preset) => preset.id)).toEqual(["gemini", "openrouter"]);
    for (const preset of FREE_LLM_PRESETS) {
      expect(preset).toEqual(PROVIDER_PRESETS.find((entry) => entry.id === preset.id));
    }
    expect(OPENROUTER_BASE_URL).toBe(PROVIDER_PRESETS.find((preset) => preset.id === "openrouter")?.baseUrl);
    expect(AI_STUDIO_KEY_URL).toBe("https://aistudio.google.com/apikey");
  });
});

describe("createPkcePair", () => {
  it("matches RFC 7636 Appendix B with injected random bytes", async () => {
    const random = vi.fn(() => new Uint8Array(Buffer.from(RFC_VERIFIER, "base64url")));
    expect(await createPkcePair(random)).toEqual({ verifier: RFC_VERIFIER, challenge: RFC_CHALLENGE });
    expect(random).toHaveBeenCalledWith(32);
  });

  it("generates an unpadded base64url verifier and a fresh pair", async () => {
    const first = await createPkcePair();
    const second = await createPkcePair();
    expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(first.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.verifier).not.toBe(second.verifier);
  });
});

describe("buildOpenRouterAuthUrl", () => {
  it("encodes every authorization parameter without losing callback queries", () => {
    const callbackUrl = `${REDIRECT_URL}?return=a+b&next=/settings`;
    const url = new URL(buildOpenRouterAuthUrl({ callbackUrl, challenge: RFC_CHALLENGE, state: "state +/&", keyLabel: "BugShot Test & QA" }));
    expect(`${url.origin}${url.pathname}`).toBe(OPENROUTER_AUTH_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      callback_url: callbackUrl, code_challenge: RFC_CHALLENGE,
      code_challenge_method: "S256", state: "state +/&", key_label: "BugShot Test & QA",
    });
    expect(url.searchParams.has("code_verifier")).toBe(false);
  });
});

describe("parseOpenRouterCallback", () => {
  it("returns the decoded code after checking state", () => {
    expect(parseOpenRouterCallback(`${REDIRECT_URL}?code=a%2Bb&state=expected`, "expected")).toEqual({ code: "a+b" });
  });

  it.each([
    `${REDIRECT_URL}?code=code&state=wrong`,
    `${REDIRECT_URL}?code=code`,
    `${REDIRECT_URL}?state=expected`,
    `${REDIRECT_URL}?code=&state=expected`,
    "not a URL",
  ])("rejects invalid success callbacks: %s", (url) => {
    expect(() => parseOpenRouterCallback(url, "expected")).toThrow();
  });

  it.each(["access_denied", "", "provider_rejection"])("treats the presence of error=%s as cancellation (orch D5)", (error) => {
    expect(parseOpenRouterCallback(`${REDIRECT_URL}?error=${error}`, "expected")).toEqual({ cancelled: true });
  });
});

describe("exchangeOpenRouterCode", () => {
  it("exchanges code and verifier directly and returns only the key", async () => {
    const fetchImpl = mockFetch({ key: TEST_KEY, user_id: "test-user" });
    await expect(exchangeOpenRouterCode("code", RFC_VERIFIER, fetchImpl)).resolves.toBe(TEST_KEY);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(OPENROUTER_KEYS_URL, {
      method: "POST", redirect: "manual", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "code", code_verifier: RFC_VERIFIER, code_challenge_method: "S256" }),
    });
  });

  it("rejects non-success responses without exposing the response body", async () => {
    await expect(exchangeOpenRouterCode("code", "verifier", mockFetch({ key: TEST_KEY }, 400))).rejects.toThrow();
  });

  it.each([{}, { key: "" }, { key: 123 }, null])("rejects missing or malformed keys: %j", async (body) => {
    await expect(exchangeOpenRouterCode("code", "verifier", mockFetch(body))).rejects.toThrow();
  });

  it("rejects opaque redirects", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue({ type: "opaqueredirect", status: 0, ok: false } as Response);
    await expect(exchangeOpenRouterCode("code", "verifier", fetchImpl)).rejects.toBeInstanceOf(LlmRedirectError);
  });
});

describe("free vision models", () => {
  it("filters by suffix and image modality, ignores prices, sorts without mutating input", () => {
    const original = structuredClone(MODEL_FIXTURE);
    expect(pickFreeVisionModels(MODEL_FIXTURE)).toEqual([{ id: "a/vision:free" }, { id: "z/vision:free" }]);
    expect(MODEL_FIXTURE).toEqual(original);
    expect(pickFreeVisionModels([])).toEqual([]);
    expect(pickFreeVisionModels([{ id: "no/modalities:free", architecture: {} }])).toEqual([]);
  });

  it("fetches the model catalogue with a bearer token and manual redirects", async () => {
    const fetchImpl = mockFetch({ data: MODEL_FIXTURE });
    await expect(fetchOpenRouterFreeVisionModels(TEST_KEY, fetchImpl)).resolves.toEqual([{ id: "a/vision:free" }, { id: "z/vision:free" }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(`${OPENROUTER_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${TEST_KEY}` }, redirect: "manual",
    });
  });

  it("returns no models when data is missing", async () => {
    await expect(fetchOpenRouterFreeVisionModels(TEST_KEY, mockFetch({}))).resolves.toEqual([]);
  });

  it("rejects opaque redirects as LlmRedirectError", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue({ type: "opaqueredirect", status: 0, ok: false } as Response);
    await expect(fetchOpenRouterFreeVisionModels(TEST_KEY, fetchImpl)).rejects.toBeInstanceOf(LlmRedirectError);
  });

  it("rejects a failed catalogue request", async () => {
    await expect(fetchOpenRouterFreeVisionModels(TEST_KEY, mockFetch({}, 401))).rejects.toThrow();
  });
});

describe("isAuthFlowCancelled", () => {
  // Same messages as background/oauth.ts LAUNCH_FLOW_ERRORS; no background value import.
  it.each([
    ["The user did not approve access.", true],
    ["THE USER DID NOT APPROVE ACCESS.", true],
    ["Authorization page could not be loaded.", false],
    ["Failed to create a browser window.", false],
    ["The browser context has been shut down.", false],
    ["Only one web auth flow is allowed at a time.", false],
    ["Unknown failure", false],
  ])("classifies %s", (message, expected) => {
    expect(isAuthFlowCancelled(message)).toBe(expected);
  });
});

describe("runOpenRouterAuth", () => {
  it("binds the generated verifier to the authorization challenge and exchanges the returned code", async () => {
    const deps = authDeps();
    deps.random.mockImplementationOnce(() => new Uint8Array(Buffer.from(RFC_VERIFIER, "base64url")));
    await expect(runOpenRouterAuth(deps)).resolves.toEqual({ status: "ok", key: TEST_KEY });
    const params = new URL(deps.launch.mock.calls[0][0]).searchParams;
    expect(params.get("callback_url")).toBe(REDIRECT_URL);
    expect(params.get("code_challenge")).toBe(RFC_CHALLENGE);
    expect(params.get("state")).toMatch(/^[A-Za-z0-9_-]{22,}$/);
    expect(params.get("state")).not.toBe(RFC_VERIFIER);
    expect(params.get("key_label")).toBe("BugShot");
    expect(deps.random).toHaveBeenCalledTimes(2);
    expect(JSON.parse(deps.fetchImpl.mock.calls[0][1]!.body as string)).toEqual({ code: "issued-code", code_verifier: RFC_VERIFIER, code_challenge_method: "S256" });
  });

  it.each([new Error("The user did not approve access."), "The user did not approve access."])("maps launch rejection to cancellation: %s", async (error) => {
    const deps = authDeps();
    deps.launch.mockRejectedValue(error);
    await expect(runOpenRouterAuth(deps)).resolves.toEqual({ status: "cancelled" });
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it("preserves authorization page failures", async () => {
    const deps = authDeps();
    const error = new Error("Authorization page could not be loaded.");
    deps.launch.mockRejectedValue(error);
    await expect(runOpenRouterAuth(deps)).rejects.toBe(error);
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([undefined, `${REDIRECT_URL}?error=access_denied`])("does not exchange a cancelled callback: %s", async (redirect) => {
    const deps = authDeps();
    deps.launch.mockResolvedValue(redirect);
    await expect(runOpenRouterAuth(deps)).resolves.toEqual({ status: "cancelled" });
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects mismatched state before sending any exchange request", async () => {
    const deps = authDeps();
    deps.launch.mockResolvedValue(`${REDIRECT_URL}?code=code&state=wrong`);
    await expect(runOpenRouterAuth(deps)).rejects.toThrow();
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it("does not classify exchange failures as launch cancellation", async () => {
    const deps = authDeps();
    const error = new Error("The user did not approve access.");
    deps.fetchImpl.mockRejectedValue(error);
    await expect(runOpenRouterAuth(deps)).rejects.toBe(error);
  });
});

describe("probeOpenRouterModel", () => {
  it.each([
    [200, "ok"], [403, "unavailable"], [404, "unavailable"],
    [429, "transient"], [500, "transient"], [503, "transient"],
    [400, "transient"], [401, "transient"], [302, "transient"],
  ])("classifies HTTP %i as %s", async (status, result) => {
    const message = status === 403 ? "This model is only available on agentic harnesses" : "temporarily rate-limited upstream";
    await expect(probeOpenRouterModel(TEST_KEY, "vision:free", mockFetch({ error: { message } }, status))).resolves.toBe(result);
  });

  it("allows transient network failures", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(probeOpenRouterModel(TEST_KEY, "vision:free", fetchImpl)).resolves.toBe("transient");
  });

  it("sends one fixed-text request without user content or redirects", async () => {
    const fetchImpl = mockFetch({});
    await probeOpenRouterModel(TEST_KEY, "vision:free", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST", redirect: "manual",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TEST_KEY}` },
      body: JSON.stringify({ model: "vision:free", messages: [{ role: "user", content: "ping" }], max_tokens: 16 }),
    });
  });
});

describe("browser binding coverage boundary", () => {
  it("excludes only the launcher from the logic denominator", () => {
    const source = readFileSync("scripts/coverage-report.mjs", "utf8");
    const rules = source.slice(source.indexOf("const BROWSER_BOUND_EXACT"), source.indexOf("function loadSummary"));
    const isBrowserBound = runInNewContext(`${rules}\nisBrowserBound`) as (path: string) => boolean;
    expect(isBrowserBound("src/sidepanel/openrouter-auth.ts")).toBe(true);
    expect(isBrowserBound("src/sidepanel/lib/free-llm.ts")).toBe(false);
  });
});
