import { t } from "@/i18n";
import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { findClosingToken } from "./findClosingToken";

interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
  marks?: AdfMark[];
}

const md = MarkdownIt({ html: false, breaks: true, linkify: true });
md.enable("strikethrough");

export function markdownToAdf(markdown: string): AdfNode[] {
  const trimmed = markdown.trim();
  if (!trimmed) {
    return [{ type: "paragraph", content: [{ type: "text", text: t("md.noValue") }] }];
  }

  const tokens = md.parse(trimmed, {});
  return convertTokens(tokens);
}

function convertTokens(tokens: Token[]): AdfNode[] {
  const result: AdfNode[] = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    if (token.type === "paragraph_open") {
      const inlineToken = tokens[i + 1];
      const children = inlineToken?.type === "inline"
        ? convertInline(inlineToken.children ?? [])
        : [];
      result.push({
        type: "paragraph",
        content: children.length > 0 ? children : [{ type: "text", text: "" }],
      });
      i += 3; // paragraph_open + inline + paragraph_close
      continue;
    }

    if (token.type === "bullet_list_open") {
      const end = findClosingToken(tokens, i, "bullet_list_open", "bullet_list_close");
      const items = convertListItems(tokens.slice(i + 1, end));
      result.push({ type: "bulletList", content: items });
      i = end + 1;
      continue;
    }

    if (token.type === "ordered_list_open") {
      const end = findClosingToken(tokens, i, "ordered_list_open", "ordered_list_close");
      const items = convertListItems(tokens.slice(i + 1, end));
      result.push({ type: "orderedList", content: items });
      i = end + 1;
      continue;
    }

    if (token.type === "blockquote_open") {
      const end = findClosingToken(tokens, i, "blockquote_open", "blockquote_close");
      const inner = convertTokens(tokens.slice(i + 1, end));
      result.push({ type: "blockquote", content: inner });
      i = end + 1;
      continue;
    }

    if (token.type === "fence") {
      const lang = token.info.trim() || undefined;
      result.push({
        type: "codeBlock",
        ...(lang ? { attrs: { language: lang } } : {}),
        content: [{ type: "text", text: token.content }],
      });
      i++;
      continue;
    }

    if (token.type === "hr") {
      result.push({ type: "rule" });
      i++;
      continue;
    }

    i++;
  }

  return result;
}

function convertListItems(tokens: Token[]): AdfNode[] {
  const items: AdfNode[] = [];
  let i = 0;

  while (i < tokens.length) {
    if (tokens[i].type === "list_item_open") {
      const end = findClosingToken(tokens, i, "list_item_open", "list_item_close");
      const inner = convertTokens(tokens.slice(i + 1, end));
      items.push({ type: "listItem", content: inner });
      i = end + 1;
      continue;
    }
    i++;
  }

  return items;
}

function convertInline(children: Token[]): AdfNode[] {
  const nodes: AdfNode[] = [];
  const markStack: AdfMark[] = [];

  for (const child of children) {
    if (child.type === "text") {
      const node: AdfNode = { type: "text", text: child.content };
      if (markStack.length > 0) node.marks = [...markStack];
      nodes.push(node);
      continue;
    }

    if (child.type === "code_inline") {
      nodes.push({
        type: "text",
        text: child.content,
        marks: [{ type: "code" }],
      });
      continue;
    }

    if (child.type === "softbreak" || child.type === "hardbreak") {
      nodes.push({ type: "hardBreak" });
      continue;
    }

    if (child.type === "image") {
      const alt = child.content || child.attrGet("alt") || "";
      if (alt) nodes.push({ type: "text", text: alt });
      continue;
    }

    if (child.type === "strong_open") {
      markStack.push({ type: "strong" });
      continue;
    }
    if (child.type === "strong_close") {
      popMark(markStack, "strong");
      continue;
    }

    if (child.type === "em_open") {
      markStack.push({ type: "em" });
      continue;
    }
    if (child.type === "em_close") {
      popMark(markStack, "em");
      continue;
    }

    if (child.type === "s_open") {
      markStack.push({ type: "strike" });
      continue;
    }
    if (child.type === "s_close") {
      popMark(markStack, "strike");
      continue;
    }

    if (child.type === "link_open") {
      const href = child.attrGet("href") ?? "";
      markStack.push({ type: "link", attrs: { href } });
      continue;
    }
    if (child.type === "link_close") {
      popMark(markStack, "link");
      continue;
    }
  }

  return nodes;
}

function popMark(stack: AdfMark[], type: string): void {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].type === type) {
      stack.splice(i, 1);
      return;
    }
  }
}

