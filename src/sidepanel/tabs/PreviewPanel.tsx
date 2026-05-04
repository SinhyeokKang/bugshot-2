import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Info } from "lucide-react";
import { formatTimestamp } from "../lib/formatTimestamp";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import {
  POST_MEDIA_SECTION_IDS,
  sectionLabelKey,
  useAppSettingsStore,
} from "@/store/app-settings-store";
import { useEditorStore } from "@/store/editor-store";
import { isJiraConfigComplete, useSettingsStore } from "@/store/settings-store";
import { DocSectionBody } from "../components/DocSectionBody";
import { LogAttachmentCards } from "../components/LogAttachmentCards";
import { NetworkLogPreviewDialog } from "../components/NetworkLogPreviewDialog";
import { ConsoleLogPreviewDialog } from "../components/ConsoleLogPreviewDialog";
import {
  PageFooter,
  PageScroll,
  PageShell,
  Section,
} from "../components/Section";
import {
  StyleChangesTable,
  buildStyleDiff,
} from "../components/StyleChangesTable";
import { buildIssueHtml, buildIssueMarkdown } from "../lib/buildIssueMarkdown";
import { buildNetworkLogSummary, buildConsoleLogSummary } from "../lib/buildLogSummary";
import { IssueCreateModal } from "./IssueCreateModal";


export function PreviewPanel() {
  const t = useT();
  const captureMode = useEditorStore((s) => s.captureMode);
  const selection = useEditorStore((s) => s.selection);
  const target = useEditorStore((s) => s.target);
  const styleEdits = useEditorStore((s) => s.styleEdits);
  const tokens = useEditorStore((s) => s.tokens);
  const beforeImage = useEditorStore((s) => s.beforeImage);
  const afterImage = useEditorStore((s) => s.afterImage);
  const screenshotAnnotated = useEditorStore((s) => s.screenshotAnnotated);
  const screenshotRaw = useEditorStore((s) => s.screenshotRaw);
  const screenshotViewport = useEditorStore((s) => s.screenshotViewport);
  const screenshotCapturedAt = useEditorStore((s) => s.screenshotCapturedAt);
  const videoBlob = useEditorStore((s) => s.videoBlob);
  const videoThumbnail = useEditorStore((s) => s.videoThumbnail);
  const videoViewport = useEditorStore((s) => s.videoViewport);
  const videoCapturedAt = useEditorStore((s) => s.videoCapturedAt);
  const draft = useEditorStore((s) => s.draft);
  const networkLog = useEditorStore((s) => s.networkLog);
  const networkLogAttach = useEditorStore((s) => s.networkLogAttach);
  const consoleLog = useEditorStore((s) => s.consoleLog);
  const consoleLogAttach = useEditorStore((s) => s.consoleLogAttach);
  const backToDraft = useEditorStore((s) => s.backToDraft);
  const reset = useEditorStore((s) => s.reset);
  const issueSections = useAppSettingsStore((s) => s.issueSections);
  const jiraConfig = useSettingsStore((s) => s.jiraConfig);
  const configured = isJiraConfigComplete(jiraConfig);
  const isElementMode = captureMode === "element";
  const isVideoMode = captureMode === "video";
  const screenshotImage = screenshotAnnotated ?? screenshotRaw;

  const diffs = useMemo(
    () => (selection ? buildStyleDiff(selection, styleEdits) : []),
    [selection, styleEdits],
  );

  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);

  const [networkDialogOpen, setNetworkDialogOpen] = useState(false);
  const [consoleDialogOpen, setConsoleDialogOpen] = useState(false);

  if (!draft) return null;
  if (isElementMode && !selection) return null;

  const attachedNetwork = networkLogAttach && networkLog && networkLog.captured > 0 ? networkLog : null;
  const attachedConsole = consoleLogAttach && consoleLog && consoleLog.captured > 0 ? consoleLog : null;
  const showLogCards = isVideoMode && (attachedNetwork !== null || attachedConsole !== null);

  const handleCopyMarkdown = async () => {
    let ctx: Parameters<typeof buildIssueMarkdown>[0];
    if (isVideoMode) {
      ctx = {
        captureMode: "video",
        title: draft.title,
        sections: draft.sections,
        sectionConfig: issueSections,
        url: target?.url ?? "",
        selector: "",
        tagName: "",
        classListBefore: [],
        classListAfter: [],
        specifiedStyles: {},
        tokens: [],
        viewport: videoViewport ?? { width: 0, height: 0 },
        capturedAt: videoCapturedAt ?? Date.now(),
        diffs: [],
        networkLogSummary: attachedNetwork ? buildNetworkLogSummary(attachedNetwork) : undefined,
        consoleLogSummary: attachedConsole ? buildConsoleLogSummary(attachedConsole) : undefined,
      };
    } else if (isElementMode && selection) {
      const changedProps = new Set(diffs.map((d) => d.prop));
      const relevantValues = Object.entries(selection.specifiedStyles)
        .filter(([k]) => changedProps.has(k))
        .map(([, v]) => v);
      const relevantTokens = tokens
        .filter((t) => relevantValues.some((v) => v.includes(t.name)))
        .map((t) => ({ name: t.name, value: t.value }));

      ctx = {
        title: draft.title,
        sections: draft.sections,
        sectionConfig: issueSections,
        url: target?.url ?? "",
        selector: selection.selector,
        tagName: selection.tagName,
        classListBefore: selection.classList,
        classListAfter: styleEdits.classList,
        specifiedStyles: selection.specifiedStyles,
        tokens: relevantTokens,
        viewport: selection.viewport,
        capturedAt: selection.capturedAt,
        diffs,
      };
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
    setCopied(true);
  };

  return (
    <PageShell>
      <PageScroll>
        <Section>
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-2xl font-semibold leading-tight">
              {draft.title || (
                <span className="text-muted-foreground/70">{t("common.untitled")}</span>
              )}
            </h1>
            {isElementMode || isVideoMode ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleCopyMarkdown()}
                className="shrink-0"
              >
                {copied ? <Check /> : <Copy />}
                {copied ? t("preview.copied") : t("preview.copyMarkdown")}
              </Button>
            ) : null}
          </div>
        </Section>

        {isElementMode && selection ? (
          <Section title={t("section.env")}>
            <EnvParagraph
              url={target?.url ?? ""}
              selector={selection.selector}
              viewport={selection.viewport}
              capturedAt={selection.capturedAt}
            />
          </Section>
        ) : (
          <Section title={t("section.env")}>
            <div className="space-y-1 text-sm leading-relaxed">
              <div className="flex gap-3">
                <span className="w-20 shrink-0 text-muted-foreground">Page</span>
                <span className="break-all">{target?.url || "-"}</span>
              </div>
              {(isVideoMode ? videoViewport : screenshotViewport) ? (
                <div className="flex gap-3">
                  <span className="w-20 shrink-0 text-muted-foreground">Viewport</span>
                  <span>
                    {isVideoMode
                      ? `${videoViewport!.width}×${videoViewport!.height}`
                      : `${screenshotViewport!.width}×${screenshotViewport!.height}`}
                  </span>
                </div>
              ) : null}
              {(isVideoMode ? videoCapturedAt : screenshotCapturedAt) ? (
                <div className="flex gap-3">
                  <span className="w-20 shrink-0 text-muted-foreground">Captured</span>
                  <span>{formatTimestamp((isVideoMode ? videoCapturedAt : screenshotCapturedAt)!)}</span>
                </div>
              ) : null}
            </div>
          </Section>
        )}

        {(() => {
          const enabled = issueSections.filter((s) => s.enabled);
          let mediaInserted = false;
          const mediaBlock = isVideoMode ? (
            <Section key="__media" title={t("section.media")}>
              <PreviewVideo blob={videoBlob} thumbnail={videoThumbnail} />
            </Section>
          ) : isElementMode ? (
            <Section key="__media" title={t("section.styleChanges")}>
              <StyleChangesTable
                beforeImage={beforeImage}
                afterImage={afterImage}
                diffs={diffs}
              />
            </Section>
          ) : (
            <Section key="__media" title={t("section.media")}>
              {screenshotImage ? (
                <div className="aspect-video w-full overflow-hidden rounded-lg border bg-muted/70">
                  <img
                    src={screenshotImage}
                    alt="Captured image"
                    className="h-full w-full object-contain"
                  />
                </div>
              ) : null}
            </Section>
          );
          const logCardsBlock = showLogCards ? (
            <Section key="__logCards" title={t("section.logs")}>
              <LogAttachmentCards
                networkLog={attachedNetwork}
                networkLogAttach={networkLogAttach}
                onNetworkLogToggle={() => {}}
                onNetworkLogClick={() => setNetworkDialogOpen(true)}
                consoleLog={attachedConsole}
                consoleLogAttach={consoleLogAttach}
                onConsoleLogToggle={() => {}}
                onConsoleLogClick={() => setConsoleDialogOpen(true)}
                readOnly
              />
            </Section>
          ) : null;
          const out: React.ReactNode[] = [];
          for (const sec of enabled) {
            if (POST_MEDIA_SECTION_IDS.has(sec.id) && !mediaInserted) {
              mediaInserted = true;
              out.push(mediaBlock);
              if (logCardsBlock) out.push(logCardsBlock);
            }
            const value = draft.sections[sec.id] ?? "";
            const label = sec.labelOverride?.trim() || t(sectionLabelKey(sec.id));
            out.push(
              <Section key={sec.id} title={label}>
                <DocSectionBody section={sec} value={value} />
              </Section>,
            );
          }
          if (!mediaInserted) {
            out.push(mediaBlock);
            if (logCardsBlock) out.push(logCardsBlock);
          }
          return out;
        })()}
      </PageScroll>
      <PageFooter>
        {!configured ? (
          <Alert variant="ghost" className="mb-2">
            <Info className="h-4 w-4" />
            <AlertTitle>{t("jira.notConnected.title")}</AlertTitle>
            <AlertDescription>
              {t("jira.notConnected.body")}
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <Button
            size="lg"
            variant="outline"
            onClick={() => reset()}
          >
            {t("preview.newIssue")}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              size="lg"
              variant="outline"
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
    </PageShell>
  );
}

function PreviewVideo({ blob, thumbnail }: { blob: Blob | null; thumbnail: string | null }) {
  const urlRef = useRef<string | null>(null);
  const src = blob ? (urlRef.current ??= URL.createObjectURL(blob)) : null;

  useEffect(() => {
    return () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, []);

  if (src) return <video src={src} controls className="w-full rounded-lg border" />;
  if (thumbnail) return <img src={thumbnail} alt="Recording thumbnail" className="w-full rounded-lg border" />;
  return null;
}

function EnvParagraph({
  url,
  selector,
  viewport,
  capturedAt,
}: {
  url: string;
  selector: string;
  viewport: { width: number; height: number };
  capturedAt: number;
}) {
  const rows: { label: string; value: string }[] = [
    { label: "Page", value: url || "-" },
    { label: "DOM", value: selector },
    { label: "Viewport", value: `${viewport.width}×${viewport.height}` },
    { label: "Captured", value: formatTimestamp(capturedAt) },
  ];
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {rows.map((r) => (
        <div key={r.label} className="flex gap-3">
          <span className="w-20 shrink-0 text-muted-foreground">{r.label}</span>
          <span className="break-all">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

