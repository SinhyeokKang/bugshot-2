import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n";
import { useEditorStore } from "@/store/editor-store";
import { useBoundTabId } from "@/sidepanel/hooks/useBoundTabId";
import { applyStyles } from "@/sidepanel/picker-control";
import { parseInlineStyle, serializeInlineStyle } from "./inlineCssText";

export function StyleCodeEditor() {
  const t = useT();
  const inlineStyle = useEditorStore((s) => s.styleEdits.inlineStyle);
  const setStyleEdits = useEditorStore((s) => s.setStyleEdits);
  const tabId = useBoundTabId();

  const [text, setText] = useState(() => serializeInlineStyle(inlineStyle));
  // ClassEditor와 동일 패턴: 내가 직전에 커밋한 직렬화 결과를 기억. 외부(폼 편집·
  // revert·버퍼 복원) 변경만 textarea를 재직렬화해 커서 점프를 막는다.
  const lastCommittedRef = useRef(serializeInlineStyle(inlineStyle));

  useEffect(() => {
    const next = serializeInlineStyle(inlineStyle);
    if (next !== lastCommittedRef.current) {
      setText(next);
      lastCommittedRef.current = next;
    }
  }, [inlineStyle]);

  const handleChange = (next: string) => {
    setText(next);
    const parsed = parseInlineStyle(next);
    lastCommittedRef.current = serializeInlineStyle(parsed);
    setStyleEdits({ inlineStyle: parsed });
    const frameId = useEditorStore.getState().selection?.frameId ?? 0;
    if (tabId) void applyStyles(tabId, frameId, parsed);
  };

  return (
    <Textarea
      value={text}
      onChange={(e) => handleChange(e.target.value)}
      placeholder={t("editor.codePlaceholder")}
      className="min-h-24 resize-none font-mono text-sm [field-sizing:content]"
      rows={3}
      spellCheck={false}
      data-testid="style-code-editor"
    />
  );
}
