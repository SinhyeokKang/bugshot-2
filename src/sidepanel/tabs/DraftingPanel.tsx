import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n";
import {
  POST_MEDIA_SECTION_IDS,
  sectionLabelKey,
  sectionPlaceholderKey,
  useAppSettingsStore,
  type IssueSection,
} from "@/store/app-settings-store";
import { useEditorStore } from "@/store/editor-store";
import { useSettingsStore } from "@/store/settings-store";
import { useBoundTabId } from "../hooks/useBoundTabId";
import { useChromeAI } from "../hooks/useChromeAI";
import { clearPicker } from "../picker-control";
const AnnotationOverlay = lazy(() => import("../components/AnnotationOverlay"));
import { CancelConfirmDialog } from "../components/CancelConfirmDialog";
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
import { buildAiDraftPrompt, parseAiDraftResponse } from "../lib/buildAiDraftPrompt";
import { buildNetworkLogSummary, buildConsoleLogSummary } from "../lib/buildLogSummary";

export function DraftingPanel() {
  const t = useT();
  const tabId = useBoundTabId();
  const captureMode = useEditorStore((s) => s.captureMode);
  const selection = useEditorStore((s) => s.selection);
  const styleEdits = useEditorStore((s) => s.styleEdits);
  const beforeImage = useEditorStore((s) => s.beforeImage);
  const afterImage = useEditorStore((s) => s.afterImage);
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
  const networkLogAttach = useEditorStore((s) => s.networkLogAttach);
  const setNetworkLogAttach = useEditorStore((s) => s.setNetworkLogAttach);
  const consoleLog = useEditorStore((s) => s.consoleLog);
  const consoleLogAttach = useEditorStore((s) => s.consoleLogAttach);
  const setConsoleLogAttach = useEditorStore((s) => s.setConsoleLogAttach);
  const target = useEditorStore((s) => s.target);
  const tokens = useEditorStore((s) => s.tokens);
  const issueSections = useAppSettingsStore((s) => s.issueSections);
  const locale = useAppSettingsStore((s) => s.locale);
  const { status: aiStatus, generateDraft } = useChromeAI();
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [annotating, setAnnotating] = useState(false);
  const [networkDialogOpen, setNetworkDialogOpen] = useState(false);
  const [consoleDialogOpen, setConsoleDialogOpen] = useState(false);
  const titlePrefix = useSettingsStore(
    (s) => s.accounts.jira?.titlePrefix ?? "",
  );
  const isElementMode = captureMode === "element";
  const isVideoMode = captureMode === "video";
  const screenshotImage = screenshotAnnotated ?? screenshotRaw;

  const diffs = useMemo(
    () => (selection ? buildStyleDiff(selection, styleEdits) : []),
    [selection, styleEdits],
  );

  useEffect(() => {
    if (draft) return;
    if (captureMode === "element" && !selection) return;
    if (captureMode === "screenshot" && !screenshotImage) return;
    if (captureMode === "video" && !videoThumbnail && !videoBlob) return;
    setDraft({
      title: defaultTitle(titlePrefix),
      sections: {},
    });
  }, [draft, selection, setDraft, titlePrefix, captureMode, screenshotImage, videoThumbnail, videoBlob]);

  useEffect(() => {
    if (!aiError) return;
    const id = setTimeout(() => setAiError(null), 3000);
    return () => clearTimeout(id);
  }, [aiError]);

  if (!draft) return null;
  if (captureMode === "element" && !selection) return null;
  if (captureMode === "screenshot" && !screenshotImage) return null;
  if (captureMode === "video" && !videoThumbnail && !videoBlob) return null;

  const titleMissing = !draft.title.trim();

  const showLogCards = isVideoMode && (
    (networkLog !== null && networkLog.captured > 0) ||
    (consoleLog !== null && consoleLog.captured > 0)
  );

  const enabledSections = issueSections.filter((s) => s.enabled);

  const handleAIDraft = async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const ctx = buildAiDraftPrompt({
        captureMode,
        locale,
        url: target?.url ?? "",
        pageTitle: target?.title ?? "",
        selector: selection?.selector,
        tagName: selection?.tagName,
        diffs: diffs.length > 0 ? diffs : undefined,
        tokens: tokens.length > 0
          ? tokens.map((tk) => ({ name: tk.name, value: tk.value }))
          : undefined,
        networkLogSummary:
          networkLog && networkLog.captured > 0
            ? buildNetworkLogSummary(networkLog)
            : undefined,
        consoleLogSummary:
          consoleLog && consoleLog.captured > 0
            ? buildConsoleLogSummary(consoleLog)
            : undefined,
        enabledSections: enabledSections.map((s) => ({
          id: s.id,
          renderAs: s.renderAs,
        })),
      });
      const raw = await generateDraft(ctx);
      const parsed = parseAiDraftResponse(
        raw,
        enabledSections.map((s) => s.id),
      );
      if (parsed) {
        const prefix = defaultTitle(titlePrefix);
        const aiTitle = prefix
          ? prefix + parsed.title
          : parsed.title;
        setDraft({ ...parsed, title: aiTitle });
      } else {
        setAiError(t("draft.aiParseError"));
      }
    } catch {
      setAiError(t("draft.aiError"));
    } finally {
      setAiLoading(false);
    }
  };

  const mediaBlock = isVideoMode ? (
    <Section key="__media" title={t("section.media")}>
      <VideoPreview blob={videoBlob} thumbnail={videoThumbnail} />
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
    <Section
      key="__media"
      title={t("section.media")}
      action={
        screenshotImage ? (
          <>
            {screenshotAnnotated ? (
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8 shrink-0"
                title={t("draft.removeAnnotation")}
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
              onClick={() => setAnnotating(true)}
            >
              <Pencil />
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
          />
        </div>
      ) : null}
    </Section>
  );

  const logCardsBlock = showLogCards ? (
    <Section key="__logCards" title={t("section.logs")}>
      <LogAttachmentCards
        networkLog={networkLog}
        networkLogAttach={networkLogAttach}
        onNetworkLogToggle={setNetworkLogAttach}
        onNetworkLogClick={() => setNetworkDialogOpen(true)}
        consoleLog={consoleLog}
        consoleLogAttach={consoleLogAttach}
        onConsoleLogToggle={setConsoleLogAttach}
        onConsoleLogClick={() => setConsoleDialogOpen(true)}
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
      />,
    );
  }
  if (!mediaInserted) {
    sectionNodes.push(mediaBlock);
    if (logCardsBlock) sectionNodes.push(logCardsBlock);
  }

  return (
    <PageShell className="relative">
      {aiLoading && (
        <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
          <div className="absolute inset-0 bg-purple-500/5" />
          <div className="absolute inset-0 animate-shimmer bg-gradient-to-b from-transparent via-purple-400/10 to-transparent" />
        </div>
      )}
      {aiError && (
        <div className="absolute bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive shadow-sm">
          {aiError}
        </div>
      )}
      <PageScroll>
        <Section title={t("section.issueTitle")}>
          <Input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            onFocus={cursorToEnd}
            placeholder={t("draft.titlePlaceholder")}
          />
        </Section>

        {sectionNodes}
      </PageScroll>
      {aiStatus === "available" && captureMode !== "screenshot" && (
        <button
          className="flex items-center justify-between rounded-t-lg bg-purple-100/80 px-3.5 py-2.5 text-purple-700 transition-colors hover:bg-purple-100 disabled:opacity-50 dark:bg-purple-950/50 dark:text-purple-300 dark:hover:bg-purple-900"
          onClick={() => void handleAIDraft()}
          disabled={aiLoading}
        >
          <span className="bg-gradient-to-r from-purple-500 to-indigo-500 bg-clip-text text-sm text-transparent dark:from-purple-300 dark:to-indigo-300">{t("draft.aiBanner")}</span>
          <span className="flex items-center gap-1 bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-sm font-medium text-transparent dark:from-indigo-300 dark:to-purple-300">
            <Sparkles className="h-4 w-4 fill-current text-purple-500 dark:text-purple-300" />
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
                size="lg"
                variant="outline"
                onClick={() => backToStyling()}
              >
                {t("common.back")}
              </Button>
            ) : null}
            <Button
              size="lg"
              onClick={() => {
                setAnnotating(false);
                confirmDraft();
              }}
              disabled={titleMissing || aiLoading}
            >
              {t("draft.preview")}
            </Button>
          </div>
        </div>
      </PageFooter>
      {networkLog && (
        <NetworkLogPreviewDialog
          open={networkDialogOpen}
          onOpenChange={setNetworkDialogOpen}
          requests={networkLog.requests}
          attach={networkLogAttach}
          onToggleAttach={setNetworkLogAttach}
        />
      )}
      {consoleLog && (
        <ConsoleLogPreviewDialog
          open={consoleDialogOpen}
          onOpenChange={setConsoleDialogOpen}
          entries={consoleLog.entries}
          startedAt={consoleLog.startedAt}
          attach={consoleLogAttach}
          onToggleAttach={setConsoleLogAttach}
        />
      )}
      {annotating && screenshotRaw ? (
        <Suspense fallback={null}>
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

function SectionTextarea({
  section,
  value,
  onChange,
}: {
  section: IssueSection;
  value: string;
  onChange: (next: string) => void;
}) {
  const t = useT();
  const label = section.labelOverride?.trim() || t(sectionLabelKey(section.id));
  const placeholder =
    section.placeholderOverride?.trim() || t(sectionPlaceholderKey(section.id));
  return (
    <Section title={label}>
      {section.renderAs === "orderedList" ? (
        <OrderedListEditor value={value} onChange={onChange} placeholder={placeholder} />
      ) : (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={cursorToEnd}
          placeholder={placeholder}
          className="min-h-32 resize-none text-sm [field-sizing:content]"
        />
      )}
    </Section>
  );
}

function OrderedListEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  const t = useT();
  const items = value.length === 0 ? [""] : value.split(/\r?\n/);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const focusIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (focusIndexRef.current == null) return;
    const idx = focusIndexRef.current;
    focusIndexRef.current = null;
    const el = inputsRef.current[idx];
    if (el) {
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, [value]);

  const commit = (next: string[], focusIdx?: number) => {
    if (focusIdx != null) focusIndexRef.current = focusIdx;
    onChange(next.join("\n"));
  };

  const updateItem = (idx: number, text: string) => {
    const next = [...items];
    next[idx] = text;
    commit(next);
  };

  const addAfter = (idx: number) => {
    const next = [...items];
    next.splice(idx + 1, 0, "");
    commit(next, idx + 1);
  };

  const removeAt = (idx: number) => {
    if (items.length <= 1) return;
    const next = items.filter((_, i) => i !== idx);
    commit(next, Math.max(0, idx - 1));
  };

  return (
    <ol className="flex list-none flex-col gap-1.5">
      {items.map((item, idx) => (
        <li key={idx} className="flex items-center gap-3">
          <Badge
            variant="secondary"
            className="h-5 w-5 shrink-0 justify-center rounded-full p-0 tabular-nums"
          >
            {idx + 1}
          </Badge>
          <div className="flex flex-1 items-center gap-1">
            <Input
              ref={(el) => {
                inputsRef.current[idx] = el;
              }}
              value={item}
              onChange={(e) => updateItem(idx, e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Enter") {
                  e.preventDefault();
                  addAfter(idx);
                } else if (
                  e.key === "Backspace" &&
                  item === "" &&
                  items.length > 1
                ) {
                  e.preventDefault();
                  removeAt(idx);
                }
              }}
              placeholder={idx === 0 ? placeholder : undefined}
              className="text-sm"
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
              disabled={items.length <= 1}
              onClick={() => removeAt(idx)}
              title={t("common.delete")}
            >
              <Trash2 />
            </Button>
          </div>
        </li>
      ))}
    </ol>
  );
}

function VideoPreview({ blob, thumbnail }: { blob: Blob | null; thumbnail: string | null }) {
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

  return (
    <div className="space-y-1.5">
      {src ? (
        <video src={src} controls className="w-full rounded-lg border" />
      ) : thumbnail ? (
        <img src={thumbnail} alt="Recording thumbnail" className="w-full rounded-lg border" />
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

function defaultTitle(prefix: string): string {
  if (!prefix) return "";
  return prefix.endsWith(" ") ? prefix : `${prefix} `;
}

