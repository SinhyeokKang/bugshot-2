import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useSettingsUiStore } from "@/store/settings-ui-store";
import {
  createAnthropicProvider,
  createChromeAIProvider,
  createOpenAICompatibleProvider,
  detectProviderKind,
  getProviderLabel,
  type AIProvider,
  type ProviderCapabilities,
} from "@/sidepanel/lib/ai-provider";

import { getChromeAIController, setChromeAIContext, type ChromeAIState } from "@/sidepanel/lib/chrome-ai";

type AIStatus = "checking" | "available" | "unavailable";

export function useAI(): {
  status: AIStatus;
  chromeAI: ChromeAIState;
  refreshChromeAI: () => Promise<ChromeAIState>;
  prepareChromeAI: () => Promise<void>;
  providerLabel: string | null;
  capabilities: ProviderCapabilities;
  generate: AIProvider["generate"];
  createSession: AIProvider["createSession"];
} {
  const llm = useSettingsUiStore((s) => s.llm);
  const locale = useSettingsUiStore((s) => s.locale);
  const controller = useMemo(() => getChromeAIController(locale), [locale]);
  const chromeAI = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  useEffect(() => {
    setChromeAIContext(locale, !!llm?.modelId);
    if (!llm?.modelId) void controller.refresh();
  }, [locale, llm?.modelId, controller]);

  const provider = useMemo<AIProvider>(() => {
    if (llm?.modelId) {
      const kind = detectProviderKind(llm.baseUrl);
      return kind === "anthropic"
        ? createAnthropicProvider(llm)
        : createOpenAICompatibleProvider(llm);
    }
    return createChromeAIProvider(locale);
  }, [llm, locale]);

  const status: AIStatus = llm?.modelId ? "available" : chromeAI.availability === "available" ? "available" : chromeAI.availability === "checking" ? "checking" : "unavailable";
  const providerLabel = llm?.modelId ? getProviderLabel(llm.baseUrl) : null;

  return {
    status,
    chromeAI,
    refreshChromeAI: controller.refresh,
    prepareChromeAI: controller.prepare,
    providerLabel,
    capabilities: provider.capabilities,
    generate: provider.generate,
    createSession: provider.createSession,
  };
}
