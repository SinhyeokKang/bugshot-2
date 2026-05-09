import { useCallback, useEffect, useState } from "react";
import {
  Bot,
  Check,
  ChevronsUpDown,
  CircleCheck,
  RefreshCw,
  TriangleAlert,
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
import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useSettingsUiStore } from "@/store/settings-ui-store";
import { cn } from "@/lib/utils";
import {
  ANTHROPIC_MODELS,
  detectProviderKind,
  fetchModels,
  GEMINI_MODELS,
  getProviderLabel,
  PROVIDER_PRESETS,
  type ModelEntry,
} from "../../lib/ai-provider";
import { PageFooter, PageScroll, PageShell, Section } from "../../components/Section";
import { LlmConnectDialog } from "./LlmConnectDialog";

export function LlmConnectForm() {
  const llm = useSettingsUiStore((s) => s.llm);

  if (!llm) return <LlmOnboarding />;
  return <LlmConnected />;
}

function LlmOnboarding() {
  const t = useT();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center">
        <div className="mb-3 rounded-full bg-muted p-3">
          <Bot className="h-6 w-6" />
        </div>
        <h3 className="text-[18px] font-semibold">{t("llm.onboarding.title")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("llm.onboarding.body")}
        </p>
        <div className="mt-5">
          <Button onClick={() => setDialogOpen(true)}>
            {t("llm.connect")}
          </Button>
        </div>
      </div>
      <LlmConnectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}

function LlmConnected() {
  const t = useT();
  const llm = useSettingsUiStore((s) => s.llm)!;
  const setLlm = useSettingsUiStore((s) => s.setLlm);
  const providerLabel = getProviderLabel(llm.baseUrl);
  const kind = detectProviderKind(llm.baseUrl);

  const [reenterKey, setReenterKey] = useState("");
  const needsApiKey = !llm.apiKey;

  let hostname: string;
  try {
    hostname = new URL(llm.baseUrl).hostname;
  } catch {
    hostname = llm.baseUrl;
  }

  const geminiPreset = PROVIDER_PRESETS.find((p) => p.id === "gemini");
  const isGemini = geminiPreset && llm.baseUrl === geminiPreset.baseUrl;

  const hardcodedModels: ModelEntry[] | null =
    kind === "anthropic"
      ? ANTHROPIC_MODELS
      : isGemini
        ? GEMINI_MODELS
        : null;

  const [fetchedModels, setFetchedModels] = useState<ModelEntry[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false);

  const models = hardcodedModels ?? fetchedModels;

  const loadModels = useCallback(async () => {
    if (hardcodedModels) return;
    setModelsLoading(true);
    try {
      const list = await fetchModels(llm.baseUrl, llm.apiKey);
      setFetchedModels(list);
    } catch {
      setFetchedModels([]);
    } finally {
      setModelsLoading(false);
    }
  }, [llm.baseUrl, llm.apiKey, hardcodedModels]);

  useEffect(() => {
    if (!hardcodedModels && fetchedModels.length === 0) {
      void loadModels();
    }
  }, [hardcodedModels, loadModels, fetchedModels.length]);

  const selectModel = (modelId: string) => {
    setLlm({ ...llm, modelId });
    setModelPopoverOpen(false);
  };

  return (
    <PageShell>
      <PageScroll>
        <Section title={t("llm.section.connection")}>
          <Card>
            <CardContent className="flex items-center justify-between px-4 py-3">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-base font-medium text-foreground">
                  {hostname}
                </span>
                <span className="truncate text-sm text-muted-foreground">
                  {providerLabel}
                </span>
              </div>
              {needsApiKey ? (
                <Badge className="shrink-0 gap-1 border-transparent bg-amber-50 text-[11px] tracking-wider text-amber-700 shadow-none dark:bg-amber-900/40 dark:text-amber-400">
                  <TriangleAlert className="h-3 w-3" />
                  {t("llm.apiKey")}
                </Badge>
              ) : (
                <Badge className="shrink-0 gap-1 border-transparent bg-green-50 text-[11px] tracking-wider text-green-700 shadow-none dark:bg-green-900/40 dark:text-green-400">
                  <CircleCheck className="h-3 w-3" />
                  {t("llm.connected")}
                </Badge>
              )}
            </CardContent>
          </Card>
          {needsApiKey && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {t("llm.apiKey.expired")}
              </p>
              <div className="flex items-center gap-1">
                <Input
                  type="password"
                  placeholder={t("llm.apiKeyPlaceholder")}
                  value={reenterKey}
                  onChange={(e) => setReenterKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && reenterKey.trim()) {
                      setLlm({ ...llm, apiKey: reenterKey.trim() });
                      setReenterKey("");
                    }
                  }}
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button
                  size="sm"
                  className="h-9 shrink-0"
                  disabled={!reenterKey.trim()}
                  onClick={() => {
                    setLlm({ ...llm, apiKey: reenterKey.trim() });
                    setReenterKey("");
                  }}
                >
                  {t("llm.apiKey.save")}
                </Button>
              </div>
            </div>
          )}
        </Section>

        <Section
          title={t("llm.section.model")}
          action={
            !hardcodedModels ? (
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8 shrink-0"
                onClick={() => void loadModels()}
                disabled={modelsLoading}
                title={t("llm.model.refresh")}
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
                className="w-full justify-between font-normal"
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
      </PageScroll>

      <PageFooter>
        <div className="flex items-center justify-end">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline">{t("llm.disconnect")}</Button>
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
        </div>
      </PageFooter>
    </PageShell>
  );
}
