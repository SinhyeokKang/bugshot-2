import { useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
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
  detectProviderKind,
  fetchModels,
  pingAnthropic,
  PROVIDER_PRESETS,
  requestHostPermission,
} from "../../lib/ai-provider";

const CUSTOM_ID = "__custom__";

export function LlmConnectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const setLlm = useSettingsUiStore((s) => s.setLlm);
  const [selectedId, setSelectedId] = useState("openai");
  const [customUrl, setCustomUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const isCustom = selectedId === CUSTOM_ID;
  const preset = PROVIDER_PRESETS.find((p) => p.id === selectedId);
  const baseUrl = isCustom ? customUrl.trim() : (preset?.baseUrl ?? "");
  const displayLabel = isCustom
    ? t("llm.providerCustom")
    : (preset?.label ?? "");

  const canConnect = !!baseUrl && !connecting;

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
      if (kind === "anthropic") {
        await pingAnthropic(baseUrl, apiKey);
      } else {
        await fetchModels(baseUrl, apiKey);
      }

      setLlm({ baseUrl, apiKey, modelId: "" });
      setApiKey("");
      setCustomUrl("");
      setSelectedId("openai");
      onOpenChange(false);
    } catch {
      setError(t("llm.error.fetch"));
    } finally {
      setConnecting(false);
    }
  }

  return (
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
                  <CommandInput placeholder={t("llm.provider")} />
                  <CommandList>
                    <CommandEmpty />
                    <CommandGroup>
                      {PROVIDER_PRESETS.map((p) => (
                        <CommandItem
                          key={p.id}
                          value={p.id}
                          onSelect={() => {
                            setSelectedId(p.id);
                            setPopoverOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              selectedId === p.id ? "opacity-100" : "opacity-0",
                            )}
                          />
                          {p.label}
                        </CommandItem>
                      ))}
                      <CommandItem
                        value={CUSTOM_ID}
                        onSelect={() => {
                          setSelectedId(CUSTOM_ID);
                          setPopoverOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            isCustom ? "opacity-100" : "opacity-0",
                          )}
                        />
                        {t("llm.providerCustom")}
                      </CommandItem>
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {isCustom && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground">
                {t("llm.baseUrl")}
              </label>
              <Input
                placeholder={t("llm.baseUrlPlaceholder")}
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          )}

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
            {t("common.cancel")}
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
  );
}
