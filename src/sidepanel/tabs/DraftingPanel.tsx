import { useEffect, useMemo } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useEditorStore } from "@/store/editor-store";
import { useSettingsStore } from "@/store/settings-store";
import {
  StyleChangesTable,
  buildStyleDiff,
} from "../components/StyleChangesTable";

export function DraftingPanel() {
  const selection = useEditorStore((s) => s.selection);
  const target = useEditorStore((s) => s.target);
  const styleEdits = useEditorStore((s) => s.styleEdits);
  const beforeImage = useEditorStore((s) => s.beforeImage);
  const afterImage = useEditorStore((s) => s.afterImage);
  const draft = useEditorStore((s) => s.draft);
  const setDraft = useEditorStore((s) => s.setDraft);
  const backToStyling = useEditorStore((s) => s.backToStyling);
  const confirmDraft = useEditorStore((s) => s.confirmDraft);
  const titlePrefix = useSettingsStore(
    (s) => s.jiraConfig?.titlePrefix ?? "",
  );

  const diffs = useMemo(
    () => (selection ? buildStyleDiff(selection, styleEdits) : []),
    [selection, styleEdits],
  );

  useEffect(() => {
    if (draft) return;
    if (!selection) return;
    setDraft({
      title: defaultTitle(titlePrefix, selection.tagName, selection.selector),
      body: defaultBody(target?.url ?? "", selection),
      expectedResult: "",
    });
  }, [draft, selection, setDraft, target, titlePrefix]);

  if (!selection || !draft) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto py-5">
        <div className="flex flex-col gap-4">
          <Section title="이슈 제목">
            <Input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="이슈 제목"
            />
          </Section>

          <Section title="발생 현상">
            <Textarea
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              placeholder="재현 경로, 기대 동작 등 추가 설명"
              className="min-h-40 text-sm"
            />
          </Section>

          <Section title="스타일 변경사항">
            <StyleChangesTable
              beforeImage={beforeImage}
              afterImage={afterImage}
              diffs={diffs}
            />
          </Section>

          <Section title="기대 결과">
            <Textarea
              value={draft.expectedResult}
              onChange={(e) =>
                setDraft({ ...draft, expectedResult: e.target.value })
              }
              placeholder="수정 후 기대되는 동작 / 디자인 기준 등"
              className="min-h-24 text-sm"
            />
          </Section>
        </div>
      </div>
      <div className="shrink-0 flex items-center gap-2 border-t border-border/60 bg-background px-4 py-3">
        <Button
          size="lg"
          variant="outline"
          className="flex-1"
          onClick={() => backToStyling()}
        >
          <ArrowLeft />
          이전
        </Button>
        <Button size="lg" className="flex-1" onClick={() => confirmDraft()}>
          프리뷰
          <ArrowRight />
        </Button>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-border/60 pb-4 last:border-b-0 last:pb-0">
      <div className="px-4">
        <h3 className="mb-3 text-base font-semibold">{title}</h3>
        {children}
      </div>
    </section>
  );
}

function defaultTitle(
  prefix: string,
  tagName: string,
  selector: string,
): string {
  const trimmed = selector.length > 60 ? `${selector.slice(0, 60)}…` : selector;
  const body = `[${tagName}] ${trimmed}`;
  if (!prefix) return body;
  return prefix.endsWith(" ") ? `${prefix}${body}` : `${prefix} ${body}`;
}

function defaultBody(
  url: string,
  selection: {
    selector: string;
    viewport: { width: number; height: number };
    capturedAt: number;
  },
): string {
  const lines = [
    "",
    "",
    "---",
    `Page: ${url || "-"}`,
    `Selector: ${selection.selector}`,
    `Viewport: ${selection.viewport.width}×${selection.viewport.height}`,
    `Captured: ${formatTimestamp(selection.capturedAt)}`,
  ];
  return lines.join("\n");
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
