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
            className="-mx-0.5 rounded-[1px] bg-blue-200 p-0.5 text-inherit dark:bg-blue-400/30"
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
