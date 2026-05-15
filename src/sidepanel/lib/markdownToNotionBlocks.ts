import { t } from "@/i18n";
import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import type { NotionBlock, NotionRichText } from "@/types/notion";
import { findClosingToken } from "./findClosingToken";

const md = MarkdownIt({ html: false, breaks: true, linkify: true });
md.enable("strikethrough");

export function markdownToNotionBlocks(markdown: string): NotionBlock[] {
  const trimmed = markdown.trim();
  if (!trimmed) {
    return [{ type: "paragraph", text: t("md.noValue") }];
  }

  const tokens = md.parse(trimmed, {});
  return convertTokens(tokens);
}

function convertTokens(tokens: Token[]): NotionBlock[] {
  const result: NotionBlock[] = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    if (token.type === "paragraph_open") {
      const inlineToken = tokens[i + 1];
      const richText = inlineToken?.type === "inline"
        ? convertInline(inlineToken.children ?? [])
        : [];
      result.push({
        type: "rich_paragraph",
        richText: richText.length > 0 ? richText : [richTextNode("")],
      });
      i += 3;
      continue;
    }

    if (token.type === "bullet_list_open") {
      const end = findClosingToken(tokens, i, "bullet_list_open", "bullet_list_close");
      const items = convertListItems(tokens.slice(i + 1, end), "rich_bulleted_list_item");
      result.push(...items);
      i = end + 1;
      continue;
    }

    if (token.type === "ordered_list_open") {
      const end = findClosingToken(tokens, i, "ordered_list_open", "ordered_list_close");
      const items = convertListItems(tokens.slice(i + 1, end), "rich_numbered_list_item");
      result.push(...items);
      i = end + 1;
      continue;
    }

    if (token.type === "hr") {
      result.push({ type: "divider" });
      i++;
      continue;
    }

    i++;
  }

  return result;
}

function convertListItems(
  tokens: Token[],
  blockType: "rich_bulleted_list_item" | "rich_numbered_list_item",
): NotionBlock[] {
  const items: NotionBlock[] = [];
  let i = 0;

  while (i < tokens.length) {
    if (tokens[i].type === "list_item_open") {
      const end = findClosingToken(tokens, i, "list_item_open", "list_item_close");
      const innerTokens = tokens.slice(i + 1, end);
      const richText = extractListItemRichText(innerTokens);
      items.push({ type: blockType, richText } as NotionBlock);
      i = end + 1;
      continue;
    }
    i++;
  }

  return items;
}

function extractListItemRichText(tokens: Token[]): NotionRichText[] {
  for (const token of tokens) {
    if (token.type === "inline") {
      return convertInline(token.children ?? []);
    }
  }
  return [richTextNode("")];
}

function convertInline(children: Token[]): NotionRichText[] {
  const nodes: NotionRichText[] = [];
  const annotationStack: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    code?: boolean;
  }[] = [];
  let linkUrl: string | null = null;

  function currentAnnotations() {
    const merged: NotionRichText["annotations"] = {};
    for (const a of annotationStack) Object.assign(merged, a);
    return Object.keys(merged).length > 0 ? merged : undefined;
  }

  for (const child of children) {
    if (child.type === "text") {
      const rt = richTextNode(child.content);
      const ann = currentAnnotations();
      if (ann) rt.annotations = ann;
      if (linkUrl) rt.text.link = { url: linkUrl };
      nodes.push(rt);
      continue;
    }

    if (child.type === "code_inline") {
      nodes.push({
        type: "text",
        text: { content: child.content },
        annotations: { code: true },
      });
      continue;
    }

    if (child.type === "softbreak") continue;

    if (child.type === "strong_open") { annotationStack.push({ bold: true }); continue; }
    if (child.type === "strong_close") { popAnnotation(annotationStack, "bold"); continue; }
    if (child.type === "em_open") { annotationStack.push({ italic: true }); continue; }
    if (child.type === "em_close") { popAnnotation(annotationStack, "italic"); continue; }
    if (child.type === "s_open") { annotationStack.push({ strikethrough: true }); continue; }
    if (child.type === "s_close") { popAnnotation(annotationStack, "strikethrough"); continue; }
    if (child.type === "link_open") { linkUrl = child.attrGet("href") ?? ""; continue; }
    if (child.type === "link_close") { linkUrl = null; continue; }
  }

  return nodes;
}

function richTextNode(content: string): NotionRichText {
  return { type: "text", text: { content } };
}

function popAnnotation(
  stack: Record<string, boolean | undefined>[],
  key: string,
): void {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i][key]) {
      stack.splice(i, 1);
      return;
    }
  }
}

