import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Info } from "lucide-react";
import { formatTimestamp } from "@/sidepanel/lib/formatTimestamp";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import {
  POST_MEDIA_SECTION_IDS,
  sectionLabelKey,
  useSettingsUiStore,
} from "@/store/settings-ui-store";
import { useEditorStore } from "@/store/editor-store";
import { connectedPlatforms, useSettingsStore } from "@/store/settings-store";
import { DocSectionBody } from "@/sidepanel/components/DocSectionBody";
import { LogAttachmentCards } from "@/sidepanel/components/LogAttachmentCards";
import { NetworkLogPreviewDialog } from "@/sidepanel/components/NetworkLogPreviewDialog";
import { ConsoleLogPreviewDialog } from "@/sidepanel/components/ConsoleLogPreviewDialog";
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
import { buildIssueHtml, buildIssueMarkdown } from "@/sidepanel/lib/buildIssueMarkdown";
import { filterEnvironmentRows, parseChromeVersion } from "@/sidepanel/lib/environmentRows";
import { getOsInfo } from "@/sidepanel/lib/osInfo";
import { buildNetworkLogSummary, buildConsoleLogSummary } from "@/sidepanel/lib/buildLogSummary";
import { resolveInlineImages } from "@/sidepanel/lib/resolveInlineImages";
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
  const issueSections = useSettingsUiStore((s) => s.issueSections);
  const accounts = useSettingsStore((s) => s.accounts);
  const noPlatformConnected = useMemo(
    () => connectedPlatforms(accounts).length === 0,
    [accounts],
  );
  const isElementMode = captureMode === "element";
  const isVideoMode = captureMode === "video";
  const isFreeformMode = captureMode === "freeform";
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

  const os = getOsInfo();
  const browser = parseChromeVersion(navigator.userAgent);

  if (!draft) return null;
  if (isElementMode && !selection) return null;

  const attachedNetwork = networkLogAttach && networkLog && networkLog.captured > 0 ? networkLog : null;
  const attachedConsole = consoleLogAttach && consoleLog && consoleLog.captured > 0 ? consoleLog : null;
  const showLogCards = (isVideoMode || isFreeformMode) && (attachedNetwork !== null || attachedConsole !== null);

  const handleCopyMarkdown = async () => {
    const resolvedSections = { ...draft.sections };
    await Promise.all(
      issueSections
        .filter((s) => s.enabled && s.renderAs === "paragraph")
        .map(async (s) => {
          const content = resolvedSections[s.id];
          if (!content?.includes("inline:")) return;
          const { resolved } = await resolveInlineImages(content);
          resolvedSections[s.id] = resolved;
        }),
    );

    let ctx: Parameters<typeof buildIssueMarkdown>[0];
    if (isFreeformMode) {
      ctx = {
        os,
        browser,
        captureMode: "freeform",
        title: draft.title,
        sections: resolvedSections,
        sectionConfig: issueSections,
        url: target?.url ?? "",
        selector: "",
        tagName: "",
        classListBefore: [],
        classListAfter: [],
        specifiedStyles: {},
        tokens: [],
        viewport: useEditorStore.getState().freeformViewport,
        capturedAt: useEditorStore.getState().freeformCapturedAt ?? Date.now(),
        diffs: [],
        environment: draft.environment ?? [],
        networkLogSummary: attachedNetwork ? buildNetworkLogSummary(attachedNetwork) : undefined,
        consoleLogSummary: attachedConsole ? buildConsoleLogSummary(attachedConsole) : undefined,
      };
    } else if (isVideoMode) {
      ctx = {
        os,
        browser,
        captureMode: "video",
        title: draft.title,
        sections: resolvedSections,
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
        environment: draft.environment ?? [],
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
        os,
        browser,
        title: draft.title,
        sections: resolvedSections,
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
        environment: draft.environment ?? [],
      };
    } else if (captureMode === "screenshot") {
      ctx = {
        os,
        browser,
        captureMode: "screenshot",
        title: draft.title,
        sections: resolvedSections,
        sectionConfig: issueSections,
        url: target?.url ?? "",
        selector: "",
        tagName: "",
        classListBefore: [],
        classListAfter: [],
        specifiedStyles: {},
        tokens: [],
        viewport: screenshotViewport ?? { width: 0, height: 0 },
        capturedAt: screenshotCapturedAt ?? Date.now(),
        diffs: [],
        environment: draft.environment ?? [],
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleCopyMarkdown()}
              className="shrink-0"
            >
              {copied ? <Check /> : <Copy />}
              {copied ? t("preview.copied") : t("preview.copyMarkdown")}
            </Button>
          </div>
        </Section>

        {isElementMode && selection ? (
          <Section title={t("section.env")}>
            <EnvParagraph
              os={os}
              browser={browser}
              url={target?.url ?? ""}
              selector={selection.selector}
              viewport={selection.viewport}
              capturedAt={selection.capturedAt}
              customRows={filterEnvironmentRows(draft.environment ?? [])}
            />
          </Section>
        ) : (
          <NonElementEnvSection />
        )}

        {(() => {
          const enabled = issueSections.filter((s) => s.enabled);
          let mediaInserted = false;
          const mediaBlock = isFreeformMode ? null : isVideoMode ? (
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
                onNetworkLogClick={() => { (document.activeElement as HTMLElement)?.blur?.(); setNetworkDialogOpen(true); }}
                consoleLog={attachedConsole}
                consoleLogAttach={consoleLogAttach}
                onConsoleLogToggle={() => {}}
                onConsoleLogClick={() => { (document.activeElement as HTMLElement)?.blur?.(); setConsoleDialogOpen(true); }}
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
        {noPlatformConnected ? (
          <Alert variant="default" className="mb-2">
            <Info className="h-4 w-4" />
            <AlertTitle>{t("platform.empty.title")}</AlertTitle>
            <AlertDescription>{t("platform.empty.body")}</AlertDescription>
          </Alert>
        ) : null}
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
        <img src={thumbnail} alt="Recording thumbnail" className="h-full w-full object-contain" />
      </div>
    );
  return null;
}

function NonElementEnvSection() {
  const t = useT();
  const target = useEditorStore((s) => s.target);
  const draft = useEditorStore((s) => s.draft);
  const captureMode = useEditorStore((s) => s.captureMode);
  const videoViewport = useEditorStore((s) => s.videoViewport);
  const videoCapturedAt = useEditorStore((s) => s.videoCapturedAt);
  const screenshotViewport = useEditorStore((s) => s.screenshotViewport);
  const screenshotCapturedAt = useEditorStore((s) => s.screenshotCapturedAt);
  const freeformViewport = useEditorStore((s) => s.freeformViewport);
  const freeformCapturedAt = useEditorStore((s) => s.freeformCapturedAt);

  const viewport =
    captureMode === "video" ? videoViewport
    : captureMode === "freeform" ? freeformViewport
    : screenshotViewport;
  const capturedAt =
    captureMode === "video" ? videoCapturedAt
    : captureMode === "freeform" ? freeformCapturedAt
    : screenshotCapturedAt;

  const os = getOsInfo();
  const browser = parseChromeVersion(navigator.userAgent);

  return (
    <Section title={t("section.env")}>
      <div className="space-y-1 text-sm leading-relaxed">
        {os ? (
          <div className="flex gap-3">
            <span className="w-20 shrink-0 text-muted-foreground">OS</span>
            <span className="break-all">{os}</span>
          </div>
        ) : null}
        {browser ? (
          <div className="flex gap-3">
            <span className="w-20 shrink-0 text-muted-foreground">Browser</span>
            <span className="break-all">{browser}</span>
          </div>
        ) : null}
        <div className="flex gap-3">
          <span className="w-20 shrink-0 text-muted-foreground">Page</span>
          <span className="break-all">{target?.url || "-"}</span>
        </div>
        {viewport ? (
          <div className="flex gap-3">
            <span className="w-20 shrink-0 text-muted-foreground">Viewport</span>
            <span>{`${viewport.width}×${viewport.height}`}</span>
          </div>
        ) : null}
        {capturedAt ? (
          <div className="flex gap-3">
            <span className="w-20 shrink-0 text-muted-foreground">Captured</span>
            <span>{formatTimestamp(capturedAt)}</span>
          </div>
        ) : null}
        {filterEnvironmentRows(draft?.environment ?? []).map((r, i) => (
          <div key={`custom-${i}`} className="flex gap-3">
            <span className="w-20 shrink-0 text-muted-foreground break-all">
              {r.label}
            </span>
            <span className="break-all">{r.value}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

function EnvParagraph({
  os,
  browser,
  url,
  selector,
  viewport,
  capturedAt,
  customRows,
}: {
  os?: string | null;
  browser?: string | null;
  url: string;
  selector: string;
  viewport: { width: number; height: number };
  capturedAt: number;
  customRows: { label: string; value: string }[];
}) {
  const rows: { label: string; value: string }[] = [
    ...(os ? [{ label: "OS", value: os }] : []),
    ...(browser ? [{ label: "Browser", value: browser }] : []),
    { label: "Page", value: url || "-" },
    { label: "DOM", value: selector },
    { label: "Viewport", value: `${viewport.width}×${viewport.height}` },
    { label: "Captured", value: formatTimestamp(capturedAt) },
    ...customRows,
  ];
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {rows.map((r, i) => (
        <div key={`${r.label}-${i}`} className="flex gap-3">
          <span className="w-20 shrink-0 text-muted-foreground">{r.label}</span>
          <span className="break-all">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

