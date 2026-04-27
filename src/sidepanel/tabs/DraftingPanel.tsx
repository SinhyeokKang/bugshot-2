import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n";
import { useEditorStore } from "@/store/editor-store";
import { useSettingsStore } from "@/store/settings-store";
import { useBoundTabId } from "../hooks/useBoundTabId";
import { clearPicker } from "../picker-control";
const AnnotationOverlay = lazy(() => import("../components/AnnotationOverlay"));
import { CancelConfirmDialog } from "../components/CancelConfirmDialog";
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
  const [annotating, setAnnotating] = useState(false);
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
      body: "",
      expectedResult: "",
    });
  }, [draft, selection, setDraft, titlePrefix, captureMode, screenshotImage, videoThumbnail]);

  if (!draft) return null;
  if (captureMode === "element" && !selection) return null;
  if (captureMode === "screenshot" && !screenshotImage) return null;
  if (captureMode === "video" && !videoThumbnail && !videoBlob) return null;

  const titleMissing = !draft.title.trim();

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

        <Section title={t("section.description")}>
          <Textarea
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            onFocus={cursorToEnd}
            placeholder={t("draft.bodyPlaceholder")}
            className="min-h-32 resize-none text-sm [field-sizing:content]"
          />
        </Section>

        {isVideoMode ? (
          <Section title={t("section.media")}>
            <VideoPreview blob={videoBlob} thumbnail={videoThumbnail} />
          </Section>
        ) : isElementMode ? (
          <Section title={t("section.styleChanges")}>
            <StyleChangesTable
              beforeImage={beforeImage}
              afterImage={afterImage}
              diffs={diffs}
            />
          </Section>
        ) : (
          <Section
            title={t("section.media")}
            action={
              screenshotImage ? (
                <>
                  {screenshotAnnotated ? (
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7 shrink-0"
                      title={t("draft.removeAnnotation")}
                      onClick={() => useEditorStore.setState({ screenshotAnnotated: null })}
                    >
                      <RotateCcw />
                    </Button>
                  ) : null}
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-7 w-7 shrink-0"
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
        )}

        <Section title={t("section.expectedResult")}>
          <Textarea
            value={draft.expectedResult}
            onChange={(e) =>
              setDraft({ ...draft, expectedResult: e.target.value })
            }
            onFocus={cursorToEnd}
            placeholder={t("draft.expectedResultPlaceholder")}
            className="min-h-32 resize-none text-sm [field-sizing:content]"
          />
        </Section>
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

