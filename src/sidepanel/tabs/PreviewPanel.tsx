import { useMemo } from "react";
import { ArrowLeft, Send } from "lucide-react";
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

export function PreviewPanel() {
  const selection = useEditorStore((s) => s.selection);
  const target = useEditorStore((s) => s.target);
  const styleEdits = useEditorStore((s) => s.styleEdits);
  const beforeImage = useEditorStore((s) => s.beforeImage);
  const afterImage = useEditorStore((s) => s.afterImage);
  const draft = useEditorStore((s) => s.draft);
  const backToDraft = useEditorStore((s) => s.backToDraft);

  const diffs = useMemo(
    () => (selection ? buildStyleDiff(selection, styleEdits) : []),
    [selection, styleEdits],
  );

  if (!selection || !draft) return null;

  return (
    <PageShell>
      <PageScroll>
        <Section>
          <h1 className="text-2xl font-semibold leading-tight">
            {draft.title || (
              <span className="text-muted-foreground/70">(제목 없음)</span>
            )}
          </h1>
          <MetaRow />
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
            size="lg"
            variant="outline"
            className="flex-1"
            onClick={() => backToDraft()}
          >
            <ArrowLeft />
            이전
          </Button>
          <Button
            size="lg"
            className="flex-1"
            disabled
            title="제출 기능은 준비 중입니다"
          >
            <Send />
            제출
          </Button>
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
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm leading-relaxed">
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="text-muted-foreground">{r.label}</dt>
          <dd className="break-all">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function MetaRow() {
  const items: { label: string; value: string }[] = [
    { label: "이슈 타입", value: "—" },
    { label: "우선순위", value: "—" },
    { label: "담당자", value: "—" },
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="inline-flex gap-1">
          <span>{i.label}</span>
          <span className="text-foreground/80">{i.value}</span>
        </span>
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
