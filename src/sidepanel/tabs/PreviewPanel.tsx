import { useMemo } from "react";
import { ArrowLeft, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/store/editor-store";
import { PageFooter, PageScroll, PageShell } from "../components/Section";
import {
  StyleChangesTable,
  buildStyleDiff,
} from "../components/StyleChangesTable";

export function PreviewPanel() {
  const selection = useEditorStore((s) => s.selection);
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
        <article className="flex flex-col gap-5 px-4">
          <header className="flex flex-col gap-2">
            <h1 className="text-lg font-semibold leading-snug">
              {draft.title || (
                <span className="text-muted-foreground/70">(제목 없음)</span>
              )}
            </h1>
            <MetaRow />
          </header>

          <DocHeading>발생 현상</DocHeading>
          <DocBody value={draft.body} />

          <DocHeading>스타일 변경사항</DocHeading>
          <StyleChangesTable
            beforeImage={beforeImage}
            afterImage={afterImage}
            diffs={diffs}
          />

          <DocHeading>기대 결과</DocHeading>
          <DocBody value={draft.expectedResult} />
        </article>
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

function DocHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h2>
  );
}

function DocBody({ value }: { value: string }) {
  if (!value.trim()) {
    return (
      <p className="text-sm text-muted-foreground/70">비어 있음</p>
    );
  }
  return (
    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {value}
    </div>
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
