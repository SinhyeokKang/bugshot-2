import { useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useEditorStore } from "@/store/editor-store";
import { useSettingsStore } from "@/store/settings-store";
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
  const selection = useEditorStore((s) => s.selection);
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
      title: defaultTitle(titlePrefix),
      body: "",
      expectedResult: "",
    });
  }, [draft, selection, setDraft, titlePrefix]);

  if (!selection || !draft) return null;

  const titleMissing = !draft.title.trim();

  return (
    <PageShell>
      <PageScroll>
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
            className="min-h-32 resize-none text-sm [field-sizing:content]"
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
            className="min-h-32 resize-none text-sm [field-sizing:content]"
          />
        </Section>
      </PageScroll>
      <PageFooter>
        <div className="flex items-center gap-2">
          <Button
            size="xl"
            variant="outline"
            className="flex-1"
            onClick={() => backToStyling()}
          >
            이전
          </Button>
          <Button
            size="xl"
            className="flex-1"
            onClick={() => confirmDraft()}
            disabled={titleMissing}
          >
            프리뷰
          </Button>
        </div>
      </PageFooter>
    </PageShell>
  );
}

function defaultTitle(prefix: string): string {
  if (!prefix) return "";
  return prefix.endsWith(" ") ? prefix : `${prefix} `;
}

