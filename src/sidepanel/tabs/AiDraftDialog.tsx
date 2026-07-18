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
import { mergeAiSectionsPreservingBlocks } from "@/sidepanel/lib/mergeAiDraftSections";
import {
  candidateRefs,
  canRequestLogRefs,
  selectLogCandidates,
} from "@/sidepanel/lib/prompts/logCandidates";
import {
  appendLogBlocks,
  renderLogRefBlocks,
} from "@/sidepanel/lib/renderLogRefs";
import { resolveInlineImagesForSections } from "@/sidepanel/lib/resolveInlineImages";
import type { StyleDiffRow } from "@/sidepanel/components/StyleChangesTable";
import { buildNetworkLogSummary, buildConsoleLogSummary, buildActionLogSummary } from "@/sidepanel/lib/buildLogSummary";
import {
  AiContextOverflowError,
  mapQuotaError,
  type AISession,
  type AIProvider,
  type ProviderCapabilities,
} from "@/sidepanel/lib/ai-provider";
import { toastLlmError } from "@/sidepanel/lib/llmErrorToast";
import {
  supportsActionLog,
  supportsConsoleNetworkLog,
} from "@/sidepanel/lib/captureLogSupport";
import { fitDraftContext, isPromptOverBudget } from "@/sidepanel/lib/prompts/promptBudget";
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
      const includeCnLog = supportsConsoleNetworkLog(captureMode);
      const includeActionLog = supportsActionLog(captureMode);

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
          includeCnLog && networkLog && networkLog.captured > 0
            ? buildNetworkLogSummary(networkLog)
            : undefined,
        consoleLogSummary:
          includeCnLog && consoleLog && consoleLog.captured > 0
            ? buildConsoleLogSummary(consoleLog)
            : undefined,
        actionLogSummary:
          includeActionLog && actionLog && actionLog.captured > 0
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

      // 후보·스키마·few-shot 전부 fitted.ctx 파생 — 절삭이 로그를 지우면 셋이 동시 소멸.
      // description 비활성 게이트도 canRequestLogRefs 단일 출처(프롬프트 빌더와 동일 판정).
      const candidates = selectLogCandidates(fitted.ctx);
      const refs = canRequestLogRefs(fitted.ctx, candidates)
        ? candidateRefs(candidates)
        : [];

      const { systemPrompt, images } = buildAiDraftRequest({
        caps: capabilities,
        systemPrompt: fitted.prompt,
        modeImages: getModeImages(store, captureMode),
        inlineImageDataUrls,
      });

      // 매 요청마다 최신 선입력으로 세션 재생성 — 재오픈·재생성 시 갱신된 컨텍스트 반영.
      sessionRef.current?.destroy?.();
      sessionRef.current = await createSessionRef.current(
        systemPrompt,
        getDraftFewShot(fitted.ctx),
      );

      const responseSchema = buildAiDraftSchema(
        sectionIds,
        refs.length ? { logRefs: refs } : undefined,
      );
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
        // 섹션과 같은 보호 규칙: 기존 제목이 프롬프트에 못 실렸으면 모델은 그걸 본 적이
        // 없다 — 지어낸 제목으로 사용자 원문을 덮지 않는다.
        const prevTitle = prevDraft?.title?.trim();
        const title =
          !fitted.titleIncluded && prevTitle ? prevDraft!.title : aiTitle;
        const sections = mergeAiSectionsPreservingBlocks(
          prevDraft?.sections ?? {},
          parsed.sections,
          fitted.includedSections,
        );
        // 게이트는 AI 실패 신호 2종만 막는다 — description 키 누락·빈 문자열. 예산 절삭으로
        // 원문이 프롬프트에 못 실려도 AI 산문이 있으면 블록 삽입은 의도된 동작이다(후보는
        // 로그에서 나와 원문과 무관). 로그 스냅샷은 await 이전 지역 변수 — 느린 BYOK 왕복 뒤
        // store를 다시 읽으면 네비게이션 logClear에 걸려 블록이 조용히 사라진다.
        if (refs.length && parsed.sections.description?.trim()) {
          sections.description = appendLogBlocks(
            sections.description ?? "",
            renderLogRefBlocks(parsed.logRefs, {
              candidates,
              requests: networkLog?.requests ?? [],
              entries: consoleLog?.entries ?? [],
            }),
          );
        }
        useEditorStore.getState().setDraft({
          title,
          sections,
          environment: prevDraft?.environment ?? [],
        });
        // 절삭·섹션 누락은 결과를 조용히 열화시킨다 — 무엇이 빠졌는지까진 아니어도
        // "온전한 컨텍스트로 쓴 초안이 아니다"는 사실은 알아야 한다.
        if (fitted.level >= 1 || fitted.omittedSections.length > 0) {
          toast.info(t("aiDraft.contextTrimmed"));
        }
      } else {
        console.warn("[bugshot] AI draft parse failed. Raw response:", raw);
        toast.error(t("draft.aiParseError"));
      }
    } catch (err) {
      console.error("[AI Draft] error:", err);
      toastLlmError(err, t, "draft.aiError");
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
