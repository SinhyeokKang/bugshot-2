import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Download, FileCode, ImageIcon, ImagePlus, Loader2, Pencil, Plus, RotateCcw, Trash2, WandSparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useT } from "@/i18n";
import {
  POST_MEDIA_SECTION_IDS,
  sectionLabelKey,
  sectionPlaceholderKey,
  useSettingsUiStore,
  type IssueSection,
} from "@/store/settings-ui-store";
import { useEditorStore } from "@/store/editor-store";
import { useSettingsStore } from "@/store/settings-store";
import { useBoundTabId } from "@/sidepanel/hooks/useBoundTabId";
import { useAI } from "@/sidepanel/hooks/useAI";
import { useReproPrefill } from "@/sidepanel/hooks/useReproPrefill";
import { useReplay } from "@/sidepanel/30s-replay/replay-context";
import { clearPicker, startInlineAreaCapture } from "@/sidepanel/picker-control";
import { CancelConfirmDialog } from "@/sidepanel/components/CancelConfirmDialog";
import { LogAttachmentCards } from "@/sidepanel/components/LogAttachmentCards";
import { AttachmentSection } from "@/sidepanel/components/AttachmentSection";
import { LogPreviewDialog } from "@/sidepanel/components/LogPreviewDialog";
import { LogInsertDialog } from "@/sidepanel/components/LogInsertDialog";
import { TooltipIconButton } from "@/sidepanel/components/TooltipIconButton";
import {
  PageFooter,
  PageScroll,
  PageShell,
  Section,
} from "@/sidepanel/components/Section";
import {
  StyleChangesTable,
  buildStyleDiff,
} from "@/sidepanel/components/StyleChangesTable";
import { mergeStyleElements, joinStyleSelectors } from "@/sidepanel/lib/buildIssueMarkdown";
import { downloadImageDataUrl, downloadVideoBlob } from "@/sidepanel/lib/downloadCapture";
import { downloadEditorLogsHtml } from "@/sidepanel/lib/buildEditorCapture";
import { supportsActionLog, supportsConsoleNetworkLog } from "@/sidepanel/lib/captureLogSupport";
import { isReproSectionEnabled } from "@/sidepanel/lib/reproSectionEnabled";
import {
  deriveReadonlyEnvRows,
  filterEnvironmentRows,
  parseChromeVersion,
  type EnvironmentRow,
} from "@/sidepanel/lib/environmentRows";
import { getOsInfo } from "@/sidepanel/lib/osInfo";
import { OrderedListEditor } from "@/sidepanel/components/OrderedListEditor";
import { AiDraftDialog } from "./AiDraftDialog";

// 진행 중 잠금 표시 — IssueTab 캡처 툴바와 같은 관례.
const lockedClass = "aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

const LazyTiptapEditor = lazy(() => import("../components/TiptapEditor"));
const AnnotationOverlay = lazy(() => import("../components/AnnotationOverlay"));

export function DraftingPanel() {
  const t = useT();
  const tabId = useBoundTabId();
  const captureMode = useEditorStore((s) => s.captureMode);
  const videoStartedAt = useEditorStore((s) => s.videoStartedAt);
  const selection = useEditorStore((s) => s.selection);
  const styleEdits = useEditorStore((s) => s.styleEdits);
  const beforeImage = useEditorStore((s) => s.beforeImage);
  const afterImage = useEditorStore((s) => s.afterImage);
  const bufferedElements = useEditorStore((s) => s.bufferedElements);
  const screenshotAnnotated = useEditorStore((s) => s.screenshotAnnotated);
  const screenshotRaw = useEditorStore((s) => s.screenshotRaw);
  const videoBlob = useEditorStore((s) => s.videoBlob);
  const videoThumbnail = useEditorStore((s) => s.videoThumbnail);
  const draft = useEditorStore((s) => s.draft);
  const setDraft = useEditorStore((s) => s.setDraft);
  const reset = useEditorStore((s) => s.reset);
  const backToStyling = useEditorStore((s) => s.backToStyling);
  const confirmDraft = useEditorStore((s) => s.confirmDraft);
  const networkLog = useEditorStore((s) => s.networkLog);
  const consoleLog = useEditorStore((s) => s.consoleLog);
  const actionLog = useEditorStore((s) => s.actionLog);
  const logsAttach = useEditorStore((s) => s.logsAttach);
  const setLogsAttach = useEditorStore((s) => s.setLogsAttach);
  const issueSections = useSettingsUiStore((s) => s.issueSections);
  const attachmentsEnabled = useSettingsUiStore((s) => s.attachmentsEnabled);
  const autoReproPrefill = useSettingsUiStore((s) => s.autoReproPrefill);
  const locale = useSettingsUiStore((s) => s.locale);
  const target = useEditorStore((s) => s.target);
  const reproPrefillDone = useEditorStore((s) => s.reproPrefillDone);
  const setReproPrefillDone = useEditorStore((s) => s.setReproPrefillDone);
  const reproPrefillLoading = useEditorStore((s) => s.reproPrefillLoading);
  const setReproPrefillLoading = useEditorStore((s) => s.setReproPrefillLoading);
  const setAiCancel = useEditorStore((s) => s.setAiCancel);
  const { trimming } = useReplay();
  const attachments = useEditorStore((s) => s.attachments);
  const addAttachments = useEditorStore((s) => s.addAttachments);
  const removeAttachment = useEditorStore((s) => s.removeAttachment);
  const targetPlatform = useEditorStore((s) => s.targetPlatform);
  const { status: aiStatus, providerLabel, capabilities, createSession } = useAI();
  const [annotating, setAnnotating] = useState(false);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const aiDraftLoading = useEditorStore((s) => s.aiDraftLoading);
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const titlePrefix = useSettingsStore((s) => s.titlePrefix);
  const inlineCaptureTarget = useEditorStore((s) => s.inlineCaptureTarget);
  const isElementMode = captureMode === "element";
  const isVideoMode = captureMode === "video";
  const screenshotImage = screenshotAnnotated ?? screenshotRaw;

  const diffs = useMemo(
    () => (selection ? buildStyleDiff(selection, styleEdits) : []),
    [selection, styleEdits],
  );

  const styleElements = useMemo(
    () =>
      selection
        ? mergeStyleElements(bufferedElements, {
            selection,
            styleEdits,
            before: beforeImage,
            after: afterImage,
          })
        : [],
    [selection, styleEdits, bufferedElements, beforeImage, afterImage],
  );

  useEffect(() => {
    if (draft) return;
    if (captureMode === "element" && !selection) return;
    if (captureMode === "screenshot" && !screenshotImage) return;
    if (captureMode === "video" && !videoThumbnail && !videoBlob) return;
    setDraft({
      title: defaultTitle(titlePrefix),
      sections: {},
      environment: [],
    });
  }, [draft, selection, setDraft, titlePrefix, captureMode, screenshotImage, videoThumbnail, videoBlob]);

  const { aiFilled: reproPrefillAiFilled } = useReproPrefill({
    captureMode,
    actionLog,
    draft,
    setDraft,
    aiStatus,
    capabilities,
    createSession,
    url: target?.url ?? "",
    pageTitle: target?.title ?? "",
    locale,
    trimming,
    sectionEnabled: isReproSectionEnabled(issueSections),
    autoReproPrefill,
    reproPrefillDone,
    setReproPrefillDone,
    setLoading: setReproPrefillLoading,
    setAiCancel,
  });

  if (!draft) return null;
  if (captureMode === "element" && !selection) return null;
  if (captureMode === "screenshot" && !screenshotImage) return null;
  if (captureMode === "video" && !videoThumbnail && !videoBlob) return null;

  const titleMissing = !draft.title.trim();

  const showActionCard = supportsActionLog(captureMode) && actionLog !== null && actionLog.captured > 0;
  const showLogCards = captureMode !== "element" && (
    (networkLog !== null && networkLog.captured > 0) ||
    (consoleLog !== null && consoleLog.captured > 0) ||
    showActionCard
  );

  const enabledSections = issueSections.filter((s) => s.enabled);

  const isFreeformMode = captureMode === "freeform";

  const mediaBlock = isFreeformMode ? null : isVideoMode ? (
    <Section
      key="__media"
      title={t("section.media")}
      collapsible
      action={
        videoBlob ? (
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8 shrink-0"
            title={t("common.download")}
            data-testid="download-media"
            onClick={() => downloadVideoBlob(videoBlob)}
          >
            <Download />
          </Button>
        ) : undefined
      }
    >
      <VideoPreview blob={videoBlob} thumbnail={videoThumbnail} />
    </Section>
  ) : isElementMode ? (
    styleElements.length > 0 ? (
      styleElements.map((el) => (
        <Section
          key={el.selector}
          title={`${t("section.styleChanges")} (${el.selector})`}
          collapsible
        >
          <StyleChangesTable
            beforeImage={el.beforeImage ?? null}
            afterImage={el.afterImage ?? null}
            diffs={el.diffs}
          />
        </Section>
      ))
    ) : (
      <Section key="__media" title={t("section.media")} collapsible>
        {beforeImage ? (
          <div className="aspect-video w-full overflow-hidden rounded-lg border bg-muted/70">
            <img
              src={beforeImage}
              alt={t("section.media")}
              className="h-full w-full object-contain"
            />
          </div>
        ) : null}
      </Section>
    )
  ) : (
    <Section
      key="__media"
      title={t("section.media")}
      collapsible
      action={
        screenshotImage ? (
          <>
            {screenshotAnnotated ? (
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8 shrink-0"
                title={t("draft.removeAnnotation")}
                data-testid="annotation-remove"
                onClick={() => useEditorStore.setState({ screenshotAnnotated: null })}
              >
                <RotateCcw />
              </Button>
            ) : null}
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8 shrink-0"
              title={screenshotAnnotated ? t("draft.editAnnotation") : t("draft.addAnnotation")}
              data-testid="annotation-edit"
              onClick={() => setAnnotating(true)}
            >
              <Pencil />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8 shrink-0"
              title={t("common.download")}
              data-testid="download-media"
              onClick={() => downloadImageDataUrl(screenshotImage)}
            >
              <Download />
            </Button>
          </>
        ) : undefined
      }
    >
      {screenshotImage ? (
        <div className="aspect-video w-full overflow-hidden rounded-lg border bg-muted/70">
          <img
            src={screenshotImage}
            alt={t("section.media")}
            className="h-full w-full object-contain"
            data-testid="media-preview-img"
          />
        </div>
      ) : null}
    </Section>
  );

  const logCardsBlock = showLogCards ? (
    <Section
      key="__logCards"
      title={t("section.logs")}
      collapsible
      action={
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8 shrink-0"
          title={t("common.download")}
          data-testid="download-logs"
          onClick={() => void downloadEditorLogsHtml()}
        >
          <Download />
        </Button>
      }
    >
      <LogAttachmentCards
        networkLog={networkLog}
        consoleLog={consoleLog}
        actionLog={showActionCard ? actionLog : null}
        logsAttach={logsAttach}
        onToggle={setLogsAttach}
        onClick={() => { (document.activeElement as HTMLElement)?.blur?.(); setLogDialogOpen(true); }}
      />
    </Section>
  ) : null;

  const attachmentBlock = attachmentsEnabled ? (
    <Section
      key="__attachments"
      title={
        <>
          {t("section.attachments")}
          {attachments.length > 0 && (
            <Badge
              variant="secondary"
              className="ml-2 align-middle text-xs tabular-nums"
            >
              {attachments.length}
            </Badge>
          )}
        </>
      }
      collapsible
    >
      <AttachmentSection
        attachments={attachments}
        platform={targetPlatform}
        onAdd={addAttachments}
        onRemove={removeAttachment}
      />
    </Section>
  ) : null;

  const sectionNodes: React.ReactNode[] = [];
  let mediaInserted = false;
  for (const sec of enabledSections) {
    if (POST_MEDIA_SECTION_IDS.has(sec.id) && !mediaInserted) {
      mediaInserted = true;
      sectionNodes.push(mediaBlock);
      if (logCardsBlock) sectionNodes.push(logCardsBlock);
    }
    sectionNodes.push(
      <SectionTextarea
        key={sec.id}
        section={sec}
        value={draft.sections[sec.id] ?? ""}
        onChange={(v) =>
          setDraft({
            ...draft,
            sections: { ...draft.sections, [sec.id]: v },
          })
        }
        reproAiHint={sec.id === "stepsToReproduce" && reproPrefillAiFilled}
      />,
    );
  }
  if (!mediaInserted) {
    sectionNodes.push(mediaBlock);
    if (logCardsBlock) sectionNodes.push(logCardsBlock);
  }
  // 첨부 섹션은 본문 모든 섹션 뒤 맨 하단에 배치.
  if (attachmentBlock) sectionNodes.push(attachmentBlock);

  return (
    <PageShell className="relative" data-testid="drafting-panel">
      {inlineCaptureTarget ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-5 text-center">
          <div className="mb-3 rounded-full bg-muted p-3">
            <ImageIcon className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold">{t("issue.capturing.title")}</h3>
          <div className="mt-4">
            <Button
              variant="outline"
              onClick={() => {
                useEditorStore.getState().cancelInlineCapture();
                if (tabId) {
                  chrome.tabs.sendMessage(tabId, { type: "picker.cancelAreaSelect" }).catch(() => {});
                }
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <PageScroll>
            <Section title={t("section.issueTitle")}>
              <Input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                onFocus={cursorToEnd}
                placeholder={t("draft.titlePlaceholder")}
                data-testid="draft-title"
              />
            </Section>

            <ReproEnvironmentSection />

            {sectionNodes}
          </PageScroll>
          {aiStatus === "available" && (
            <button
              data-testid="ai-draft-trigger"
              className="flex items-center justify-between rounded-t-lg bg-purple-100/80 px-3.5 py-2.5 text-purple-700 transition-colors hover:bg-purple-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-50 dark:bg-purple-950 dark:text-purple-300 dark:hover:bg-purple-900"
              onClick={() => { if (aiDraftLoading || reproPrefillLoading) return; (document.activeElement as HTMLElement)?.blur?.(); setAiDialogOpen(true); }}
              aria-disabled={aiDraftLoading || reproPrefillLoading}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <Badge variant="outline" className="shrink-0 font-normal border-purple-500 text-purple-600 dark:border-purple-400 dark:text-purple-300">{providerLabel ?? t("ai.badge.chromeAI")}</Badge>
                <span className="truncate bg-gradient-to-r from-purple-500 to-indigo-500 bg-clip-text text-sm text-transparent dark:from-purple-300 dark:to-indigo-300">{t("draft.aiBanner")}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1 bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-sm font-medium text-transparent dark:from-indigo-300 dark:to-purple-300">
                <WandSparkles className="h-4 w-4 text-purple-500 dark:text-purple-300" />
                {t("draft.aiGenerate")}
              </span>
            </button>
          )}
          <PageFooter>
            <div className="flex items-center justify-between gap-2">
              <CancelConfirmDialog
                onConfirm={() => {
                  setAnnotating(false);
                  reset();
                  if (tabId) void clearPicker(tabId);
                }}
              />
              <div className="flex items-center gap-2">
                {isElementMode ? (
                  <Button
                    variant="outline"
                    onClick={() => backToStyling()}
                  >
                    {t("common.back")}
                  </Button>
                ) : null}
                <Button
                  onClick={() => {
                    setAnnotating(false);
                    if (confirmDraft()) toast.success(t("draft.saved"));
                  }}
                  disabled={titleMissing || aiDraftLoading || reproPrefillLoading}
                  data-testid="to-preview"
                >
                  {t("draft.preview")}
                </Button>
              </div>
            </div>
          </PageFooter>
        </>
      )}
      <LogPreviewDialog
        open={logDialogOpen}
        onOpenChange={setLogDialogOpen}
        networkLog={networkLog}
        consoleLog={consoleLog}
        actionLog={showActionCard ? actionLog : null}
        logsAttach={logsAttach}
        onToggleAttach={setLogsAttach}
        syncBaseMs={videoStartedAt ?? undefined}
      />
      <AiDraftDialog
        capabilities={capabilities}
        open={aiDialogOpen}
        onOpenChange={setAiDialogOpen}
        createSession={createSession}
        elementDiffs={isElementMode ? diffs : undefined}
      />
      {annotating && screenshotRaw ? (
        <Suspense
          fallback={
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-background">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          }
        >
          <AnnotationOverlay
            imageUrl={screenshotAnnotated ?? screenshotRaw}
            onComplete={(url) => {
              useEditorStore.getState().onAnnotated(url);
              setAnnotating(false);
            }}
            onCancel={() => setAnnotating(false)}
          />
        </Suspense>
      ) : null}
    </PageShell>
  );
}

function ReproEnvironmentSection() {
  const t = useT();
  const target = useEditorStore((s) => s.target);
  const captureMode = useEditorStore((s) => s.captureMode);
  const selection = useEditorStore((s) => s.selection);
  const styleEdits = useEditorStore((s) => s.styleEdits);
  const bufferedElements = useEditorStore((s) => s.bufferedElements);
  const shotSelector = useEditorStore((s) => s.shotSelector);
  const videoViewport = useEditorStore((s) => s.videoViewport);
  const videoCapturedAt = useEditorStore((s) => s.videoCapturedAt);
  const screenshotViewport = useEditorStore((s) => s.screenshotViewport);
  const screenshotCapturedAt = useEditorStore((s) => s.screenshotCapturedAt);
  const freeformViewport = useEditorStore((s) => s.freeformViewport);
  const freeformCapturedAt = useEditorStore((s) => s.freeformCapturedAt);
  const draft = useEditorStore((s) => s.draft);
  const setDraft = useEditorStore((s) => s.setDraft);

  // element 모드 DOM 줄: 버퍼+현재 머지 결과의 selector를 쉼표로 나열(이미지는 selector에
  // 무관하므로 null). 본문 마크다운과 동일 규칙.
  const styleElements = useMemo(
    () =>
      captureMode === "element" && selection
        ? mergeStyleElements(bufferedElements, {
            selection,
            styleEdits,
            before: null,
            after: null,
          })
        : [],
    [captureMode, selection, styleEdits, bufferedElements],
  );

  if (!draft) return null;

  const vp =
    captureMode === "element" ? selection?.viewport ?? null
    : captureMode === "video" ? videoViewport
    : captureMode === "screenshot" ? screenshotViewport
    : freeformViewport;
  const capturedAt =
    captureMode === "element" ? selection?.capturedAt ?? null
    : captureMode === "video" ? videoCapturedAt
    : captureMode === "screenshot" ? screenshotCapturedAt
    : freeformCapturedAt;

  const readonlyRows = deriveReadonlyEnvRows({
    os: getOsInfo(),
    browser: parseChromeVersion(navigator.userAgent),
    url: target?.url ?? "",
    selector: captureMode === "element" ? joinStyleSelectors(styleElements, selection?.selector) : shotSelector?.selector ?? null,
    viewport: vp ? { w: vp.width, h: vp.height } : null,
    capturedAt,
  });

  const customRows = draft.environment ?? [];
  const metaCount = readonlyRows.length + filterEnvironmentRows(customRows).length;
  const updateRows = (next: EnvironmentRow[]) => {
    setDraft({ ...draft, environment: next });
  };
  const addRowButton = (
    <Button
      type="button"
      size="icon"
      variant="outline"
      className="h-9 w-9 shrink-0"
      title={t("draft.envAddRow")}
      onClick={() => updateRows([...customRows, { label: "", value: "" }])}
    >
      <Plus />
    </Button>
  );

  return (
    <Section
      title={
        <>
          {t("section.env")}
          <Badge
            variant="secondary"
            className="ml-2 align-middle text-xs tabular-nums"
          >
            {metaCount}
          </Badge>
        </>
      }
      collapsible
      defaultOpen={false}
    >
      <div className="flex flex-col gap-2">
        {readonlyRows.map((r, i) => (
          <div key={`ro-${i}`} className="flex items-center gap-1">
            <Input
              className="w-24 shrink-0 text-sm text-muted-foreground bg-muted"
              value={r.label}
              readOnly
            />
            <Input
              className="flex-1 text-sm text-muted-foreground bg-muted"
              value={r.value}
              readOnly
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-9 w-9 shrink-0 hover:text-destructive"
              title={t("common.delete")}
              disabled
            >
              <Trash2 />
            </Button>
            {customRows.length === 0 &&
              i === readonlyRows.length - 1 &&
              addRowButton}
          </div>
        ))}
        {customRows.map((row, idx) => (
          <div key={idx} className="flex items-center gap-1">
            <Input
              className="w-24 shrink-0 text-sm"
              placeholder={t("draft.envLabelPlaceholder")}
              value={row.label}
              onChange={(e) => {
                const next = [...customRows];
                next[idx] = { ...next[idx], label: e.target.value };
                updateRows(next);
              }}
            />
            <Input
              className="flex-1 text-sm"
              placeholder={t("draft.envValuePlaceholder")}
              value={row.value}
              onChange={(e) => {
                const next = [...customRows];
                next[idx] = { ...next[idx], value: e.target.value };
                updateRows(next);
              }}
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-9 w-9 shrink-0 hover:text-destructive"
              title={t("common.delete")}
              onClick={() => updateRows(customRows.filter((_, i) => i !== idx))}
            >
              <Trash2 />
            </Button>
            {idx === customRows.length - 1 && addRowButton}
          </div>
        ))}
      </div>
    </Section>
  );
}

function SectionTextarea({
  section,
  value,
  onChange,
  reproAiHint = false,
}: {
  section: IssueSection;
  value: string;
  onChange: (next: string) => void;
  reproAiHint?: boolean;
}) {
  const t = useT();
  const label = section.labelOverride?.trim() || t(sectionLabelKey(section.id));
  const placeholder =
    section.placeholderOverride?.trim() || t(sectionPlaceholderKey(section.id));

  const editorRef = useRef<import("../components/TiptapEditor").TiptapEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [sectionOpen, setSectionOpen] = useState(true);

  const isParagraph = section.renderAs !== "orderedList";
  const aiLoading = useEditorStore((s) => s.aiDraftLoading);
  const captureMode = useEditorStore((s) => s.captureMode);
  const networkLog = useEditorStore((s) => s.networkLog);
  const consoleLog = useEditorStore((s) => s.consoleLog);
  const videoStartedAt = useEditorStore((s) => s.videoStartedAt);
  const requests = networkLog?.requests ?? [];
  const entries = consoleLog?.entries ?? [];
  // 제출 첨부·AI 프롬프트와 같은 게이트를 타야 한다 — element 모드는 로그를 안 싣는다.
  const noLogs =
    !supportsConsoleNetworkLog(captureMode) || (requests.length === 0 && entries.length === 0);

  return (
    <Section
      title={label}
      collapsible
      open={sectionOpen}
      onOpenChange={setSectionOpen}
      testId={`draft-section-${section.id}`}
      action={
        isParagraph ? (
          <>
            <input
              ref={fileInputRef}
              data-testid={`section-image-input-${section.id}`}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files;
                if (!files) return;
                for (const f of Array.from(files)) editorRef.current?.insertImageFile(f);
                e.target.value = "";
              }}
            />
            {/* 셋 다 "이 섹션 본문에 콘텐츠 삽입"이라 한 그룹 — 접기(chevron)는 Section이 뒤에 따로 렌더한다. */}
            <ButtonGroup className="flex-nowrap">
              <TooltipIconButton
                label={noLogs ? t("draft.insertLog.empty") : t("draft.insertLog")}
                ariaDisabled={noLogs}
                className={lockedClass}
                testId={`section-log-insert-${section.id}`}
                onClick={() => {
                  // 접힌 섹션은 에디터가 언마운트돼 삽입이 조용히 사라진다 — 먼저 펼친다.
                  setSectionOpen(true);
                  setLogDialogOpen(true);
                }}
              >
                <FileCode />
              </TooltipIconButton>
              <TooltipIconButton
                label={t("draft.captureArea")}
                ariaDisabled={aiLoading}
                className={lockedClass}
                onClick={() => {
                  useEditorStore.getState().startInlineCapture(section.id);
                  const tabId = useEditorStore.getState().target?.tabId;
                  if (tabId) void startInlineAreaCapture(tabId);
                }}
              >
                <Camera />
              </TooltipIconButton>
              <TooltipIconButton
                label={t("draft.addImage")}
                onClick={() => fileInputRef.current?.click()}
              >
                <ImagePlus />
              </TooltipIconButton>
            </ButtonGroup>
            <LogInsertDialog
              open={logDialogOpen}
              onOpenChange={setLogDialogOpen}
              requests={requests}
              entries={entries}
              startedAt={consoleLog?.startedAt}
              syncBaseMs={videoStartedAt ?? undefined}
              onInsert={(text, language) => editorRef.current?.insertCodeBlock(text, language)}
            />
          </>
        ) : (
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8 shrink-0 hover:text-destructive"
            title={t("draft.stepsReset")}
            data-testid={`draft-section-${section.id}-reset`}
            disabled={!value.trim()}
            onClick={() => onChange("")}
          >
            <Trash2 />
          </Button>
        )
      }
    >
      {section.renderAs === "orderedList" ? (
        <div className="space-y-1.5">
          <OrderedListEditor value={value} onChange={onChange} placeholder={placeholder} />
          {reproAiHint ? (
            <p className="text-center text-xs text-muted-foreground/60" data-testid="repro-prefill-ai-hint">
              {t("aiDraft.disclaimer")}
            </p>
          ) : null}
        </div>
      ) : (
        <Suspense fallback={<Textarea disabled placeholder={placeholder} className="min-h-32 resize-none text-sm" />}>
          <LazyTiptapEditor
            ref={editorRef}
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            ariaLabel={label}
          />
        </Suspense>
      )}
    </Section>
  );
}

function VideoPreview({ blob, thumbnail }: { blob: Blob | null; thumbnail: string | null }) {
  const t = useT();
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setSrc(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  return (
    <div className="space-y-1.5">
      {src ? (
        <div className="aspect-video w-full overflow-hidden rounded-lg border bg-black">
          <video src={src} controls className="h-full w-full object-contain" />
        </div>
      ) : thumbnail ? (
        <div className="aspect-video w-full overflow-hidden rounded-lg border bg-black">
          <img src={thumbnail} alt={t("alt.recordingThumbnail")} className="h-full w-full object-contain" />
        </div>
      ) : null}
    </div>
  );
}

function cursorToEnd(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
  const el = e.currentTarget;
  requestAnimationFrame(() => {
    const len = el.value.length;
    el.setSelectionRange(len, len);
  });
}

export function defaultTitle(prefix: string): string {
  if (!prefix) return "";
  return prefix.endsWith(" ") ? prefix : `${prefix} `;
}

