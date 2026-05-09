import { useCallback, useRef, useState } from "react";
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
import type { LanguageModelInstance } from "../../hooks/useChromeAI";

export function AiStylingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const tabId = useBoundTabId();
  const [input, setInput] = useState("");
  const sessionRef = useRef<LanguageModelInstance | null>(null);

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

    console.log("[AI Styling] prompt:", msg);

    try {
      if (!globalThis.LanguageModel) throw new Error("Chrome AI unavailable");

      if (!sessionRef.current) {
        const ctx = buildContext();
        if (!ctx) throw new Error("No element selected");
        sessionRef.current = await globalThis.LanguageModel.create({
          systemPrompt: buildAiStylingSystemPrompt(ctx),
          expectedOutputLanguages: ["en"],
        });
      }

      const raw = await sessionRef.current.prompt(msg, {
        responseConstraint: buildAiStylingResponseSchema(),
      });

      console.log("[AI Styling] raw response:", raw);

      const parsed = parseAiStylingResponse(raw);
      if (!parsed) {
        console.warn("[AI Styling] parse failed");
        toast.error(t("aiStyling.error"));
        return;
      }

      const hasEdits = parsed.edits.inlineStyle || parsed.edits.classList;
      if (!hasEdits) {
        console.log("[AI Styling] empty edits");
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

      console.log("[AI Styling] applied edits:", parsed.edits);

      if (tabId) {
        if (parsed.edits.inlineStyle)
          void applyStyles(tabId, merged.inlineStyle);
        if (parsed.edits.classList)
          void applyClasses(tabId, merged.classList);
      }
    } catch (err) {
      console.error("[AI Styling] error:", err);
      toast.error(t("aiStyling.error"));
      sessionRef.current?.destroy?.();
      sessionRef.current = null;
    } finally {
      useEditorStore.getState().setAiStylingLoading(false);
    }
  }, [input, tabId, buildContext, onOpenChange]);

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
