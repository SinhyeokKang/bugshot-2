import { createContext, Fragment } from "react";
import { splitHighlight } from "@/lib/highlight-text";

// JSON 트리 leaf가 prop drilling 없이 현재 검색어를 받기 위한 Context. Provider는 JsonTreeViewer 내부에만.
export const HighlightQueryContext = createContext<string>("");

export function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const segments = splitHighlight(text, query);
  if (segments.length === 1 && !segments[0].match) return <>{text}</>;
  return (
    <>
      {segments.map((seg, i) =>
        seg.match ? (
          <mark
            key={i}
            data-testid="log-highlight"
            className="rounded-sm bg-green-200 text-inherit dark:bg-green-400/30 [box-decoration-break:clone]"
          >
            {seg.text}
          </mark>
        ) : (
          <Fragment key={i}>{seg.text}</Fragment>
        ),
      )}
    </>
  );
}
