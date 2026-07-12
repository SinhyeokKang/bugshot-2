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
import { useEditorStore, type CaptureMode } from "@/store/editor-store";
import { useSettingsUiStore } from "@/store/settings-ui-store";
import { useSettingsStore } from "@/store/settings-store";
import {
  buildAiDraftSchema,
  buildAiDraftSessionPrompt,
  getDraftFewShot,
  parseAiDraftResponse,
  type AiDraftSessionContext,
} from "@/sidepanel/lib/buildAiDraftPrompt";
import { buildAiDraftRequest } from "@/sidepanel/lib/buildAiDraftRequest";
import { mergeAiSectionsPreservingImages } from "@/sidepanel/lib/mergeAiDraftSections";
import { resolveInlineImagesForSections } from "@/sidepanel/lib/resolveInlineImages";
import type { StyleDiffRow } from "@/sidepanel/components/StyleChangesTable";
import { buildNetworkLogSummary, buildConsoleLogSummary, buildActionLogSummary } from "@/sidepanel/lib/buildLogSummary";
import {
  AiContextOverflowError,
  LlmQuotaError,
  LlmOverloadedError,
  mapQuotaError,
  type AISession,
  type AIProvider,
  type ProviderCapabilities,
} from "@/sidepanel/lib/ai-provider";
import { fitDraftContext, isPromptOverBudget } from "@/sidepanel/lib/promptBudget";
import { defaultTitle } from "./DraftingPanel";

export function AiDraftDialog({
  open,
  onOpenChange,
  createSession,
  capabilities,
  elementDiffs,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  createSession: AIProvider["createSession"];
  capabilities: ProviderCapabilities;
  elementDiffs?: StyleDiffRow[];
}) {
  const t = useT();
  const [input, setInput] = useState("");
  const captureMode = useEditorStore((s) => s.captureMode);
  const sessionRef = useRef<AISession | null>(null);
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
    if (!msg && captureMode !== "element") return;

    setInput("");
    onOpenChange(false);
    useEditorStore.getState().setAiDraftLoading(true);

    try {
      const store = useEditorStore.getState();
      const settingsUi = useSettingsUiStore.getState();
      const { titlePrefix } = useSettingsStore.getState();
      const enabledSections = settingsUi.issueSections
        .filter((s) => s.enabled)
        .map((s) => ({ id: s.id }));
      const sectionIds = enabledSections.map((s) => s.id);

      const isElement = captureMode === "element";
      const networkLog = store.networkLog;
      const consoleLog = store.consoleLog;
      const actionLog = store.actionLog;
      const includeLogCtx = captureMode === "video" || captureMode === "freeform";

      const ctx: AiDraftSessionContext = {
        caps: capabilities,
        captureMode,
        locale: settingsUi.locale,
        url: store.target?.url ?? "",
        pageTitle: store.target?.title ?? "",
        selector: isElement ? store.selection?.selector : store.shotSelector?.selector,
        tagName: isElement ? store.selection?.tagName : store.shotSelector?.tagName,
        diffs: isElement && elementDiffs?.length ? elementDiffs : undefined,
        tokens:
          isElement && store.tokens.length > 0
            ? store.tokens.map((tk) => ({ name: tk.name, value: tk.value }))
            : undefined,
        userPrompt: msg,
        networkLogSummary:
          includeLogCtx && networkLog && networkLog.captured > 0
            ? buildNetworkLogSummary(networkLog)
            : undefined,
        consoleLogSummary:
          includeLogCtx && consoleLog && consoleLog.captured > 0
            ? buildConsoleLogSummary(consoleLog)
            : undefined,
        actionLogSummary:
          includeLogCtx && actionLog && actionLog.captured > 0
            ? buildActionLogSummary(actionLog)
            : undefined,
        enabledSections,
        existingDraft: {
          title: store.draft?.title ?? "",
          sections: store.draft?.sections ?? {},
        },
      };

      // 이미지를 못 받는 프로바이더면 blob→dataURL resolve 자체를 건너뛴다 — 버릴 데이터다.
      const inlineImageDataUrls = capabilities.supportsImages
        ? (
            await resolveInlineImagesForSections(
              store.draft?.sections ?? {},
              settingsUi.issueSections,
            )
          ).map((img) => img.dataUrl)
        : [];

      const fitted = fitDraftContext(
        ctx,
        buildAiDraftSessionPrompt,
        capabilities.contextBudgetChars,
      );

      const { systemPrompt, images } = buildAiDraftRequest({
        ctx: fitted.ctx,
        modeImages: getModeImages(store, captureMode),
        inlineImageDataUrls,
      });

      // 매 요청마다 최신 선입력으로 세션 재생성 — 재오픈·재생성 시 갱신된 컨텍스트 반영.
      sessionRef.current?.destroy?.();
      sessionRef.current = await createSessionRef.current(
        systemPrompt,
        getDraftFewShot(fitted.ctx),
      );

      const responseSchema = buildAiDraftSchema(sectionIds);
      if (await isPromptOverBudget(sessionRef.current, msg, responseSchema)) {
        throw new AiContextOverflowError();
      }
      const raw = await sessionRef.current
        .prompt(msg, { responseSchema, images })
        .catch(mapQuotaError);

      const parsed = parseAiDraftResponse(raw, sectionIds);
      if (parsed) {
        const prefix = defaultTitle(titlePrefix);
        const aiTitle = prefix ? prefix + parsed.title : parsed.title;
        const prevDraft = useEditorStore.getState().draft;
        useEditorStore.getState().setDraft({
          title: aiTitle,
          sections: mergeAiSectionsPreservingImages(
            prevDraft?.sections ?? {},
            parsed.sections,
            fitted.includedSections,
          ),
          environment: prevDraft?.environment ?? [],
        });
      } else {
        console.warn("[bugshot] AI draft parse failed. Raw response:", raw);
        toast.error(t("draft.aiParseError"));
      }
    } catch (err) {
      console.error("[AI Draft] error:", err);
      if (err instanceof AiContextOverflowError) {
        toast.error(t("llm.error.contextOverflow"), {
          description: t("llm.error.contextOverflow.hint"),
          duration: 8000,
        });
      } else if (err instanceof LlmQuotaError) {
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
  }, [input, captureMode, capabilities, elementDiffs, onOpenChange, t]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const submitDisabled = captureMode !== "element" && !input.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[80vw] max-w-[80vw] gap-5 rounded-3xl p-6 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{t("aiDraft.title")}</DialogTitle>
        </DialogHeader>

        <div>
          <Textarea
            data-testid="ai-draft-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("aiDraft.placeholder")}
            rows={3}
            className="min-h-32 resize-none text-sm [field-sizing:content]"
            autoFocus
          />
          <p className="mt-1.5 text-center text-xs text-muted-foreground/60">
            {!capabilities.supportsImages && (
              <>
                {t("aiDraft.nanoImageNotice")}
                <br />
              </>
            )}
            {t("aiDraft.disclaimer")}
          </p>
        </div>

        <DialogFooter className="!flex-row items-center !justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button data-testid="ai-draft-submit" onClick={() => void handleSubmit()} disabled={submitDisabled}>
            {t("aiDraft.generate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function getModeImages(
  store: Pick<
    ReturnType<typeof useEditorStore.getState>,
    "screenshotAnnotated" | "screenshotRaw" | "beforeImage" | "afterImage"
  >,
  captureMode: CaptureMode,
): string[] | undefined {
  if (captureMode === "screenshot") {
    const img = store.screenshotAnnotated ?? store.screenshotRaw;
    return img ? [img] : undefined;
  }
  if (captureMode === "element") {
    const imgs = [store.beforeImage, store.afterImage].filter(
      (s): s is string => !!s,
    );
    return imgs.length > 0 ? imgs : undefined;
  }
  return undefined;
}
