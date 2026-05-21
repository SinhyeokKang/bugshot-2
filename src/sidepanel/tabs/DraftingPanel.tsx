import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Camera, ImageIcon, ImagePlus, Pencil, Plus, RotateCcw, Trash2, WandSparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { clearPicker, startInlineAreaCapture } from "@/sidepanel/picker-control";
import { CancelConfirmDialog } from "@/sidepanel/components/CancelConfirmDialog";
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
import {
  deriveReadonlyEnvRows,
  filterEnvironmentRows,
  type EnvironmentRow,
} from "@/sidepanel/lib/environmentRows";
import { AiDraftDialog } from "./AiDraftDialog";

const LazyTiptapEditor = lazy(() => import("../components/TiptapEditor"));
const AnnotationOverlay = lazy(() => import("../components/AnnotationOverlay"));

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
  const issueSections = useSettingsUiStore((s) => s.issueSections);
  const { status: aiStatus, providerLabel, createSession } = useAI();
  const [annotating, setAnnotating] = useState(false);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const aiDraftLoading = useEditorStore((s) => s.aiDraftLoading);
  const [networkDialogOpen, setNetworkDialogOpen] = useState(false);
  const [consoleDialogOpen, setConsoleDialogOpen] = useState(false);
  const titlePrefix = useSettingsStore((s) => s.titlePrefix);
  const inlineCaptureTarget = useEditorStore((s) => s.inlineCaptureTarget);
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
      environment: [],
    });
  }, [draft, selection, setDraft, titlePrefix, captureMode, screenshotImage, videoThumbnail, videoBlob]);

  if (!draft) return null;
  if (captureMode === "element" && !selection) return null;
  if (captureMode === "screenshot" && !screenshotImage) return null;
  if (captureMode === "video" && !videoThumbnail && !videoBlob) return null;

  const titleMissing = !draft.title.trim();

  const showLogCards = captureMode !== "element" && (
    (networkLog !== null && networkLog.captured > 0) ||
    (consoleLog !== null && consoleLog.captured > 0)
  );

  const enabledSections = issueSections.filter((s) => s.enabled);

  const isFreeformMode = captureMode === "freeform";

  const mediaBlock = isFreeformMode ? null : isVideoMode ? (
    <Section key="__media" title={t("section.media")} collapsible>
      <VideoPreview blob={videoBlob} thumbnail={videoThumbnail} />
    </Section>
  ) : isElementMode ? (
    <Section key="__media" title={t("section.styleChanges")} collapsible>
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
    <Section key="__logCards" title={t("section.logs")} collapsible>
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
      {inlineCaptureTarget ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-5 text-center">
          <div className="mb-3 rounded-full bg-muted p-3">
            <ImageIcon className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-[18px] font-semibold">{t("issue.capturing.title")}</h3>
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
              />
            </Section>

            <ReproEnvironmentSection />

            {sectionNodes}
          </PageScroll>
          {aiStatus === "available" && (
            <button
              className="flex items-center justify-between rounded-t-lg bg-purple-100/80 px-3.5 py-2.5 text-purple-700 transition-colors hover:bg-purple-100 disabled:opacity-50 dark:bg-purple-950/50 dark:text-purple-300 dark:hover:bg-purple-900"
              onClick={() => setAiDialogOpen(true)}
              disabled={aiDraftLoading}
            >
              <span className="flex items-center gap-1.5">
                <Badge variant="outline" className="font-normal border-purple-500 text-purple-600 dark:border-purple-400 dark:text-purple-300">{providerLabel ?? t("ai.badge.beta")}</Badge>
                <span className="bg-gradient-to-r from-purple-500 to-indigo-500 bg-clip-text text-sm text-transparent dark:from-purple-300 dark:to-indigo-300">{t("draft.aiBanner")}</span>
              </span>
              <span className="flex items-center gap-1 bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-sm font-medium text-transparent dark:from-indigo-300 dark:to-purple-300">
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
                    confirmDraft();
                  }}
                  disabled={titleMissing || aiDraftLoading}
                >
                  {t("draft.preview")}
                </Button>
              </div>
            </div>
          </PageFooter>
        </>
      )}
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
      <AiDraftDialog
        open={aiDialogOpen}
        onOpenChange={setAiDialogOpen}
        createSession={createSession}
        elementDiffs={isElementMode ? diffs : undefined}
      />
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

function ReproEnvironmentSection() {
  const t = useT();
  const target = useEditorStore((s) => s.target);
  const captureMode = useEditorStore((s) => s.captureMode);
  const selection = useEditorStore((s) => s.selection);
  const videoViewport = useEditorStore((s) => s.videoViewport);
  const videoCapturedAt = useEditorStore((s) => s.videoCapturedAt);
  const screenshotViewport = useEditorStore((s) => s.screenshotViewport);
  const screenshotCapturedAt = useEditorStore((s) => s.screenshotCapturedAt);
  const freeformViewport = useEditorStore((s) => s.freeformViewport);
  const freeformCapturedAt = useEditorStore((s) => s.freeformCapturedAt);
  const draft = useEditorStore((s) => s.draft);
  const setDraft = useEditorStore((s) => s.setDraft);

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
    url: target?.url ?? "",
    selector: captureMode === "element" ? selection?.selector : null,
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
              className="h-9 w-9 shrink-0 text-muted-foreground"
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
              className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
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
}: {
  section: IssueSection;
  value: string;
  onChange: (next: string) => void;
}) {
  const t = useT();
  const label = section.labelOverride?.trim() || t(sectionLabelKey(section.id));
  const placeholder =
    section.placeholderOverride?.trim() || t(sectionPlaceholderKey(section.id));

  const editorRef = useRef<import("../components/TiptapEditor").TiptapEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isParagraph = section.renderAs !== "orderedList";
  const aiLoading = useEditorStore((s) => s.aiDraftLoading);

  return (
    <Section
      title={label}
      collapsible
      action={
        isParagraph ? (
          <>
            <input
              ref={fileInputRef}
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
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8 shrink-0"
              title={t("draft.captureArea")}
              disabled={aiLoading}
              onClick={() => {
                useEditorStore.getState().startInlineCapture(section.id);
                const tabId = useEditorStore.getState().target?.tabId;
                if (tabId) void startInlineAreaCapture(tabId);
              }}
            >
              <Camera />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8 shrink-0"
              title={t("draft.addImage")}
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus />
            </Button>
          </>
        ) : undefined
      }
    >
      {section.renderAs === "orderedList" ? (
        <OrderedListEditor value={value} onChange={onChange} placeholder={placeholder} />
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

export function defaultTitle(prefix: string): string {
  if (!prefix) return "";
  return prefix.endsWith(" ") ? prefix : `${prefix} `;
}

