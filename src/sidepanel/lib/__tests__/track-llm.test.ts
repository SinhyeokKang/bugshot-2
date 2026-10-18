import { afterEach, describe, expect, it, vi } from "vitest";
import { LLM_PROVIDER_IDS } from "@/lib/llm-provider-ids";
import { filterProperties } from "@/background/analytics";
import { sendBg } from "@/lib/bg-client";
import { presetIdOf, PROVIDER_PRESETS } from "@/sidepanel/lib/ai-provider";
import { llmConnectProperties, trackLlmConnect } from "@/sidepanel/lib/track-llm";

vi.mock("@/lib/bg-client", () => ({ sendBg: vi.fn().mockResolvedValue({}) }));
afterEach(() => vi.clearAllMocks());

describe("LLM connection analytics", () => {
  it("keeps the preset and shared enum sets in sync", () => {
    expect(PROVIDER_PRESETS.map((p) => p.id).sort()).toEqual([...LLM_PROVIDER_IDS].sort());
  });
  it.each(PROVIDER_PRESETS)("maps $id by exact URL", ({ id, baseUrl }) => {
    expect(presetIdOf(baseUrl)).toBe(id);
    expect(presetIdOf(`${baseUrl}/`)).toBe("custom");
  });
  it.each(["http://localhost:1234/v1", "https://vllm.internal/v1"])("redacts custom URL %s", (baseUrl) => {
    expect(llmConnectProperties(baseUrl, "byok", "failed")).toEqual({ provider: "custom", path: "byok", result: "failed" });
  });
  it("round-trips every provider, path, and result through the receiver", () => {
    for (const baseUrl of [...PROVIDER_PRESETS.map((p) => p.baseUrl), "https://internal.example/v1"]) {
      for (const path of ["free", "byok"] as const) {
        for (const result of ["success", "cancelled", "failed"] as const) {
          const props = llmConnectProperties(baseUrl, path, result);
          expect(filterProperties("llm_connect", props)).toEqual(props);
        }
      }
    }
  });
  it("omits provider when no selection was made", () => {
    expect(llmConnectProperties("", "free", "cancelled")).toEqual({ path: "free", result: "cancelled" });
  });
  it("sends one capture message without credentials or URLs", () => {
    trackLlmConnect("https://internal.example/v1", "byok", "success");
    expect(sendBg).toHaveBeenCalledTimes(1);
    expect(sendBg).toHaveBeenCalledWith({
      type: "analytics.capture", event: "llm_connect",
      properties: { provider: "custom", path: "byok", result: "success" },
    });
  });
  it("does not propagate telemetry transport failure", async () => {
    vi.mocked(sendBg).mockRejectedValueOnce(new Error("offline"));
    expect(trackLlmConnect("", "free", "cancelled")).toBeUndefined();
    await Promise.resolve();
  });
});
