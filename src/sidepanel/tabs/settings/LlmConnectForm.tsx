import { useCallback, useEffect, useState } from "react";
import {
  Bot,
  Check,
  ChevronsUpDown,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { useT } from "@/i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ConnectedBadge } from "@/sidepanel/components/ConnectedBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettingsUiStore } from "@/store/settings-ui-store";
import { cn } from "@/lib/utils";
import { useAI } from "@/sidepanel/hooks/useAI";
import {
  AI_LANGUAGE_OPTIONS,
  aiLanguageLabel,
  resolveAiLanguage,
  type AiLanguage,
} from "@/sidepanel/lib/aiLanguage";
import {
  ANTHROPIC_MODELS,
  detectProviderKind,
  fetchModels,
  GEMINI_MODELS,
  GEMINI_FREE_MODELS,
  getProviderLabel,
  PROVIDER_PRESETS,
  type ModelEntry,
} from "@/sidepanel/lib/ai-provider";
import { PageScroll, PageShell, Section } from "@/sidepanel/components/Section";
import { fetchOpenRouterFreeVisionModels, OPENROUTER_BASE_URL } from "@/sidepanel/lib/free-llm";
import { FreeLlmConnectDialog } from "./FreeLlmConnectDialog";
import { LlmConnectDialog } from "./LlmConnectDialog";
import { SettingsFooter } from "./SettingsFooter";

export function LlmConnectForm({ active = true }: { active?: boolean }) {
  const llm = useSettingsUiStore((s) => s.llm);

  if (!llm) return <LlmOnboarding active={active} />;
  return <LlmConnected />;
}

function LlmOnboarding({ active }: { active: boolean }) {
  const { chromeAI, refreshChromeAI, prepareChromeAI } = useAI();
  useEffect(() => {
    if (active) void refreshChromeAI();
  }, [active, refreshChromeAI]);
  const t = useT();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [freeDialogOpen, setFreeDialogOpen] = useState(false);

  return (
    <>
      <PageShell>
      <PageScroll>
      <div className="flex flex-col items-center px-4 py-5 text-center">
        <div className="mb-3 rounded-full bg-muted p-3">
          <Bot className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">{t("llm.onboarding.title")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("llm.onboarding.body")}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button variant="outline" data-testid="llm-connect-free" onClick={() => setFreeDialogOpen(true)}>
            {t("llm.free.button")}
          </Button>
          <Button data-testid="llm-connect-byok" onClick={() => setDialogOpen(true)}>
            {t("llm.connect")}
          </Button>
        </div>
      </div>
      <Section title={t("ai.chrome.title")}>
        <Card>
          <CardContent className="space-y-3 p-4" data-testid="chrome-ai-readiness">
            <p role="status" className="text-sm" data-testid="chrome-ai-status">
              {chromeAI.unsupportedLanguage ? t("ai.chrome.unsupportedLanguage")
                : chromeAI.error ? t("ai.chrome.error")
                : t(`ai.chrome.${chromeAI.availability}`)}
            </p>
            {chromeAI.availability === "downloading" && (
              <div role="progressbar" aria-label={t("ai.chrome.downloading")}
                aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={chromeAI.progress === null ? undefined : Math.round(chromeAI.progress * 100)}
                className="h-2 overflow-hidden rounded-full bg-muted">
                <div className={cn("h-full bg-primary", chromeAI.progress === null && "w-1/3 animate-pulse motion-reduce:animate-none")}
                  style={chromeAI.progress === null ? undefined : { width: `${chromeAI.progress * 100}%` }} />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {!chromeAI.unsupportedLanguage && (chromeAI.availability === "downloadable" || chromeAI.availability === "downloading") && (
                <Button data-testid="chrome-ai-prepare" onClick={() => { void prepareChromeAI(); }}>
                  {t("ai.chrome.prepare")}
                </Button>
              )}
              <Button variant="outline" data-testid="chrome-ai-refresh" onClick={() => { void refreshChromeAI(); }} disabled={chromeAI.availability === "checking"}>
                {t("ai.chrome.refresh")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </Section>
      </PageScroll>
      </PageShell>
      <FreeLlmConnectDialog open={freeDialogOpen} onOpenChange={setFreeDialogOpen} />
      <LlmConnectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}

// 노출 조건은 "LLM 연결됨"이 아니라 rich 프롬프트다 — 로컬 엔드포인트는 연결돼 있어도
// compact으로 강등돼(LOCAL_BYOK_CAPABILITIES) 이 설정이 프롬프트에 반영되지 않는다.
function AiLanguageSection() {
  const t = useT();
  const { capabilities } = useAI();
  const locale = useSettingsUiStore((s) => s.locale);
  const aiLanguage = useSettingsUiStore((s) => s.aiLanguage);
  const setAiLanguage = useSettingsUiStore((s) => s.setAiLanguage);

  if (capabilities.promptStyle !== "rich") return null;

  // auto는 저장값이 아니라 지금 로케일로 해석해 보여준다 — 화면 언어를 바꾸면 같이 따라간다.
  const autoLabel = t("llm.outputLanguage.auto", {
    lang: aiLanguageLabel(resolveAiLanguage("auto", locale)),
  });

  return (
    <Section title={t("llm.section.outputLanguage")}>
      <div className="space-y-2">
        <Select
          value={aiLanguage}
          onValueChange={(v) => setAiLanguage(v as AiLanguage)}
        >
          <SelectTrigger className="w-full" aria-label={t("llm.section.outputLanguage")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{autoLabel}</SelectItem>
            {AI_LANGUAGE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          {t("llm.outputLanguage.help")}
        </p>
      </div>
    </Section>
  );
}

function LlmConnected() {
  const t = useT();
  const llm = useSettingsUiStore((s) => s.llm)!;
  const setLlm = useSettingsUiStore((s) => s.setLlm);
  const providerLabel = getProviderLabel(llm.baseUrl);
  const kind = detectProviderKind(llm.baseUrl);

  let hostname: string;
  try {
    hostname = new URL(llm.baseUrl).hostname;
  } catch {
    hostname = llm.baseUrl;
  }

  const geminiPreset = PROVIDER_PRESETS.find((p) => p.id === "gemini");
  const isGemini = geminiPreset && llm.baseUrl === geminiPreset.baseUrl;

  const hardcodedModels: readonly ModelEntry[] | null =
    kind === "anthropic"
      ? ANTHROPIC_MODELS
      : isGemini
        ? (llm.freeTier ? GEMINI_FREE_MODELS : GEMINI_MODELS)
        : null;

  const [fetchedModels, setFetchedModels] = useState<ModelEntry[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false);

  const models = hardcodedModels ?? fetchedModels;

  const loadModels = useCallback(async () => {
    if (hardcodedModels) return;
    setModelsLoading(true);
    try {
      const list = llm.freeTier && llm.baseUrl === OPENROUTER_BASE_URL
        ? await fetchOpenRouterFreeVisionModels(llm.apiKey)
        : await fetchModels(llm.baseUrl, llm.apiKey);
      setFetchedModels(list);
    } catch {
      setFetchedModels([]);
    } finally {
      setModelsLoading(false);
    }
  }, [llm.baseUrl, llm.apiKey, llm.freeTier, hardcodedModels]);

  useEffect(() => {
    if (!hardcodedModels) {
      void loadModels();
    }
  }, [hardcodedModels, loadModels]);

  const selectModel = (modelId: string) => {
    setLlm({ ...llm, modelId });
    setModelPopoverOpen(false);
  };

  return (
    <PageShell>
      <PageScroll>
        <Section
          title={t("llm.section.connection")}
          action={
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 shrink-0 hover:text-destructive"
                  title={t("llm.disconnect")}
                  aria-label={t("llm.disconnect")}
                >
                  <Unplug />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("llm.disconnectConfirm.title")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("llm.disconnectConfirm.body")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("common.close")}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => setLlm(null)}>
                    {t("platform.disconnect.confirm")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          }
        >
          <Card>
            <CardContent data-testid="llm-connected" className="flex items-center justify-between px-4 py-3">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-base font-medium text-foreground">
                  {hostname}
                </span>
                <span className="truncate text-sm text-muted-foreground">
                  {providerLabel}
                </span>
              </div>
              <ConnectedBadge>{t("llm.connected")}</ConnectedBadge>
            </CardContent>
          </Card>
        </Section>

        <Section
          title={t("llm.section.model")}
          action={
            !hardcodedModels ? (
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8 shrink-0 aria-disabled:cursor-not-allowed"
                onClick={() => { if (modelsLoading) return; void loadModels(); }}
                aria-disabled={modelsLoading}
                title={t("llm.model.refresh")}
                aria-label={t("llm.model.refresh")}
              >
                <RefreshCw className={cn("h-4 w-4", modelsLoading && "animate-spin")} />
              </Button>
            ) : undefined
          }
        >
          <Popover open={modelPopoverOpen} onOpenChange={setModelPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={modelPopoverOpen}
                className="w-full min-w-0 justify-between font-normal"
              >
                {llm.modelId || t("llm.model.placeholder")}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[calc(100vw-64px)] p-0" align="start">
              <Command>
                <CommandInput placeholder={t("llm.model.search")} />
                <CommandList>
                  <CommandEmpty>{t("llm.model.empty")}</CommandEmpty>
                  <CommandGroup>
                    {models.map((m) => (
                      <CommandItem
                        key={m.id}
                        value={m.id}
                        onSelect={() => selectModel(m.id)}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            llm.modelId === m.id ? "opacity-100" : "opacity-0",
                          )}
                        />
                        {m.id}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </Section>

        <AiLanguageSection />
      </PageScroll>

      <SettingsFooter />
    </PageShell>
  );
}
