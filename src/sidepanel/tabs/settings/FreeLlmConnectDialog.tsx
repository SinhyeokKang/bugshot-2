import { useEffect, useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import type { TranslationKey } from "@/i18n/ko";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FieldRow } from "@/sidepanel/components/FieldRow";
import { connectErrorKey, connectProvider, GEMINI_FREE_MODELS, type ModelEntry } from "@/sidepanel/lib/ai-provider";
import { AI_STUDIO_KEY_URL, FREE_LLM_PRESETS, fetchOpenRouterFreeVisionModels, OPENROUTER_BASE_URL, probeOpenRouterModel, type FreeLlmPresetId } from "@/sidepanel/lib/free-llm";
import { trackLlmConnect, type LlmConnectResult } from "@/sidepanel/lib/track-llm";
import { launchOpenRouterAuth } from "@/sidepanel/openrouter-auth";
import { useSettingsUiStore } from "@/store/settings-ui-store";
import { cn } from "@/lib/utils";
import { LlmModelDialog, PROVIDER_ICONS } from "./LlmConnectDialog";

export function FreeLlmConnectDialog({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const t = useT();
  const id = useId();
  const setLlm = useSettingsUiStore((s) => s.setLlm);
  const [step, setStep] = useState<"pick" | "geminiKey">("pick");
  const [selected, setSelected] = useState<FreeLlmPresetId | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingModels, setPendingModels] = useState<{
    models: ModelEntry[]; baseUrl: string; apiKey: string;
  } | null>(null);
  const issuedKeyRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const attemptRef = useRef(0);
  const sessionRef = useRef({ active: false, baseUrl: "", hadError: false });
  const selectedCardRef = useRef<HTMLButtonElement | null>(null);
  const focusCardRef = useRef(false);

  function finishSession(result?: LlmConnectResult) {
    const session = sessionRef.current;
    if (!session.active) return;
    session.active = false;
    ++attemptRef.current;
    issuedKeyRef.current = null;
    busyRef.current = false;
    trackLlmConnect(session.baseUrl, "free", result ?? (session.hadError ? "failed" : "cancelled"));
    setBusy(false);
    setPendingModels(null);
    focusCardRef.current = false;
  }

  useEffect(() => {
    if (open) {
      sessionRef.current = { active: true, baseUrl: "", hadError: false };
      setStep("pick");
      setSelected(null);
      setApiKey("");
    } else finishSession();
    return () => { ++attemptRef.current; issuedKeyRef.current = null; };
  }, [open]);

  useEffect(() => {
    if (step === "pick" && focusCardRef.current) {
      selectedCardRef.current?.focus();
      focusCardRef.current = false;
    }
  }, [step]);

  function handleOpenChange(value: boolean) {
    if (!value) finishSession();
    onOpenChange(value);
  }

  function showError(key: TranslationKey) {
    sessionRef.current.hadError = true;
    toast.error(t(key));
  }

  function openKeyPage() {
    void chrome.windows.create({ url: AI_STUDIO_KEY_URL, type: "popup", width: 520, height: 760 }).catch(() => {});
  }

  async function handleNext() {
    if (!selected || busyRef.current) return;
    if (selected === "gemini") {
      openKeyPage();
      setStep("geminiKey");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    const attempt = ++attemptRef.current;
    try {
      const result = issuedKeyRef.current
        ? { status: "ok" as const, key: issuedKeyRef.current }
        : await launchOpenRouterAuth();
      if (attempt !== attemptRef.current || result.status === "cancelled") return;
      issuedKeyRef.current = result.key;
      const models = await fetchOpenRouterFreeVisionModels(result.key);
      if (attempt !== attemptRef.current) return;
      if (!models.length) {
        showError("llm.free.error.noFreeVisionModel");
        return;
      }
      setPendingModels({ models, baseUrl: OPENROUTER_BASE_URL, apiKey: result.key });
    } catch {
      if (attempt === attemptRef.current) showError("llm.free.error.openrouter");
    } finally {
      if (attempt === attemptRef.current) { busyRef.current = false; setBusy(false); }
    }
  }

  async function handleGeminiConnect() {
    if (!apiKey.trim() || busyRef.current) return;
    const baseUrl = FREE_LLM_PRESETS.find((p) => p.id === "gemini")!.baseUrl;
    busyRef.current = true;
    setBusy(true);
    const attempt = ++attemptRef.current;
    try {
      const result = await connectProvider(baseUrl, apiKey);
      if (attempt !== attemptRef.current) return;
      setPendingModels({ models: [...GEMINI_FREE_MODELS], baseUrl, apiKey: result.apiKey });
    } catch (err) {
      if (attempt === attemptRef.current) showError(connectErrorKey(err));
    } finally {
      if (attempt === attemptRef.current) { busyRef.current = false; setBusy(false); }
    }
  }

  async function handleModelSelect(modelId: string) {
    if (!pendingModels || busyRef.current) return;
    const pending = pendingModels;
    busyRef.current = true;
    setBusy(true);
    const attempt = ++attemptRef.current;
    try {
      if (pending.baseUrl === OPENROUTER_BASE_URL) {
        const result = await probeOpenRouterModel(pending.apiKey, modelId);
        if (attempt !== attemptRef.current) return;
        if (result === "unavailable") {
          showError("llm.free.error.modelUnavailable");
          return;
        }
      }
      sessionRef.current.baseUrl = pending.baseUrl;
      finishSession("success");
      setLlm({ baseUrl: pending.baseUrl, apiKey: pending.apiKey, modelId, freeTier: true });
      onOpenChange(false);
    } finally {
      if (attempt === attemptRef.current) { busyRef.current = false; setBusy(false); }
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          data-testid="free-llm-dialog"
          className="flex max-h-[80vh] w-[90vw] max-w-[800px] flex-col gap-5 rounded-3xl p-6 sm:rounded-3xl"
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-xl">{t("llm.free.dialog.title")}</DialogTitle>
            <DialogDescription>
              {t(step === "pick" ? "llm.free.dialog.body" : "llm.free.gemini.keyTitle")}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {step === "pick" ? (
              <ToggleGroup
                type="single" role="radiogroup" aria-label={t("llm.provider")}
                value={selected ?? ""} variant="outline"
                className="flex-col gap-3 p-1"
                onValueChange={(value) => {
                  if (busyRef.current) return;
                  const preset = FREE_LLM_PRESETS.find((p) => p.id === value);
                  if (!preset) return;
                  setSelected(preset.id);
                  sessionRef.current.baseUrl = preset.baseUrl;
                }}
              >
                {FREE_LLM_PRESETS.map((preset) => {
                  const brand = PROVIDER_ICONS[preset.id];
                  return (
                  <ToggleGroupItem
                    key={preset.id} value={preset.id}
                    ref={selected === preset.id ? selectedCardRef : undefined}
                    data-testid={`free-llm-card-${preset.id}`}
                    aria-labelledby={`${id}-${preset.id}-title`}
                    aria-describedby={`${id}-${preset.id}-description`}
                    aria-disabled={busy}
                    className="h-auto w-full flex-row items-start justify-start gap-3 whitespace-normal [&_svg]:size-6 rounded-xl p-4 text-left font-normal text-foreground hover:bg-background hover:border-primary/50 data-[state=on]:border-primary data-[state=on]:bg-background data-[state=on]:ring-1 data-[state=on]:ring-primary aria-disabled:cursor-not-allowed"
                  >
                    <span
                      aria-hidden="true"
                      data-testid={`free-llm-icon-${preset.id}`}
                      className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-muted"
                    >
                      {brand && <brand.icon className={cn("h-6 w-6", brand.darkInvert && "dark:invert")} />}
                    </span>
                    <span className="flex min-w-0 flex-col gap-1">
                      <span id={`${id}-${preset.id}-title`} className="text-sm font-medium">{t(`llm.free.${preset.id}.title`)}</span>
                      <span id={`${id}-${preset.id}-description`} className="flex flex-col gap-1 text-sm text-foreground/80">
                        <span>{t(`llm.free.${preset.id}.summary`)}</span>
                        <span>{t(`llm.free.${preset.id}.privacy`)}</span>
                      </span>
                    </span>
                  </ToggleGroupItem>
                  );
                })}
              </ToggleGroup>
            ) : (
              <div className="flex flex-col gap-3">
                <FieldRow label={t("llm.apiKey")} htmlFor={`${id}-key`}>
                  <Input id={`${id}-key`} data-testid="free-llm-gemini-key" type="password" autoFocus
                    placeholder={t("llm.free.gemini.keyPlaceholder")} value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
                  <p className="text-sm text-muted-foreground">{t("llm.free.gemini.keyHelp")}</p>
                </FieldRow>
                <Button variant="outline" data-testid="free-llm-reopen" className="h-auto min-h-9 whitespace-normal" onClick={openKeyPage}>
                  {t("llm.free.gemini.reopen")}
                </Button>
              </div>
            )}
          </div>
          <p role="status" className="shrink-0 text-sm text-muted-foreground">
            {busy && selected === "openrouter" && !pendingModels && !issuedKeyRef.current ? t("llm.free.openrouter.waiting") : ""}
          </p>
          <DialogFooter className="shrink-0 flex-row flex-wrap justify-end">
            {step === "geminiKey" && <Button variant="outline" data-testid="free-llm-back" onClick={() => {
              ++attemptRef.current;
              busyRef.current = false;
              setBusy(false);
              setApiKey("");
              focusCardRef.current = true;
              setStep("pick");
            }}>{t("llm.free.back")}</Button>}
            <Button
              data-testid={step === "pick" ? "free-llm-next" : "free-llm-gemini-connect"}
              disabled={step === "pick" ? !selected : !apiKey.trim()}
              aria-disabled={busy}
              className="aria-disabled:cursor-not-allowed aria-disabled:hover:bg-primary"
              onClick={() => { if (step === "pick") void handleNext(); else void handleGeminiConnect(); }}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t(step === "pick" ? "llm.free.next" : "platform.connect")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <LlmModelDialog busy={busy} pending={pendingModels} onSelect={(modelId) => { void handleModelSelect(modelId); }} onClose={() => {
        ++attemptRef.current;
        busyRef.current = false;
        setBusy(false);
        setPendingModels(null);
      }} />
    </>
  );
}
