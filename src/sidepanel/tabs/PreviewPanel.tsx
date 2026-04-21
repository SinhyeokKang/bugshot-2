import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/store/editor-store";
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
  const selection = useEditorStore((s) => s.selection);
  const target = useEditorStore((s) => s.target);
  const styleEdits = useEditorStore((s) => s.styleEdits);
  const tokens = useEditorStore((s) => s.tokens);
  const beforeImage = useEditorStore((s) => s.beforeImage);
  const afterImage = useEditorStore((s) => s.afterImage);
  const draft = useEditorStore((s) => s.draft);
  const backToDraft = useEditorStore((s) => s.backToDraft);

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

  if (!selection || !draft) return null;

  const handleCopyMarkdown = async () => {
    const changedProps = new Set(diffs.map((d) => d.prop));
    const relevantValues = Object.entries(selection.specifiedStyles)
      .filter(([k]) => changedProps.has(k))
      .map(([, v]) => v);
    const relevantTokens = tokens
      .filter((t) => relevantValues.some((v) => v.includes(t.name)))
      .map((t) => ({ name: t.name, value: t.value }));

    const ctx = {
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleCopyMarkdown()}
              className="shrink-0"
            >
              {copied ? <Check /> : <Copy />}
              {copied ? "복사됨" : "마크다운 복사"}
            </Button>
          </div>
        </Section>

        <Section title="발생 환경">
          <EnvParagraph
            url={target?.url ?? ""}
            selector={selection.selector}
            viewport={selection.viewport}
            capturedAt={selection.capturedAt}
          />
        </Section>

        <Section title="발생 현상">
          <DocBody value={draft.body} />
        </Section>

        <Section title="스타일 변경사항">
          <StyleChangesTable
            beforeImage={beforeImage}
            afterImage={afterImage}
            diffs={diffs}
          />
        </Section>

        <Section title="기대 결과">
          <DocBody value={draft.expectedResult} />
        </Section>
      </PageScroll>
      <PageFooter>
        <div className="flex items-center gap-2">
          <Button
            size="xl"
            variant="outline"
            className="flex-1"
            onClick={() => backToDraft()}
          >
            <ArrowLeft />
            이전
          </Button>
          <IssueCreateModal />
        </div>
      </PageFooter>
    </PageShell>
  );
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

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
