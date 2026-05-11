import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createAnthropicProvider,
  detectProviderKind,
  getProviderLabel,
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
