import { buildIssueMarkdown, type MarkdownContext } from "./buildIssueMarkdown";

export const AI_META_FILENAME = "{key}-bugshot.md";

export function buildAiMetaAttachment(
  ctx: MarkdownContext,
): { filename: string; dataUrl: string } {
  const md = buildIssueMarkdown(ctx);
  const utf8 = new TextEncoder().encode(md);
  let binary = "";
  for (const byte of utf8) binary += String.fromCharCode(byte);
  return {
    filename: AI_META_FILENAME,
    dataUrl: `data:text/markdown;base64,${btoa(binary)}`,
  };
}
