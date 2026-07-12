import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  AiContextOverflowError,
  byokCapabilities,
  BYOK_CAPABILITIES,
  LOCAL_BYOK_CAPABILITIES,
  CHROME_AI_LANG_OPTIONS,
  createAnthropicProvider,
  createChromeAIProvider,
  createOpenAICompatibleProvider,
  detectProviderKind,
  fetchWithRetry,
  getProviderLabel,
  LlmOverloadedError,
  LlmQuotaError,
  mapQuotaError,
  NANO_CAPABILITIES,
  parseRetryAfterMs,
  PROVIDER_PRESETS,
  ANTHROPIC_MODELS,
  GEMINI_MODELS,
} from "../ai-provider";

describe("PROVIDER_PRESETS", () => {
  it("7개 프리셋이 정의됨", () => {
    expect(PROVIDER_PRESETS).toHaveLength(7);
  });

  it("모든 프리셋이 id, label, baseUrl, kind 필드를 가짐", () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(typeof preset.id).toBe("string");
      expect(typeof preset.label).toBe("string");
      expect(typeof preset.baseUrl).toBe("string");
      expect(["openai", "anthropic"]).toContain(preset.kind);
    }
  });

  it("id가 고유함", () => {
    const ids = PROVIDER_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("OpenAI, Anthropic, Gemini 프리셋이 포함됨", () => {
    const ids = PROVIDER_PRESETS.map((p) => p.id);
    expect(ids).toContain("openai");
    expect(ids).toContain("anthropic");
    expect(ids).toContain("gemini");
  });
});

describe("ANTHROPIC_MODELS", () => {
  it("최소 1개 모델이 포함됨", () => {
    expect(ANTHROPIC_MODELS.length).toBeGreaterThanOrEqual(1);
  });

  it("모든 항목이 id 필드를 가짐", () => {
    for (const model of ANTHROPIC_MODELS) {
      expect(typeof model.id).toBe("string");
      expect(model.id.length).toBeGreaterThan(0);
    }
  });

  it("claude 모델이 포함됨", () => {
    const hasClaudeModel = ANTHROPIC_MODELS.some((m) =>
      m.id.startsWith("claude"),
    );
    expect(hasClaudeModel).toBe(true);
  });
});

describe("GEMINI_MODELS", () => {
  it("최소 1개 모델이 포함됨", () => {
    expect(GEMINI_MODELS.length).toBeGreaterThanOrEqual(1);
  });

  it("모든 항목이 id 필드를 가짐", () => {
    for (const model of GEMINI_MODELS) {
      expect(typeof model.id).toBe("string");
      expect(model.id.length).toBeGreaterThan(0);
    }
  });

  it("gemini 모델이 포함됨", () => {
    const hasGeminiModel = GEMINI_MODELS.some((m) =>
      m.id.startsWith("gemini"),
    );
    expect(hasGeminiModel).toBe(true);
  });
});

describe("detectProviderKind", () => {
  it("OpenAI 프리셋 URL → openai", () => {
    expect(detectProviderKind("https://api.openai.com/v1")).toBe("openai");
  });

  it("Anthropic 프리셋 URL → anthropic", () => {
    expect(detectProviderKind("https://api.anthropic.com/v1")).toBe(
      "anthropic",
    );
  });

  it("Gemini 프리셋 URL → openai (OpenAI-compatible)", () => {
    expect(
      detectProviderKind(
        "https://generativelanguage.googleapis.com/v1beta/openai",
      ),
    ).toBe("openai");
  });

  it("Groq 프리셋 URL → openai", () => {
    expect(detectProviderKind("https://api.groq.com/openai/v1")).toBe(
      "openai",
    );
  });

  it("커스텀 Anthropic 호스트네임 → anthropic", () => {
    expect(detectProviderKind("https://api.anthropic.com/v2")).toBe(
      "anthropic",
    );
  });

  it("커스텀 기타 URL → openai (fallback)", () => {
    expect(
      detectProviderKind("https://my-custom-llm.example.com/v1"),
    ).toBe("openai");
  });
});

describe("getProviderLabel", () => {
  it("프리셋 URL → 해당 라벨", () => {
    expect(getProviderLabel("https://api.openai.com/v1")).toBe("OpenAI");
    expect(getProviderLabel("https://api.anthropic.com/v1")).toBe("Anthropic");
    expect(
      getProviderLabel(
        "https://generativelanguage.googleapis.com/v1beta/openai",
      ),
    ).toBe("Gemini");
  });

  it("커스텀 URL → Custom", () => {
    expect(getProviderLabel("https://my-llm.example.com/v1")).toBe("Custom");
  });
});

describe("parseRetryAfterMs", () => {
  it("null/empty → null", () => {
    expect(parseRetryAfterMs(null)).toBe(null);
    expect(parseRetryAfterMs("")).toBe(null);
  });

  it("초 단위 숫자 → ms", () => {
    expect(parseRetryAfterMs("3")).toBe(3000);
    expect(parseRetryAfterMs("0")).toBe(0);
  });

  it("HTTP-date → 현재로부터 남은 ms", () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const ms = parseRetryAfterMs(future);
    expect(ms).not.toBeNull();
    expect(ms!).toBeGreaterThan(3000);
    expect(ms!).toBeLessThanOrEqual(5000);
  });

  it("과거 시각 → 0", () => {
    const past = new Date(Date.now() - 10_000).toUTCString();
    expect(parseRetryAfterMs(past)).toBe(0);
  });

  it("파싱 불가 문자열 → null", () => {
    expect(parseRetryAfterMs("not-a-date")).toBe(null);
  });
});

describe("fetchWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function mockFetchSequence(responses: Array<Partial<Response>>) {
    const fn = vi.fn();
    for (const res of responses) {
      fn.mockResolvedValueOnce({
        status: 200,
        headers: { get: () => null },
        ...res,
      });
    }
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  it("재시도 status가 아니면 즉시 반환 (재시도 없음)", async () => {
    const fetchFn = mockFetchSequence([{ status: 200 }]);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await fetchWithRetry("http://x", {}, [503]);

    expect(res.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("503 → 503 → 200: 2회 재시도 후 성공", async () => {
    const fetchFn = mockFetchSequence([
      { status: 503 },
      { status: 503 },
      { status: 200 },
    ]);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const promise = fetchWithRetry("http://x", {}, [503]);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    const res = await promise;

    expect(res.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("재시도 한도 초과: 마지막 실패 응답 반환", async () => {
    const fetchFn = mockFetchSequence([
      { status: 503 },
      { status: 503 },
      { status: 503 },
    ]);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const promise = fetchWithRetry("http://x", {}, [503]);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    const res = await promise;

    expect(res.status).toBe(503);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("재시도 대상 외 status는 그대로 반환 (429는 즉시)", async () => {
    const fetchFn = mockFetchSequence([{ status: 429 }]);

    const res = await fetchWithRetry("http://x", {}, [503]);

    expect(res.status).toBe(429);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("Retry-After 헤더가 있으면 그 값을 사용", async () => {
    const headerStub = { get: (k: string) => (k === "retry-after" ? "5" : null) };
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ status: 503, headers: headerStub })
      .mockResolvedValueOnce({ status: 200, headers: { get: () => null } });
    vi.stubGlobal("fetch", fetchFn);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const promise = fetchWithRetry("http://x", {}, [503]);
    // 기본 1000ms로는 부족, 5000ms 진행해야 다음 fetch가 호출됨
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4000);
    const res = await promise;

    expect(res.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe("createOpenAICompatibleProvider 재시도 통합", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("503 응답을 재시도 끝까지 받으면 LlmOverloadedError throw", async () => {
    const fail = {
      status: 503,
      headers: { get: () => null },
      text: () => Promise.resolve(""),
    };
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(fail)
      .mockResolvedValueOnce(fail)
      .mockResolvedValueOnce(fail);
    vi.stubGlobal("fetch", fetchFn);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: "k",
      modelId: "gemini-2.5-flash",
    });

    const promise = provider.generate({ prompt: "hi" });
    // Vitest는 unhandled rejection을 catch하므로 에러 핸들러 부착
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);

    await expect(promise).rejects.toBeInstanceOf(LlmOverloadedError);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("503 두 번 후 200이면 정상 응답", async () => {
    const ok = {
      status: 200,
      ok: true,
      headers: { get: () => null },
      json: () =>
        Promise.resolve({ choices: [{ message: { content: "yay" } }] }),
    };
    const fail = {
      status: 503,
      headers: { get: () => null },
      text: () => Promise.resolve(""),
    };
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(fail)
      .mockResolvedValueOnce(fail)
      .mockResolvedValueOnce(ok);
    vi.stubGlobal("fetch", fetchFn);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: "k",
      modelId: "gemini-2.5-flash",
    });

    const promise = provider.generate({ prompt: "hi" });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);

    await expect(promise).resolves.toBe("yay");
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});

describe("max_tokens 정책 (양쪽 경로 통일)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("OpenAI 경로 요청 body에 max_tokens 4096 포함", async () => {
    const fn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: () => Promise.resolve({ choices: [{ message: { content: "x" } }] }),
    });
    vi.stubGlobal("fetch", fn);

    const provider = createOpenAICompatibleProvider({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "k",
      modelId: "gpt-4o",
    });
    await provider.generate({ prompt: "hi" });

    const body = JSON.parse(fn.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(4096);
  });

  it("Anthropic 경로 요청 body에 max_tokens 4096 포함", async () => {
    const fn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ content: [{ text: "x" }] }),
    });
    vi.stubGlobal("fetch", fn);

    const provider = createAnthropicProvider({
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "k",
      modelId: "claude-sonnet-4-6",
    });
    await provider.generate({ prompt: "hi" });

    const body = JSON.parse(fn.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(4096);
  });
});

describe("createAnthropicProvider 헤더", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetchOk() {
    const fn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ content: [{ text: "ok" }] }),
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  it("apiKey가 빈 문자열이면 x-api-key 헤더를 포함하지 않음", async () => {
    const mockFetch = mockFetchOk();

    const provider = createAnthropicProvider({
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "",
      modelId: "claude-sonnet-4-6",
    });
    await provider.generate({ prompt: "hello" });

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers).not.toHaveProperty("x-api-key");
  });

  it("apiKey가 있으면 x-api-key 헤더를 전송함", async () => {
    const mockFetch = mockFetchOk();

    const provider = createAnthropicProvider({
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "sk-ant-test",
      modelId: "claude-sonnet-4-6",
    });
    await provider.generate({ prompt: "hello" });

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
  });
});

describe("ProviderCapabilities", () => {
  it("Chrome 빌트인 AI → compact / 이미지 불가 / 절삭 예산 10,000자", () => {
    const caps = createChromeAIProvider().capabilities;
    expect(caps).toEqual({
      promptStyle: "compact",
      supportsImages: false,
      contextBudgetChars: 10_000,
    });
  });

  it("OpenAI 호환 → rich / 이미지 가능 / 예산 무제한", () => {
    const caps = createOpenAICompatibleProvider({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "k",
      modelId: "gpt-4o",
    }).capabilities;
    expect(caps).toEqual({
      promptStyle: "rich",
      supportsImages: true,
      contextBudgetChars: Number.MAX_SAFE_INTEGER,
    });
  });

  it("Anthropic → rich / 이미지 가능 / 예산 무제한", () => {
    const caps = createAnthropicProvider({
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "k",
      modelId: "claude-sonnet-4-6",
    }).capabilities;
    expect(caps.promptStyle).toBe("rich");
    expect(caps.supportsImages).toBe(true);
  });

  it("예산이 Infinity가 아니다 (직렬화 안전)", () => {
    expect(Number.isFinite(BYOK_CAPABILITIES.contextBudgetChars)).toBe(true);
    expect(Number.isFinite(NANO_CAPABILITIES.contextBudgetChars)).toBe(true);
    expect(Number.isFinite(LOCAL_BYOK_CAPABILITIES.contextBudgetChars)).toBe(true);
  });
});

// 로컬 엔드포인트는 소형 모델(Ollama 3B 등)을 돌리는 게 기본이라 나노와 같은 제약을 갖는다.
// rich 본문 + 스크린샷 + 절삭 없음을 그대로 밀면 3단 가드가 통째로 우회된다.
describe("byokCapabilities — 로컬 엔드포인트", () => {
  it.each([
    "http://localhost:11434/v1",
    "http://127.0.0.1:1234/v1",
    "http://[::1]:8080/v1",
  ])("%s → compact / 이미지 불가 / 유한 예산", (baseUrl) => {
    expect(byokCapabilities(baseUrl)).toEqual(LOCAL_BYOK_CAPABILITIES);
    expect(LOCAL_BYOK_CAPABILITIES.promptStyle).toBe("compact");
    expect(LOCAL_BYOK_CAPABILITIES.supportsImages).toBe(false);
  });

  it.each([
    "https://api.openai.com/v1",
    "https://openrouter.ai/api/v1",
    "https://llm.internal.example.com/v1",
  ])("%s → 원격은 rich 유지", (baseUrl) => {
    expect(byokCapabilities(baseUrl)).toEqual(BYOK_CAPABILITIES);
  });

  it("Ollama 프리셋이 로컬로 판정된다", () => {
    const ollama = PROVIDER_PRESETS.find((p) => p.id === "ollama")!;
    expect(byokCapabilities(ollama.baseUrl)).toEqual(LOCAL_BYOK_CAPABILITIES);
  });

  it("잘못된 URL → 원격으로 간주(보수적 판정 아님, 기존 동작 유지)", () => {
    expect(byokCapabilities("not a url")).toEqual(BYOK_CAPABILITIES);
  });

  it("프로바이더 팩토리가 baseUrl별 능력을 반영", () => {
    const local = createOpenAICompatibleProvider({
      baseUrl: "http://localhost:11434/v1",
      apiKey: "",
      modelId: "llama3.2",
    });
    expect(local.capabilities.promptStyle).toBe("compact");
    expect(local.capabilities.supportsImages).toBe(false);
  });
});

function stubLanguageModel(sessionOverrides: Record<string, unknown> = {}) {
  const nativeSession = {
    prompt: vi.fn().mockResolvedValue("{}"),
    destroy: vi.fn(),
    ...sessionOverrides,
  };
  const create = vi.fn().mockResolvedValue(nativeSession);
  vi.stubGlobal("LanguageModel", { create, availability: vi.fn() });
  return { create, nativeSession };
}

describe("createChromeAIProvider — createSession", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("initialPrompts로 세션 생성 — system이 index 0", async () => {
    const { create } = stubLanguageModel();

    await createChromeAIProvider().createSession("SYS");

    const opts = create.mock.calls[0][0];
    expect(opts.initialPrompts[0]).toEqual({ role: "system", content: "SYS" });
  });

  it("CHROME_AI_LANG_OPTIONS를 함께 전달", async () => {
    const { create } = stubLanguageModel();

    await createChromeAIProvider().createSession("SYS");

    const opts = create.mock.calls[0][0];
    expect(opts.outputLanguage).toBe(CHROME_AI_LANG_OPTIONS.outputLanguage);
    expect(opts.expectedOutputs).toEqual(CHROME_AI_LANG_OPTIONS.expectedOutputs);
  });

  it("few-shot이 system 뒤에 user/assistant 쌍으로 이어짐", async () => {
    const { create } = stubLanguageModel();

    await createChromeAIProvider().createSession("SYS", [
      { user: "배경을 파랗게", assistant: '{"explanation":"x"}' },
    ]);

    expect(create.mock.calls[0][0].initialPrompts).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "배경을 파랗게" },
      { role: "assistant", content: '{"explanation":"x"}' },
    ]);
  });

  it("destroy가 네이티브 세션을 destroy", async () => {
    const { nativeSession } = stubLanguageModel();

    const session = await createChromeAIProvider().createSession("SYS");
    session.destroy();

    expect(nativeSession.destroy).toHaveBeenCalled();
  });

  it("LanguageModel 부재 시 throw", async () => {
    vi.stubGlobal("LanguageModel", undefined);
    await expect(
      createChromeAIProvider().createSession("SYS"),
    ).rejects.toThrow();
  });
});

describe("createChromeAIProvider — 컨텍스트 실측 표면", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("신명칭(contextUsage/contextWindow/measureContextUsage)을 노출", async () => {
    stubLanguageModel({
      contextUsage: 120,
      contextWindow: 4096,
      measureContextUsage: vi.fn().mockResolvedValue(7),
    });

    const session = await createChromeAIProvider().createSession("SYS");

    expect(session.contextUsage).toBe(120);
    expect(session.contextWindow).toBe(4096);
    await expect(session.measureContextUsage!("hi")).resolves.toBe(7);
  });

  it("구명칭만 있는 네이티브 → 폴백으로 노출", async () => {
    stubLanguageModel({
      inputUsage: 30,
      inputQuota: 1024,
      measureInputUsage: vi.fn().mockResolvedValue(5),
    });

    const session = await createChromeAIProvider().createSession("SYS");

    expect(session.contextUsage).toBe(30);
    expect(session.contextWindow).toBe(1024);
    await expect(session.measureContextUsage!("hi")).resolves.toBe(5);
  });

  it("둘 다 없으면 undefined (구버전 Chrome)", async () => {
    stubLanguageModel();

    const session = await createChromeAIProvider().createSession("SYS");

    expect(session.contextUsage).toBeUndefined();
    expect(session.contextWindow).toBeUndefined();
    expect(session.measureContextUsage).toBeUndefined();
  });
});

describe("BYOK createSession — few-shot 선주입", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("system → few-shot 쌍 → 실제 대화 순으로 messages 구성", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const session = await createOpenAICompatibleProvider({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "k",
      modelId: "gpt-4o",
    }).createSession("SYS", [{ user: "U1", assistant: "A1" }]);

    await session.prompt("실제 요청");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.messages).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "U1" },
      { role: "assistant", content: "A1" },
      { role: "user", content: "실제 요청" },
    ]);
  });
});

describe("mapQuotaError", () => {
  it("QuotaExceededError → AiContextOverflowError", () => {
    const err = new DOMException("too big", "QuotaExceededError");
    expect(() => mapQuotaError(err)).toThrow(AiContextOverflowError);
  });

  it("name이 QuotaExceededError인 일반 에러도 매핑", () => {
    const err = Object.assign(new Error("x"), { name: "QuotaExceededError" });
    expect(() => mapQuotaError(err)).toThrow(AiContextOverflowError);
  });

  it("다른 에러는 원본 그대로 재던짐", () => {
    const err = new Error("network down");
    expect(() => mapQuotaError(err)).toThrow(err);
  });

  it("LlmQuotaError(429)는 컨텍스트 초과가 아니므로 그대로 재던짐", () => {
    const err = new LlmQuotaError();
    expect(() => mapQuotaError(err)).toThrow(LlmQuotaError);
  });
});
