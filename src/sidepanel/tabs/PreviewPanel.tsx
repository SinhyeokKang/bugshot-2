import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Info } from "lucide-react";
import { formatTimestamp } from "../lib/formatTimestamp";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/store/editor-store";
import { isJiraConfigComplete, useSettingsStore } from "@/store/settings-store";
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
import { IssueCreateModal } from "./IssueCreateModal";

export function PreviewPanel() {
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
  const videoDuration = useEditorStore((s) => s.videoDuration);
  const videoViewport = useEditorStore((s) => s.videoViewport);
  const videoCapturedAt = useEditorStore((s) => s.videoCapturedAt);
  const draft = useEditorStore((s) => s.draft);
  const backToDraft = useEditorStore((s) => s.backToDraft);
  const reset = useEditorStore((s) => s.reset);
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

  if (!draft) return null;
  if (isElementMode && !selection) return null;

  const handleCopyMarkdown = async () => {
    let ctx: Parameters<typeof buildIssueMarkdown>[0];
    if (isVideoMode) {
      ctx = {
        captureMode: "video",
        title: draft.title,
        body: draft.body,
        expectedResult: draft.expectedResult,
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
        body: draft.body,
        expectedResult: draft.expectedResult,
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
                <span className="text-muted-foreground/70">(제목 없음)</span>
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
                {copied ? "복사됨" : "마크다운 복사"}
              </Button>
            ) : null}
          </div>
        </Section>

        {isElementMode && selection ? (
          <Section title="재현 환경">
            <EnvParagraph
              url={target?.url ?? ""}
              selector={selection.selector}
              viewport={selection.viewport}
              capturedAt={selection.capturedAt}
            />
          </Section>
        ) : (
          <Section title="재현 환경">
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
              {isVideoMode && videoDuration != null ? (
                <div className="flex gap-3">
                  <span className="w-20 shrink-0 text-muted-foreground">Duration</span>
                  <span>{videoDuration.toFixed(1)}초</span>
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

        <Section title="발생 현상">
          <DocBody value={draft.body} />
        </Section>

        {isVideoMode ? (
          <Section title="미디어">
            <PreviewVideo blob={videoBlob} thumbnail={videoThumbnail} />
          </Section>
        ) : isElementMode ? (
          <Section title="스타일 변경사항">
            <StyleChangesTable
              beforeImage={beforeImage}
              afterImage={afterImage}
              diffs={diffs}
            />
          </Section>
        ) : (
          <Section title="미디어">
            {screenshotImage ? (
              <div className="aspect-video w-full overflow-hidden rounded-lg border bg-muted/70">
                <img
                  src={screenshotImage}
                  alt="캡처 이미지"
                  className="h-full w-full object-contain"
                />
              </div>
            ) : null}
          </Section>
        )}

        <Section title="기대 결과">
          <DocBody value={draft.expectedResult} />
        </Section>
      </PageScroll>
      <PageFooter>
        {!configured ? (
          <Alert variant="ghost" className="mb-2">
            <Info className="h-4 w-4" />
            <AlertTitle>Jira가 연결되어 있지 않습니다</AlertTitle>
            <AlertDescription>
              Jira 이슈를 생성하시려면, 연동 탭에서 Jira를 먼저 연결해주세요.
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <Button
            size="lg"
            variant="outline"
            onClick={() => reset()}
          >
            다른 이슈 작성
          </Button>
          <div className="flex items-center gap-2">
            <Button
              size="lg"
              variant="outline"
              onClick={() => backToDraft()}
            >
              이전
            </Button>
            <IssueCreateModal />
          </div>
        </div>
      </PageFooter>
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
  if (thumbnail) return <img src={thumbnail} alt="녹화 썸네일" className="w-full rounded-lg border" />;
  return null;
}

function DocBody({ value }: { value: string }) {
  if (!value.trim()) {
    return <p className="text-sm text-muted-foreground/70">비어 있음</p>;
  }
  return (
    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {value}
    </div>
  );
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

