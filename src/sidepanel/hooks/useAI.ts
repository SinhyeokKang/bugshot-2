import { useEffect, useMemo, useState } from "react";
import { useSettingsUiStore } from "@/store/settings-ui-store";
import {
  CHROME_AI_LANG_OPTIONS,
  createAnthropicProvider,
  createChromeAIProvider,
  createOpenAICompatibleProvider,
  detectProviderKind,
  getProviderLabel,
  type AIProvider,
} from "@/sidepanel/lib/ai-provider";

type AIStatus = "checking" | "available" | "unavailable";

export function useAI(): {
  status: AIStatus;
  providerLabel: string | null;
  generate: AIProvider["generate"];
  createSession: AIProvider["createSession"];
} {
  const llm = useSettingsUiStore((s) => s.llm);
  const [chromeAIStatus, setChromeAIStatus] = useState<AIStatus>("checking");

  useEffect(() => {
    if (llm?.modelId) return;
    let cancelled = false;
    (async () => {
      try {
        if (!globalThis.LanguageModel) {
          setChromeAIStatus("unavailable");
          return;
        }
        const availability = await globalThis.LanguageModel.availability(
          CHROME_AI_LANG_OPTIONS,
        );
        if (!cancelled) {
          setChromeAIStatus(
            availability === "available" || availability === "readily"
              ? "available"
              : "unavailable",
          );
        }
      } catch {
        if (!cancelled) setChromeAIStatus("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [llm?.modelId]);

  const provider = useMemo<AIProvider>(() => {
    if (llm?.modelId) {
      const kind = detectProviderKind(llm.baseUrl);
      return kind === "anthropic"
        ? createAnthropicProvider(llm)
        : createOpenAICompatibleProvider(llm);
    }
    return createChromeAIProvider();
  }, [llm]);

  const status: AIStatus = llm?.modelId ? "available" : chromeAIStatus;
  const providerLabel = llm?.modelId ? getProviderLabel(llm.baseUrl) : null;

  return {
    status,
    providerLabel,
    generate: provider.generate,
    createSession: provider.createSession,
  };
}
