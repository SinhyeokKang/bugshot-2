import { createMarkdownIt } from "./markdownIt";
import { tokenizeJson, JSON_TOKEN_CLASS } from "./highlightJson";
import { escapeHtml } from "@/lib/escape-html";

// 삽입된 로그(```json)만 칠한다 — 그 외 언어는 우리가 만든 콘텐츠가 아니라 평문 유지.
// 빈 문자열을 반환하면 markdown-it이 자체 escape로 폴백한다.
function highlightJson(code: string, lang: string): string {
  if (lang !== "json") return "";
  return tokenizeJson(code)
    .map((t) =>
      t.kind ? `<span class="${JSON_TOKEN_CLASS[t.kind]}">${escapeHtml(t.text)}</span>` : escapeHtml(t.text),
    )
    .join("");
}

const md = createMarkdownIt({ highlight: highlightJson });

export function renderMarkdown(markdown: string): string {
  return md.render(markdown);
}
