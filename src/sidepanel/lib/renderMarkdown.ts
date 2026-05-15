import MarkdownIt from "markdown-it";

const md = MarkdownIt({ html: false, breaks: true, linkify: true });
md.enable("strikethrough");

const builtinValidateLink = md.validateLink.bind(md);
md.validateLink = (url: string) => {
  if (/^\s*javascript:/i.test(url)) return false;
  return builtinValidateLink(url);
};

export function renderMarkdown(markdown: string): string {
  return md.render(markdown);
}
