import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, RotateCcw, Trash2 } from "lucide-react";
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
import { clearPicker } from "../picker-control";
const AnnotationOverlay = lazy(() => import("../components/AnnotationOverlay"));
import { CancelConfirmDialog } from "../components/CancelConfirmDialog";
import { NetworkLogToggle } from "../components/NetworkLogToggle";
import { NetworkLogPreviewDialog } from "../components/NetworkLogPreviewDialog";
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
  const networkLogSelectedIds = useEditorStore((s) => s.networkLogSelectedIds);
  const setNetworkLogAttach = useEditorStore((s) => s.setNetworkLogAttach);
  const setNetworkLogSelectedIds = useEditorStore((s) => s.setNetworkLogSelectedIds);
  const issueSections = useAppSettingsStore((s) => s.issueSections);
  const [annotating, setAnnotating] = useState(false);
  const [networkDialogOpen, setNetworkDialogOpen] = useState(false);
  const titlePrefix = useSettingsStore(
    (s) => s.jiraConfig?.titlePrefix ?? "",
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

  if (!draft) return null;
  if (captureMode === "element" && !selection) return null;
  if (captureMode === "screenshot" && !screenshotImage) return null;
  if (captureMode === "video" && !videoThumbnail && !videoBlob) return null;

  const titleMissing = !draft.title.trim();

  const showNetworkToggle = isVideoMode && networkLog !== null;
  const networkDisabled = !networkLog || networkLog.captured === 0;

  const handleNetworkToggle = (on: boolean) => {
    setNetworkLogAttach(on);
    if (on && networkLog && networkLogSelectedIds.length === 0) {
      const errorIds = networkLog.requests
        .filter((r) => r.status >= 400)
        .map((r) => r.id);
      setNetworkLogSelectedIds(errorIds.length > 0 ? errorIds : networkLog.requests.map((r) => r.id));
      setNetworkDialogOpen(true);
    }
  };

  const handleNetworkDialogClose = (open: boolean) => {
    setNetworkDialogOpen(open);
    if (!open && networkLogSelectedIds.length === 0) {
      setNetworkLogAttach(false);
    }
  };

  const enabledSections = issueSections.filter((s) => s.enabled);
  const mediaBlock = isVideoMode ? (
    <Section key="__media" title={t("section.media")}>
      <VideoPreview blob={videoBlob} thumbnail={videoThumbnail} />
      {showNetworkToggle && (
        <div className="mt-3">
          <NetworkLogToggle
            captured={networkLog.captured}
            selectedCount={networkLogSelectedIds.length}
            attach={networkLogAttach}
            disabled={networkDisabled}
            onToggle={handleNetworkToggle}
            onPreview={() => setNetworkDialogOpen(true)}
          />
        </div>
      )}
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

  const sectionNodes: React.ReactNode[] = [];
  let mediaInserted = false;
  for (const sec of enabledSections) {
    if (POST_MEDIA_SECTION_IDS.has(sec.id) && !mediaInserted) {
      mediaInserted = true;
      sectionNodes.push(mediaBlock);
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
  if (!mediaInserted) sectionNodes.push(mediaBlock);

  return (
    <PageShell>
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
              disabled={titleMissing}
            >
              {t("draft.preview")}
            </Button>
          </div>
        </div>
      </PageFooter>
      {showNetworkToggle && networkLog && (
        <NetworkLogPreviewDialog
          open={networkDialogOpen}
          onOpenChange={handleNetworkDialogClose}
          requests={networkLog.requests}
          selectedIds={networkLogSelectedIds}
          onSelectedIdsChange={setNetworkLogSelectedIds}
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

