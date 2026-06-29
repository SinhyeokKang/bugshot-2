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
import { useBoundTabId } from "@/sidepanel/hooks/useBoundTabId";
import {
  applyStyles,
  applyClasses,
} from "@/sidepanel/picker-control";
import {
  buildAiStylingSystemPrompt,
  buildAiStylingResponseSchema,
  parseAiStylingResponse,
  buildStyleContextBlock,
  type AiStylingContext,
} from "@/sidepanel/lib/buildAiStylingPrompt";
import { mergeAiEdits, replaceRawWithTokens } from "@/sidepanel/lib/aiStylingPostProcess";
import { LlmQuotaError, LlmOverloadedError, type AISession, type AIProvider } from "@/sidepanel/lib/ai-provider";

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
  // 세션이 어느 요소(selector)용으로 빌드됐는지 — repick 시 stale system prompt 재빌드 판정.
  const sessionSelectorRef = useRef<string | null>(null);
  const createSessionRef = useRef(createSession);
  createSessionRef.current = createSession;

  useEffect(() => {
    return () => {
      sessionRef.current?.destroy?.();
      sessionRef.current = null;
      sessionSelectorRef.current = null;
    };
  }, [createSession]);

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

    // 컨텍스트 확정을 입력 비우기/닫기보다 먼저 — 요소 미선택이면 입력을 잃지 않고 안내만.
    const ctx = buildContext();
    if (!ctx) {
      toast.error(t("aiStyling.error"));
      return;
    }
    const targetSelector = ctx.selector;

    setInput("");
    onOpenChange(false);
    useEditorStore.getState().setAiStylingLoading(true);

    try {
      // repick으로 세션이 다른 요소용이면 stale system prompt 폐기 후 재빌드.
      if (
        sessionRef.current &&
        sessionSelectorRef.current !== targetSelector
      ) {
        sessionRef.current.destroy?.();
        sessionRef.current = null;
      }
      if (!sessionRef.current) {
        sessionRef.current = await createSessionRef.current(
          buildAiStylingSystemPrompt(ctx),
        );
        sessionSelectorRef.current = targetSelector;
      }

      const prefix = buildStyleContextBlock(ctx);
      const raw = await sessionRef.current.prompt(
        prefix ? `${prefix}\n\n${msg}` : msg,
        { responseSchema: buildAiStylingResponseSchema() },
      );

      // 호출 중 다른 요소로 repick됐으면 옛 요소용 결과를 새 요소에 적용하지 않는다.
      if (
        useEditorStore.getState().selection?.selector !== targetSelector
      ) {
        return;
      }

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
        parsed.edits.inlineStyle = replaceRawWithTokens(
          parsed.edits.inlineStyle,
          ctx.tokens,
          ctx.specifiedStyles,
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
      } else if (err instanceof LlmOverloadedError) {
        toast.error(t("llm.error.overloaded"));
      } else {
        toast.error(t("aiStyling.error"));
      }
      sessionRef.current?.destroy?.();
      sessionRef.current = null;
      sessionSelectorRef.current = null;
    } finally {
      useEditorStore.getState().setAiStylingLoading(false);
    }
  }, [input, tabId, buildContext, onOpenChange, t]);

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
            data-testid="ai-styling-input"
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
          <Button data-testid="ai-styling-submit" onClick={() => void handleSubmit()} disabled={!input.trim()}>
            {t("aiStyling.generate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
