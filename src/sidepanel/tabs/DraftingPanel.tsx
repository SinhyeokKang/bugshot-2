import { useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useEditorStore } from "@/store/editor-store";
import { useSettingsStore } from "@/store/settings-store";
import { useBoundTabId } from "../hooks/useBoundTabId";
import { clearPicker, startPicker } from "../picker-control";
import { CancelConfirmDialog } from "./IssueTab";
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
  const tabId = useBoundTabId();
  const selection = useEditorStore((s) => s.selection);
  const styleEdits = useEditorStore((s) => s.styleEdits);
  const beforeImage = useEditorStore((s) => s.beforeImage);
  const afterImage = useEditorStore((s) => s.afterImage);
  const draft = useEditorStore((s) => s.draft);
  const setDraft = useEditorStore((s) => s.setDraft);
  const reset = useEditorStore((s) => s.reset);
  const backToStyling = useEditorStore((s) => s.backToStyling);
  const confirmDraft = useEditorStore((s) => s.confirmDraft);
  const titlePrefix = useSettingsStore(
    (s) => s.jiraConfig?.titlePrefix ?? "",
  );
  const isElementMode = true;

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
            onFocus={cursorToEnd}
            placeholder="이슈 제목"
          />
        </Section>

        <Section title="발생 현상">
          <Textarea
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            onFocus={cursorToEnd}
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
            onFocus={cursorToEnd}
            placeholder="수정 후 기대되는 동작 / 디자인 기준 등"
            className="min-h-32 resize-none text-sm [field-sizing:content]"
          />
        </Section>
      </PageScroll>
      <PageFooter>
        <div className="flex items-center justify-between gap-2">
          <CancelConfirmDialog
            onConfirm={() => {
              reset();
              if (tabId) {
                void clearPicker(tabId);
                void startPicker(tabId);
              }
            }}
          />
          <div className="flex items-center gap-2">
            {isElementMode ? (
              <Button
                size="lg"
                variant="outline"
                onClick={() => backToStyling()}
              >
                이전
              </Button>
            ) : null}
            <Button
              size="lg"
              onClick={() => confirmDraft()}
              disabled={titleMissing}
            >
              이슈 프리뷰
            </Button>
          </div>
        </div>
      </PageFooter>
    </PageShell>
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

