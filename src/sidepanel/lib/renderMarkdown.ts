import MarkdownIt from "markdown-it";
import { tokenizeJson, JSON_TOKEN_CLASS } from "./highlightJson";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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

const md = MarkdownIt({ html: false, breaks: true, linkify: true, highlight: highlightJson });
md.enable("strikethrough");

export function renderMarkdown(markdown: string): string {
  return md.render(markdown);
}
