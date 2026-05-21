import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  createAnthropicProvider,
  createOpenAICompatibleProvider,
  detectProviderKind,
  fetchWithRetry,
  getProviderLabel,
  LlmOverloadedError,
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
