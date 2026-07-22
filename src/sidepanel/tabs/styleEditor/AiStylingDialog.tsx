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
  getStylingFewShot,
  stylesSentInPrompt,
  type AiStylingContext,
} from "@/sidepanel/lib/buildAiStylingPrompt";
import { buildClassDeltaLine, buildStyleDeltaBlock } from "@/sidepanel/lib/prompts/context";
import { mergeAiEdits, replaceRawWithTokens } from "@/sidepanel/lib/aiStylingPostProcess";
import {
  AiContextOverflowError,
  mapQuotaError,
  type AISession,
  type AIProvider,
  type ProviderCapabilities,
} from "@/sidepanel/lib/ai-provider";
import { toastLlmError } from "@/sidepanel/lib/llmErrorToast";
import { isPromptOverBudget } from "@/sidepanel/lib/prompts/promptBudget";

export function AiStylingDialog({
  open,
  onOpenChange,
  createSession,
  capabilities,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  createSession: AIProvider["createSession"];
  capabilities: ProviderCapabilities;
}) {
  const t = useT();
  const tabId = useBoundTabId();
  const [input, setInput] = useState("");
  const sessionRef = useRef<AISession | null>(null);
  // 세션이 어느 요소(selector+frameId)용으로 빌드됐는지 — repick 시 stale system prompt 재빌드 판정.
  const sessionKeyRef = useRef<string | null>(null);
  // 멀티턴 delta의 기준선 = 직전에 모델이 실제로 본 스타일 맵. 세션 생성 직후 한 곳에서만
  // 초기화한다 — 파괴 경로가 3개(repick·에러 catch·provider 변경 cleanup)라 파괴 지점마다
  // 리셋을 흩뿌리면 누락된다.
  const lastSentStylesRef = useRef<Record<string, string>>({});
  const lastSentClassesRef = useRef<string[]>([]);
  const createSessionRef = useRef(createSession);
  createSessionRef.current = createSession;

  useEffect(() => {
    return () => {
      sessionRef.current?.destroy?.();
      sessionRef.current = null;
      sessionKeyRef.current = null;
    };
  }, [createSession]);

  const buildContext = useCallback((): AiStylingContext | null => {
    const s = useEditorStore.getState();
    if (!s.selection) return null;
    return {
      caps: capabilities,
      tagName: s.selection.tagName,
      selector: s.selection.selector,
      classList: s.styleEdits.classList,
      specifiedStyles: { ...s.selection.specifiedStyles, ...s.styleEdits.inlineStyle },
      editedProps: Object.keys(s.styleEdits.inlineStyle),
      computedStyles: s.selection.computedStyles,
      viewport: s.selection.viewport,
      tokens: s.tokens,
    };
  }, [capabilities]);

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
    const targetFrameId = useEditorStore.getState().selection?.frameId ?? 0;
    const targetKey = `${targetSelector}::${targetFrameId}`;

    setInput("");
    onOpenChange(false);
    useEditorStore.getState().setAiStylingLoading(true);

    // 소프트 취소: 오버레이 '중단'이 부르면 결과를 폐기하고 로딩을 내린다(진행 중 호출은 못 끊는다).
    const run = { cancelled: false };
    useEditorStore.getState().setAiCancel(() => {
      run.cancelled = true;
      sessionRef.current?.destroy?.();
      sessionRef.current = null;
      sessionKeyRef.current = null;
      useEditorStore.getState().setAiStylingLoading(false);
    });

    try {
      // repick으로 세션이 다른 요소용이면 stale system prompt 폐기 후 재빌드.
      if (sessionRef.current && sessionKeyRef.current !== targetKey) {
        sessionRef.current.destroy?.();
        sessionRef.current = null;
      }
      if (!sessionRef.current) {
        sessionRef.current = await createSessionRef.current(
          buildAiStylingSystemPrompt(ctx),
          getStylingFewShot(ctx),
        );
        sessionKeyRef.current = targetKey;
        // 기준선은 원본 specifiedStyles 전체가 아니라 캡 적용 후 실제로 실린 맵이어야 한다.
        // 어긋나면 모델이 못 본 prop을 delta가 "변경 없음"으로 판단해 영영 안 보낸다.
        lastSentStylesRef.current = stylesSentInPrompt(ctx);
        lastSentClassesRef.current = ctx.classList;
      }

      // 스타일링은 1차 게이트(문자 예산 절삭)를 쓰지 않는다 — 모든 컨텍스트가 PROMPT_CAPS로
      // 이미 유한하다. 새 능력 좌표(예: {compact, budget:8000})를 추가하면 여기에도
      // caps.contextBudgetChars 기반 절삭을 배선해야 한다.
      //
      // 시스템 프롬프트에 요소 상태가 이미 있다. 매 턴 전량 재주입하지 않고 변경분만 보낸다.
      const currentSent = stylesSentInPrompt(ctx);
      const styleDelta = buildStyleDeltaBlock(
        lastSentStylesRef.current,
        currentSent,
        ctx.specifiedStyles,
      );
      const classDelta = buildClassDeltaLine(
        lastSentClassesRef.current,
        ctx.classList,
      );
      const delta = [styleDelta, classDelta].filter(Boolean).join("\n");
      const responseSchema = buildAiStylingResponseSchema();
      const turnInput = delta ? `${delta}\n\n${msg}` : msg;

      if (await isPromptOverBudget(sessionRef.current, turnInput, responseSchema)) {
        throw new AiContextOverflowError();
      }
      const raw = await sessionRef.current
        .prompt(turnInput, { responseSchema })
        .catch(mapQuotaError);
      if (run.cancelled) return; // 사용자 중단 — 결과 폐기(로딩은 canceller가 이미 내렸다).
      lastSentStylesRef.current = currentSent;
      lastSentClassesRef.current = ctx.classList;

      // 호출 중 다른 요소로 repick됐으면 옛 요소용 결과를 새 요소에 적용하지 않는다(frameId 포함).
      const cur = useEditorStore.getState().selection;
      if (
        cur?.selector !== targetSelector ||
        (cur?.frameId ?? 0) !== targetFrameId
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
        const frameId = useEditorStore.getState().selection?.frameId ?? 0;
        if (parsed.edits.inlineStyle)
          void applyStyles(tabId, frameId, merged.inlineStyle);
        if (parsed.edits.classList)
          void applyClasses(tabId, frameId, merged.classList);
      }
    } catch (err) {
      if (run.cancelled) return; // 사용자 중단 후 배경 호출 실패(또는 세션 null-deref)의 오탐 토스트 방지.
      console.error("[AI Styling] error:", err);
      toastLlmError(err, t, "aiStyling.error");
      sessionRef.current?.destroy?.();
      sessionRef.current = null;
      sessionKeyRef.current = null;
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
      <DialogContent className="w-[90vw] max-w-[90vw] gap-5 rounded-3xl p-6 sm:rounded-3xl">
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
