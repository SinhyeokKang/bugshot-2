import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useEditorStore } from "@/store/editor-store";
import { useSettingsUiStore } from "@/store/settings-ui-store";
import { useSettingsStore } from "@/store/settings-store";
import {
  buildAiDraftSessionPrompt,
  buildAiDraftSchema,
  parseAiDraftResponse,
} from "@/sidepanel/lib/buildAiDraftPrompt";
import { buildNetworkLogSummary, buildConsoleLogSummary } from "@/sidepanel/lib/buildLogSummary";
import { LlmQuotaError, LlmOverloadedError, type AISession, type AIProvider } from "@/sidepanel/lib/ai-provider";
import { defaultTitle } from "./DraftingPanel";

export function AiDraftDialog({
  open,
  onOpenChange,
  createSession,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  createSession: AIProvider["createSession"];
}) {
  const t = useT();
  const [input, setInput] = useState("");
  const sessionRef = useRef<AISession | null>(null);
  const isFirstMessageRef = useRef(true);
  const createSessionRef = useRef(createSession);
  createSessionRef.current = createSession;

  useEffect(() => {
    return () => {
      sessionRef.current?.destroy?.();
      sessionRef.current = null;
    };
  }, [createSession]);

  const handleSubmit = useCallback(async () => {
    const msg = input.trim();
    if (!msg) return;

    setInput("");
    onOpenChange(false);
    useEditorStore.getState().setAiDraftLoading(true);

    try {
      const store = useEditorStore.getState();
      const settingsUi = useSettingsUiStore.getState();
      const { titlePrefix } = useSettingsStore.getState();
      const captureMode = store.captureMode as "screenshot" | "video" | "freeform";
      const enabledSections = settingsUi.issueSections
        .filter((s) => s.enabled)
        .map((s) => ({ id: s.id }));
      const sectionIds = enabledSections.map((s) => s.id);

      if (!sessionRef.current) {
        const networkLog = store.networkLog;
        const consoleLog = store.consoleLog;
        const includeLogCtx = captureMode === "video" || captureMode === "freeform";
        const systemPrompt = buildAiDraftSessionPrompt({
          captureMode,
          locale: settingsUi.locale,
          url: store.target?.url ?? "",
          pageTitle: store.target?.title ?? "",
          networkLogSummary:
            includeLogCtx && networkLog && networkLog.captured > 0
              ? buildNetworkLogSummary(networkLog)
              : undefined,
          consoleLogSummary:
            includeLogCtx && consoleLog && consoleLog.captured > 0
              ? buildConsoleLogSummary(consoleLog)
              : undefined,
          enabledSections,
        });
        sessionRef.current = await createSessionRef.current(systemPrompt);
        isFirstMessageRef.current = true;
      }

      const responseSchema = buildAiDraftSchema(sectionIds);
      const images: string[] | undefined =
        captureMode === "screenshot" && isFirstMessageRef.current
          ? getScreenshotImages(store)
          : undefined;

      isFirstMessageRef.current = false;

      const raw = await sessionRef.current.prompt(msg, {
        responseSchema,
        images,
      });

      const parsed = parseAiDraftResponse(raw, sectionIds);
      if (parsed) {
        const prefix = defaultTitle(titlePrefix);
        const aiTitle = prefix ? prefix + parsed.title : parsed.title;
        const prevDraft = useEditorStore.getState().draft;
        useEditorStore.getState().setDraft({
          ...parsed,
          title: aiTitle,
          environment: prevDraft?.environment ?? [],
        });
      } else {
        console.warn("[bugshot] AI draft parse failed. Raw response:", raw);
        toast.error(t("draft.aiParseError"));
      }
    } catch (err) {
      console.error("[AI Draft] error:", err);
      if (err instanceof LlmQuotaError) {
        toast.error(t("llm.error.quota"));
      } else if (err instanceof LlmOverloadedError) {
        toast.error(t("llm.error.overloaded"));
      } else {
        toast.error(t("draft.aiError"));
      }
      sessionRef.current?.destroy?.();
      sessionRef.current = null;
    } finally {
      useEditorStore.getState().setAiDraftLoading(false);
    }
  }, [input, onOpenChange, t]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[80vw] max-w-[80vw] gap-5 rounded-3xl p-6 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{t("aiDraft.title")}</DialogTitle>
        </DialogHeader>

        <div>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("aiDraft.placeholder")}
            rows={3}
            className="min-h-32 resize-none text-sm [field-sizing:content]"
            autoFocus
          />
          <p className="mt-1.5 text-center text-xs text-muted-foreground/60">
            {t("aiDraft.disclaimer")}
          </p>
        </div>

        <DialogFooter className="!flex-row items-center !justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!input.trim()}>
            {t("aiDraft.generate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function getScreenshotImages(
  store: ReturnType<typeof useEditorStore.getState>,
): string[] | undefined {
  const img = store.screenshotAnnotated ?? store.screenshotRaw;
  return img ? [img] : undefined;
}
