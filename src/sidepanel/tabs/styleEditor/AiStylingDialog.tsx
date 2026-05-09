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
import { useBoundTabId } from "../../hooks/useBoundTabId";
import {
  applyStyles,
  applyClasses,
} from "../../picker-control";
import {
  buildAiStylingSystemPrompt,
  buildAiStylingResponseSchema,
  parseAiStylingResponse,
  type AiStylingContext,
} from "../../lib/buildAiStylingPrompt";
import { mergeAiEdits, replaceRawWithTokens } from "../../lib/aiStylingPostProcess";
import { LlmQuotaError, type AISession, type AIProvider } from "../../lib/ai-provider";

export function AiStylingDialog({
  open,
  onOpenChange,
  createSession,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  createSession: AIProvider["createSession"];
}) {
  const t = useT();
  const tabId = useBoundTabId();
  const [input, setInput] = useState("");
  const sessionRef = useRef<AISession | null>(null);

  useEffect(() => {
    return () => {
      sessionRef.current?.destroy?.();
      sessionRef.current = null;
    };
  }, []);

  const buildContext = useCallback((): AiStylingContext | null => {
    const s = useEditorStore.getState();
    if (!s.selection) return null;
    return {
      tagName: s.selection.tagName,
      selector: s.selection.selector,
      classList: s.styleEdits.classList,
      specifiedStyles: { ...s.selection.specifiedStyles, ...s.styleEdits.inlineStyle },
      tokens: s.tokens,
    };
  }, []);

  const handleSubmit = useCallback(async () => {
    const msg = input.trim();
    if (!msg) return;

    const store = useEditorStore.getState();
    if (!store.aiStylingSnapshot) {
      store.setAiStylingSnapshot({
        classList: [...store.styleEdits.classList],
        inlineStyle: { ...store.styleEdits.inlineStyle },
        text: store.styleEdits.text,
      });
    }

    setInput("");
    onOpenChange(false);
    store.setAiStylingLoading(true);

    try {
      if (!sessionRef.current) {
        const ctx = buildContext();
        if (!ctx) throw new Error("No element selected");
        sessionRef.current = await createSession(
          buildAiStylingSystemPrompt(ctx),
        );
      }

      const raw = await sessionRef.current.prompt(msg, {
        responseSchema: buildAiStylingResponseSchema(),
      });

      const parsed = parseAiStylingResponse(raw);
      if (!parsed) {
        console.warn("[AI Styling] parse failed");
        toast.error(t("aiStyling.error"));
        return;
      }

      const hasEdits = parsed.edits.inlineStyle || parsed.edits.classList;
      if (!hasEdits) {
        toast(t("aiStyling.noChanges"));
        return;
      }

      if (parsed.edits.inlineStyle) {
        const s = useEditorStore.getState();
        parsed.edits.inlineStyle = replaceRawWithTokens(
          parsed.edits.inlineStyle,
          s.tokens,
          s.selection?.specifiedStyles ?? {},
        );
      }

      const currentEdits = useEditorStore.getState().styleEdits;
      const merged = mergeAiEdits(currentEdits, parsed.edits);
      useEditorStore.getState().setStyleEdits(merged);

      if (tabId) {
        if (parsed.edits.inlineStyle)
          void applyStyles(tabId, merged.inlineStyle);
        if (parsed.edits.classList)
          void applyClasses(tabId, merged.classList);
      }
    } catch (err) {
      console.error("[AI Styling] error:", err);
      if (err instanceof LlmQuotaError) {
        toast.error(t("llm.error.quota"));
      } else {
        toast.error(t("aiStyling.error"));
      }
      sessionRef.current?.destroy?.();
      sessionRef.current = null;
    } finally {
      useEditorStore.getState().setAiStylingLoading(false);
    }
  }, [input, tabId, buildContext, onOpenChange, createSession, t]);

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
          <DialogTitle className="text-xl">{t("aiStyling.title")}</DialogTitle>
        </DialogHeader>

        <div>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("aiStyling.placeholder")}
            rows={3}
            className="min-h-32 resize-none text-sm [field-sizing:content]"
            autoFocus
          />
          <p className="mt-1.5 text-center text-xs text-muted-foreground/60">
            {t("aiStyling.disclaimer")}
          </p>
        </div>

        <DialogFooter className="!flex-row items-center !justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!input.trim()}>
            {t("aiStyling.generate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
