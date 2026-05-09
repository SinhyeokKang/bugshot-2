import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import {
  SiAnthropic,
  SiGooglegemini,
  SiOllama,
  SiOpenrouter,
} from "@icons-pack/react-simple-icons";
import { useT } from "@/i18n";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  pingAnthropic,
  PROVIDER_PRESETS,
  requestHostPermission,
  type ModelEntry,
} from "../../lib/ai-provider";

function OpenAIIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.14-.08 4.778-2.758a.795.795 0 0 0 .393-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855L13.104 8.364l2.015-1.164a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zM8.306 12.863l-2.02-1.164a.08.08 0 0 1-.038-.057V6.074a4.5 4.5 0 0 1 7.376-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.098-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    </svg>
  );
}

function GroqIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 201 201" fill="currentColor" {...props}>
      <path d="m128 49 1.895 1.52C136.336 56.288 140.602 64.49 142 73c.097 1.823.148 3.648.161 5.474l.03 3.247.012 3.482.017 3.613c.01 2.522.016 5.044.02 7.565.01 3.84.041 7.68.072 11.521.007 2.455.012 4.91.016 7.364l.038 3.457c-.033 11.717-3.373 21.83-11.475 30.547-4.552 4.23-9.148 7.372-14.891 9.73l-2.387 1.055c-9.275 3.355-20.3 2.397-29.379-1.13-5.016-2.38-9.156-5.17-13.234-8.925 3.678-4.526 7.41-8.394 12-12l3.063 2.375c5.572 3.958 11.135 5.211 17.937 4.625 6.96-1.384 12.455-4.502 17-10 4.174-6.784 4.59-12.222 4.531-20.094l.012-3.473c.003-2.414-.005-4.827-.022-7.241-.02-3.68 0-7.36.026-11.04-.003-2.353-.008-4.705-.016-7.058l.025-3.312c-.098-7.996-1.732-13.21-6.681-19.47-6.786-5.458-13.105-8.211-21.914-7.792-7.327 1.188-13.278 4.7-17.777 10.601C75.472 72.012 73.86 78.07 75 85c2.191 7.547 5.019 13.948 12 18 5.848 3.061 10.892 3.523 17.438 3.688l2.794.103c2.256.082 4.512.147 6.768.209v16c-16.682.673-29.615.654-42.852-10.848-8.28-8.296-13.338-19.55-13.71-31.277.394-9.87 3.93-17.894 9.562-25.875l1.688-2.563C84.698 35.563 110.05 34.436 128 49Z" />
    </svg>
  );
}

function TogetherIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path d="M23.197 4.503A6 6 0 0015 2.307a5.973 5.973 0 00-2.995 4.933l5.996.008v.515h-5.996c.039.937.298 1.87.8 2.74a6 6 0 1010.39-6z" fill="#EF2CC1" />
      <path d="M.805 4.5A6 6 0 003 12.697a5.972 5.972 0 005.77.127L5.779 7.627l.446-.257 2.997 5.192A6 6 0 10.804 4.5z" fill="#CAAEF5" />
      <path d="M12 23.894a6 6 0 005.999-6c0-2.13-1.1-3.996-2.775-5.06l-3.005 5.189-.444-.258 2.997-5.192A6 6 0 1012 23.894z" fill="#FC4C02" />
    </svg>
  );
}

const PROVIDER_ICONS: Record<
  string,
  { icon: ComponentType<{ className?: string }>; darkInvert?: boolean }
> = {
  openai: { icon: OpenAIIcon, darkInvert: true },
  anthropic: {
    icon: (props) => <SiAnthropic color="default" {...props} />,
  },
  gemini: {
    icon: (props) => <SiGooglegemini color="default" {...props} />,
  },
  groq: { icon: GroqIcon, darkInvert: true },
  together: { icon: TogetherIcon },
  openrouter: {
    icon: (props) => <SiOpenrouter color="default" {...props} />,
  },
  ollama: { icon: (props) => <SiOllama color="default" {...props} /> },
};

export function LlmConnectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const setLlm = useSettingsUiStore((s) => s.setLlm);
  const [baseUrl, setBaseUrl] = useState("");
  const [search, setSearch] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [pendingModels, setPendingModels] = useState<{
    models: ModelEntry[];
    baseUrl: string;
    apiKey: string;
  } | null>(null);

  const selectedPreset = PROVIDER_PRESETS.find((p) => p.baseUrl === baseUrl);
  const displayLabel = selectedPreset?.label
    ?? (baseUrl || t("llm.provider"));

  const showCustomItem = search.trim().length > 0
    && !PROVIDER_PRESETS.some((p) => p.label.toLowerCase() === search.trim().toLowerCase());

  const canConnect = !!baseUrl && !connecting;

  function selectPreset(preset: (typeof PROVIDER_PRESETS)[number]) {
    setBaseUrl(preset.baseUrl);
    setSearch("");
    setPopoverOpen(false);
  }

  function selectCustom() {
    setBaseUrl(search.trim());
    setSearch("");
    setPopoverOpen(false);
  }

  async function handleConnect() {
    setError(null);
    setConnecting(true);
    try {
      const granted = await requestHostPermission(baseUrl);
      if (!granted) {
        setError(t("llm.error.permission"));
        return;
      }

      const kind = detectProviderKind(baseUrl);
      let models: ModelEntry[];
      if (kind === "anthropic") {
        await pingAnthropic(baseUrl, apiKey);
        models = ANTHROPIC_MODELS;
      } else {
        const geminiPreset = PROVIDER_PRESETS.find((p) => p.id === "gemini");
        const isGemini = geminiPreset && baseUrl === geminiPreset.baseUrl;
        if (isGemini) {
          await fetchModels(baseUrl, apiKey);
          models = GEMINI_MODELS;
        } else {
          models = await fetchModels(baseUrl, apiKey);
        }
      }

      setPendingModels({ models, baseUrl, apiKey });
    } catch {
      setError(t("llm.error.fetch"));
    } finally {
      setConnecting(false);
    }
  }

  function handleModelSelect(modelId: string) {
    if (!pendingModels) return;
    setLlm({
      baseUrl: pendingModels.baseUrl,
      apiKey: pendingModels.apiKey,
      modelId,
    });
    setPendingModels(null);
    setApiKey("");
    setBaseUrl("");
    onOpenChange(false);
  }

  return (
    <>
    <LlmModelDialog
      pending={pendingModels}
      onSelect={handleModelSelect}
      onClose={() => setPendingModels(null)}
    />
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[80vw] max-w-[80vw] gap-5 rounded-3xl p-6 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{t("llm.dialog.title")}</DialogTitle>
          <DialogDescription>{t("llm.dialog.body")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">
              {t("llm.provider")}
            </label>
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={popoverOpen}
                  className="w-full justify-between font-normal"
                >
                  {displayLabel}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[calc(80vw-48px)] p-0" align="start">
                <Command>
                  <CommandInput
                    placeholder={t("llm.baseUrlPlaceholder")}
                    value={search}
                    onValueChange={setSearch}
                  />
                  <CommandList>
                    <CommandEmpty />
                    <CommandGroup>
                      {PROVIDER_PRESETS.map((p) => {
                        const entry = PROVIDER_ICONS[p.id];
                        return (
                          <CommandItem
                            key={p.id}
                            value={p.label}
                            onSelect={() => selectPreset(p)}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                baseUrl === p.baseUrl ? "opacity-100" : "opacity-0",
                              )}
                            />
                            {entry && (
                              <entry.icon
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  entry.darkInvert && "dark:invert",
                                )}
                              />
                            )}
                            {p.label}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                    {showCustomItem && (
                      <CommandGroup heading={t("llm.providerCustom")}>
                        <CommandItem value={`__custom__${search}`} onSelect={selectCustom}>
                          <span className="text-sm">{search.trim()}</span>
                        </CommandItem>
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">
              {t("llm.apiKey")}
            </label>
            <Input
              type="password"
              placeholder={t("llm.apiKeyPlaceholder")}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {error ? (
            <Alert variant="destructive" className="text-xs">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter className="flex-row justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
          <Button onClick={handleConnect} disabled={!canConnect} className="relative">
            {connecting && (
              <span className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
              </span>
            )}
            <span className={connecting ? "opacity-0" : undefined}>
              {t("platform.connect")}
            </span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

function LlmModelDialog({
  pending,
  onSelect,
  onClose,
}: {
  pending: { models: ModelEntry[]; baseUrl: string; apiKey: string } | null;
  onSelect: (modelId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(false);

  useEffect(() => {
    if (pending) {
      setModels(pending.models);
      setSelectedModelId("");
    }
  }, [pending]);

  return (
    <Dialog open={!!pending} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="w-[80vw] max-w-[80vw] gap-5 rounded-3xl p-6 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{t("llm.model.select")}</DialogTitle>
        </DialogHeader>

        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={popoverOpen}
              className="w-full justify-between font-normal"
            >
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-left",
                  !selectedModelId && "text-muted-foreground",
                )}
              >
                {selectedModelId || t("llm.model.placeholder")}
              </span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[var(--radix-popover-trigger-width)] p-0"
            onWheel={(e) => e.stopPropagation()}
          >
            <Command>
              <CommandInput placeholder={t("llm.model.search")} />
              <CommandList>
                <CommandEmpty>{t("llm.model.empty")}</CommandEmpty>
                <CommandGroup>
                  {models.map((m) => (
                    <CommandItem
                      key={m.id}
                      value={m.id}
                      onSelect={() => {
                        setSelectedModelId(m.id);
                        setPopoverOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          selectedModelId === m.id ? "opacity-100" : "opacity-0",
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

        <DialogFooter className="flex-row justify-end">
          <Button variant="outline" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button
            disabled={!selectedModelId}
            onClick={() => onSelect(selectedModelId)}
          >
            {t("common.ok")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
