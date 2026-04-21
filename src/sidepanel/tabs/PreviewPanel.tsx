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
        <Section title="이슈 제목">
          <p className="text-sm font-medium">
            {draft.title || <Placeholder />}
          </p>
        </Section>

        <Section title="발생 현상">
          <BodyView value={draft.body} />
        </Section>

        <Section title="스타일 변경사항">
          <StyleChangesTable
            beforeImage={beforeImage}
            afterImage={afterImage}
            diffs={diffs}
          />
        </Section>

        <Section title="기대 결과">
          <BodyView value={draft.expectedResult} />
        </Section>

        <Section title="Jira 필드">
          <JiraFieldsPlaceholder />
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

function BodyView({ value }: { value: string }) {
  if (!value.trim()) return <Placeholder />;
  return (
    <pre className="whitespace-pre-wrap break-words rounded-md border border-border/60 bg-muted/30 p-3 font-sans text-sm leading-relaxed">
      {value}
    </pre>
  );
}

function Placeholder() {
  return <span className="text-sm text-muted-foreground/70">비어 있음</span>;
}

function JiraFieldsPlaceholder() {
  const rows: { label: string; hint: string }[] = [
    { label: "이슈 타입", hint: "Bug / Task / …" },
    { label: "우선순위", hint: "Priority" },
    { label: "담당자", hint: "Assignee" },
  ];
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div
          key={r.label}
          className="flex items-center justify-between rounded-md border border-dashed border-border/60 bg-muted/20 px-3 py-2 text-sm"
        >
          <span className="text-muted-foreground">{r.label}</span>
          <span className="text-xs text-muted-foreground/60">{r.hint}</span>
        </div>
      ))}
      <p className="text-[11px] text-muted-foreground">
        Combobox는 다음 작업에서 붙입니다.
      </p>
    </div>
  );
}
