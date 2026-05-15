import MarkdownIt from "markdown-it";

const md = MarkdownIt({ html: false, breaks: true, linkify: true });
md.enable("strikethrough");

export function renderMarkdown(markdown: string): string {
  return md.render(markdown);
}
