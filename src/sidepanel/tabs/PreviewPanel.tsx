import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { formatTimestamp } from "@/sidepanel/lib/formatTimestamp";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { POST_MEDIA_SECTION_IDS, sectionLabelKey, useSettingsUiStore } from "@/store/settings-ui-store";
import { useEditorStore } from "@/store/editor-store";
import { connectedPlatforms, useSettingsStore } from "@/store/settings-store";
import { useTabNav } from "@/sidepanel/tab-nav";
import { IntegrationsCta } from "@/sidepanel/components/IntegrationsCta";
import { IssuePreviewView } from "@/sidepanel/components/IssuePreviewView";
import { AttachmentList } from "@/sidepanel/components/AttachmentList";
import { downloadAttachment } from "@/sidepanel/lib/downloadAttachment";
import { downloadImageDataUrl, downloadVideoBlob } from "@/sidepanel/lib/downloadCapture";
import { downloadEditorLogsHtml } from "@/sidepanel/lib/buildEditorCapture";
import { LogAttachmentCards } from "@/sidepanel/components/LogAttachmentCards";
import { NetworkLogPreviewDialog } from "@/sidepanel/components/NetworkLogPreviewDialog";
import { ConsoleLogPreviewDialog } from "@/sidepanel/components/ConsoleLogPreviewDialog";
import { ActionLogPreviewDialog } from "@/sidepanel/components/ActionLogPreviewDialog";
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
import { buildIssueHtml, buildIssueMarkdown, mergeStyleElements, joinStyleSelectors, type MarkdownContext } from "@/sidepanel/lib/buildIssueMarkdown";
import { buildMarkdownContext } from "@/sidepanel/lib/buildMarkdownContext";
import { filterEnvironmentRows, parseChromeVersion } from "@/sidepanel/lib/environmentRows";
import { getOsInfo } from "@/sidepanel/lib/osInfo";
import { buildNetworkLogSummary, buildConsoleLogSummary } from "@/sidepanel/lib/buildLogSummary";
import { supportsConsoleNetworkLog, supportsActionLog } from "@/sidepanel/lib/captureLogSupport";
import { resolveSectionImages } from "@/sidepanel/lib/resolveInlineImages";
import { IssueCreateModal } from "./IssueCreateModal";


export function PreviewPanel() {
  const t = useT();
  const captureMode = useEditorStore((s) => s.captureMode);
  const selection = useEditorStore((s) => s.selection);
  const target = useEditorStore((s) => s.target);
  const styleEdits = useEditorStore((s) => s.styleEdits);
  const bufferedElements = useEditorStore((s) => s.bufferedElements);
  const tokens = useEditorStore((s) => s.tokens);
  const beforeImage = useEditorStore((s) => s.beforeImage);
  const afterImage = useEditorStore((s) => s.afterImage);
  const screenshotAnnotated = useEditorStore((s) => s.screenshotAnnotated);
  const screenshotRaw = useEditorStore((s) => s.screenshotRaw);
  const screenshotViewport = useEditorStore((s) => s.screenshotViewport);
  const shotSelector = useEditorStore((s) => s.shotSelector);
  const screenshotCapturedAt = useEditorStore((s) => s.screenshotCapturedAt);
  const videoBlob = useEditorStore((s) => s.videoBlob);
  const videoThumbnail = useEditorStore((s) => s.videoThumbnail);
  const videoViewport = useEditorStore((s) => s.videoViewport);
  const videoCapturedAt = useEditorStore((s) => s.videoCapturedAt);
  const freeformViewport = useEditorStore((s) => s.freeformViewport);
  const freeformCapturedAt = useEditorStore((s) => s.freeformCapturedAt);
  const draft = useEditorStore((s) => s.draft);
  const networkLog = useEditorStore((s) => s.networkLog);
  const networkLogAttach = useEditorStore((s) => s.networkLogAttach);
  const consoleLog = useEditorStore((s) => s.consoleLog);
  const consoleLogAttach = useEditorStore((s) => s.consoleLogAttach);
  const actionLog = useEditorStore((s) => s.actionLog);
  const actionLogAttach = useEditorStore((s) => s.actionLogAttach);
  const backToDraft = useEditorStore((s) => s.backToDraft);
  const reset = useEditorStore((s) => s.reset);
  const attachments = useEditorStore((s) => s.attachments);
  const currentIssueId = useEditorStore((s) => s.currentIssueId);
  const issueSections = useSettingsUiStore((s) => s.issueSections);
  const attachmentsEnabled = useSettingsUiStore((s) => s.attachmentsEnabled);
  const accounts = useSettingsStore((s) => s.accounts);
  const navTo = useTabNav();
  const noPlatformConnected = connectedPlatforms(accounts).length === 0;
  const isElementMode = captureMode === "element";
  const isVideoMode = captureMode === "video";
  const isFreeformMode = captureMode === "freeform";
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

  const [networkDialogOpen, setNetworkDialogOpen] = useState(false);
  const [consoleDialogOpen, setConsoleDialogOpen] = useState(false);
  const [actionDialogOpen, setActionDialogOpen] = useState(false);

  // 본문 inline 이미지를 dataURL로 미리 resolve(IssuePreviewView는 blob-db 미접근).
  const [resolvedSections, setResolvedSections] = useState<Record<string, string>>(
    draft?.sections ?? {},
  );
  useEffect(() => {
    if (!draft) return;
    let cancelled = false;
    (async () => {
      const out = await resolveSectionImages(draft.sections, issueSections);
      if (!cancelled) setResolvedSections(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [draft, issueSections]);

  const os = getOsInfo();
  const browser = parseChromeVersion(navigator.userAgent);

  if (!draft) return null;
  if (isElementMode && !selection) return null;

  const attachedNetwork = networkLogAttach && networkLog && networkLog.captured > 0 ? networkLog : null;
  const attachedConsole = consoleLogAttach && consoleLog && consoleLog.captured > 0 ? consoleLog : null;
  // action log는 video 모드 한정 첨부.
  const attachedAction = supportsActionLog(captureMode) && actionLogAttach && actionLog && actionLog.captured > 0 ? actionLog : null;
  const showLogCards = supportsConsoleNetworkLog(captureMode) && (attachedNetwork !== null || attachedConsole !== null || attachedAction !== null);

  const envRows: { label: string; value: string }[] = [
    ...(os ? [{ label: "OS", value: os }] : []),
    ...(browser ? [{ label: "Browser", value: browser }] : []),
    { label: "Page", value: target?.url || "-" },
  ];
  if (isElementMode && selection) {
    envRows.push({ label: "DOM", value: joinStyleSelectors(styleElements, selection.selector) });
    envRows.push({ label: "Viewport", value: `${selection.viewport.width}×${selection.viewport.height}` });
    envRows.push({ label: "Captured", value: formatTimestamp(selection.capturedAt) });
  } else {
    // 요소 캡처(element-shot)는 captureMode="screenshot"이라 위 element 분기로 안 들어온다 —
    // shotSelector가 있으면 DOM 행을 넣어 drafting·제출 본문과 동일하게 표시한다.
    if (shotSelector) {
      envRows.push({ label: "DOM", value: shotSelector.selector });
    }
    const vp = isVideoMode ? videoViewport : isFreeformMode ? freeformViewport : screenshotViewport;
    const cap = isVideoMode ? videoCapturedAt : isFreeformMode ? freeformCapturedAt : screenshotCapturedAt;
    if (vp) envRows.push({ label: "Viewport", value: `${vp.width}×${vp.height}` });
    if (cap) envRows.push({ label: "Captured", value: formatTimestamp(cap) });
  }
  envRows.push(...filterEnvironmentRows(draft.environment ?? []));

  const previewSections = issueSections
    .filter((s) => s.enabled)
    .map((s) => ({
      id: s.id,
      label: s.labelOverride?.trim() || t(sectionLabelKey(s.id)),
      renderAs: s.renderAs,
      value: resolvedSections[s.id] ?? "",
    }));

  const mediaBlock = isFreeformMode ? null : isVideoMode ? (
    <Section
      title={t("section.media")}
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
      <PreviewVideo blob={videoBlob} thumbnail={videoThumbnail} />
    </Section>
  ) : isElementMode ? (
    styleElements.map((el) => (
      <Section
        key={el.selector}
        title={`${t("section.styleChanges")} (${el.selector})`}
      >
        <StyleChangesTable
          beforeImage={el.beforeImage ?? null}
          afterImage={el.afterImage ?? null}
          diffs={el.diffs}
        />
      </Section>
    ))
  ) : (
    <Section
      title={t("section.media")}
      action={
        screenshotImage ? (
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
        ) : undefined
      }
    >
      {screenshotImage ? (
        <div className="aspect-video w-full overflow-hidden rounded-lg border bg-muted/70">
          <img
            src={screenshotImage}
            alt={t("alt.capturedImage")}
            className="h-full w-full object-contain"
          />
        </div>
      ) : null}
    </Section>
  );

  const logCardsBlock = showLogCards ? (
    <Section
      title={t("section.logs")}
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
        networkLog={attachedNetwork}
        networkLogAttach={networkLogAttach}
        onNetworkLogToggle={() => {}}
        onNetworkLogClick={() => { (document.activeElement as HTMLElement)?.blur?.(); setNetworkDialogOpen(true); }}
        consoleLog={attachedConsole}
        consoleLogAttach={consoleLogAttach}
        onConsoleLogToggle={() => {}}
        onConsoleLogClick={() => { (document.activeElement as HTMLElement)?.blur?.(); setConsoleDialogOpen(true); }}
        actionLog={attachedAction}
        onActionLogClick={() => { (document.activeElement as HTMLElement)?.blur?.(); setActionDialogOpen(true); }}
        readOnly
      />
    </Section>
  ) : null;

  const attachmentsBlock = attachmentsEnabled && attachments.length > 0 ? (
    <Section title={t("section.attachments")}>
      <AttachmentList
        attachments={attachments}
        onDownload={(m) =>
          void downloadAttachment(
            currentIssueId ?? `pending:${target?.tabId}`,
            m,
            target?.tabId != null ? `pending:${target.tabId}` : undefined,
          )
        }
      />
    </Section>
  ) : null;

  const handleCopyMarkdown = async () => {
    const resolved = await resolveSectionImages(draft.sections, issueSections);

    let ctx: MarkdownContext;
    if (isFreeformMode) {
      ctx = buildMarkdownContext({
        captureMode: "freeform",
        title: draft.title,
        resolvedSections: resolved,
        sectionConfig: issueSections,
        os,
        browser,
        url: target?.url ?? "",
        environment: draft.environment ?? [],
        viewport: useEditorStore.getState().freeformViewport,
        capturedAt: useEditorStore.getState().freeformCapturedAt ?? Date.now(),
        networkLogSummary: attachedNetwork ? buildNetworkLogSummary(attachedNetwork) : undefined,
        consoleLogSummary: attachedConsole ? buildConsoleLogSummary(attachedConsole) : undefined,
        actionLogCaptured: attachedAction ? attachedAction.captured : undefined,
      });
    } else if (isVideoMode) {
      ctx = buildMarkdownContext({
        captureMode: "video",
        title: draft.title,
        resolvedSections: resolved,
        sectionConfig: issueSections,
        os,
        browser,
        url: target?.url ?? "",
        environment: draft.environment ?? [],
        viewport: videoViewport ?? { width: 0, height: 0 },
        capturedAt: videoCapturedAt ?? Date.now(),
        networkLogSummary: attachedNetwork ? buildNetworkLogSummary(attachedNetwork) : undefined,
        consoleLogSummary: attachedConsole ? buildConsoleLogSummary(attachedConsole) : undefined,
        actionLogCaptured: attachedAction ? attachedAction.captured : undefined,
      });
    } else if (isElementMode && selection) {
      ctx = buildMarkdownContext({
        captureMode: "element",
        title: draft.title,
        resolvedSections: resolved,
        sectionConfig: issueSections,
        os,
        browser,
        url: target?.url ?? "",
        environment: draft.environment ?? [],
        selection: {
          selector: selection.selector,
          tagName: selection.tagName,
          classList: selection.classList,
          specifiedStyles: selection.specifiedStyles,
          viewport: selection.viewport,
          capturedAt: selection.capturedAt,
        },
        styleEditsClassList: styleEdits.classList,
        tokens,
        diffs,
        bufferedElements,
        mergeCurrent: { selection, styleEdits },
      });
    } else if (captureMode === "screenshot") {
      ctx = buildMarkdownContext({
        captureMode: "screenshot",
        title: draft.title,
        resolvedSections: resolved,
        sectionConfig: issueSections,
        os,
        browser,
        url: target?.url ?? "",
        environment: draft.environment ?? [],
        viewport: screenshotViewport ?? { width: 0, height: 0 },
        capturedAt: screenshotCapturedAt ?? Date.now(),
        selector: shotSelector?.selector,
        tagName: shotSelector?.tagName,
        networkLogSummary: attachedNetwork ? buildNetworkLogSummary(attachedNetwork) : undefined,
        consoleLogSummary: attachedConsole ? buildConsoleLogSummary(attachedConsole) : undefined,
        actionLogCaptured: attachedAction ? attachedAction.captured : undefined,
      });
    } else {
      return;
    }
    const md = buildIssueMarkdown(ctx);
    const html = buildIssueHtml(ctx);
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([md], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
    } catch {
      await navigator.clipboard.writeText(md);
    }
  };

  return (
    <PageShell>
      <PageScroll>
        <IssuePreviewView
          title={draft.title}
          envRows={envRows}
          sections={previewSections}
          labels={{
            untitled: t("common.untitled"),
            copyMarkdown: t("preview.copyMarkdown"),
            copied: t("preview.copied"),
            emptyValue: t("common.empty"),
            envTitle: t("section.env"),
            code: {
              expand: (lines) => t("codeBlock.expand", { count: lines }),
              collapse: t("codeBlock.collapse"),
              copy: t("codeBlock.copy"),
              copied: t("codeBlock.copied"),
            },
          }}
          onCopy={handleCopyMarkdown}
          media={mediaBlock}
          logCards={logCardsBlock}
          attachments={attachmentsBlock}
          postMediaSectionIds={POST_MEDIA_SECTION_IDS}
        />
      </PageScroll>
      {noPlatformConnected && (
        <IntegrationsCta onNavigate={() => navTo("integrations")} />
      )}
      <PageFooter>
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            onClick={() => reset()}
          >
            {t("preview.newIssue")}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              data-testid="back-to-draft"
              onClick={() => backToDraft()}
            >
              {t("common.back")}
            </Button>
            <IssueCreateModal />
          </div>
        </div>
      </PageFooter>
      {attachedNetwork && (
        <NetworkLogPreviewDialog
          open={networkDialogOpen}
          onOpenChange={setNetworkDialogOpen}
          requests={attachedNetwork.requests}
        />
      )}
      {attachedConsole && (
        <ConsoleLogPreviewDialog
          open={consoleDialogOpen}
          onOpenChange={setConsoleDialogOpen}
          entries={attachedConsole.entries}
          startedAt={attachedConsole.startedAt}
        />
      )}
      {attachedAction && (
        <ActionLogPreviewDialog
          open={actionDialogOpen}
          onOpenChange={setActionDialogOpen}
          entries={attachedAction.entries}
          startedAt={attachedAction.startedAt}
        />
      )}
    </PageShell>
  );
}

function PreviewVideo({ blob, thumbnail }: { blob: Blob | null; thumbnail: string | null }) {
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

  if (src)
    return (
      <div className="aspect-video w-full overflow-hidden rounded-lg border bg-black">
        <video src={src} controls className="h-full w-full object-contain" />
      </div>
    );
  if (thumbnail)
    return (
      <div className="aspect-video w-full overflow-hidden rounded-lg border bg-black">
        <img src={thumbnail} alt={t("alt.recordingThumbnail")} className="h-full w-full object-contain" />
      </div>
    );
  return null;
}
