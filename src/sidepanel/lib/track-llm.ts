import { sendBg } from "@/lib/bg-client";
import type { LlmProviderId } from "@/lib/llm-provider-ids";
import { presetIdOf } from "@/sidepanel/lib/ai-provider";

export type LlmConnectPath = "free" | "byok";
export type LlmConnectResult = "success" | "cancelled" | "failed";

export function llmConnectProperties(
  baseUrl: string,
  path: LlmConnectPath,
  result: LlmConnectResult,
): { provider?: LlmProviderId | "custom"; path: LlmConnectPath; result: LlmConnectResult } {
  return { ...(baseUrl ? { provider: presetIdOf(baseUrl) } : {}), path, result };
}

export function trackLlmConnect(
  baseUrl: string,
  path: LlmConnectPath,
  result: LlmConnectResult,
): void {
  sendBg({
    type: "analytics.capture",
    event: "llm_connect",
    properties: llmConnectProperties(baseUrl, path, result),
  }).catch(() => {});
}
