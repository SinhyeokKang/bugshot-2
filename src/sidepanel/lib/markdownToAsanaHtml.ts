import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { findClosingToken } from "./findClosingToken";

// Asana html_notes는 제한된 태그 서브셋만 허용한다:
// <body><h1><h2><ol><ul><li><strong><em><u><s><code><pre><a href><blockquote><hr><img>.
// 인라인 <img>는 첨부 GID 참조(`<img data-asana-gid>`)만 가능 — 업로드 후 GID로 본문을 갱신한다.
// <p>·<table>·<h3+>·영상은 미지원이라 폴백 처리한다.
const md = MarkdownIt({ html: false, breaks: true, linkify: true });
md.enable("strikethrough");

export interface AsanaInlineImage {
  gid: string;
  viewUrl?: string;
  width?: number;
  height?: number;
}

// 이미지 src(=filename) → 첨부 참조. 동기·단일 호출이라 모듈 스코프로 두고 재진입은 없다.
let imageRefByName: Record<string, AsanaInlineImage> = {};

export function markdownToAsanaHtml(
  markdown: string,
  imageRefs: Record<string, AsanaInlineImage> = {},
): string {
  imageRefByName = imageRefs;
  const trimmed = markdown.trim();
  if (!trimmed) return "<body></body>";
  const tokens = md.parse(trimmed, {});
  return `<body>${convertBlocks(tokens)}</body>`;
}

function convertBlocks(tokens: Token[]): string {
  const out: string[] = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    if (token.type === "heading_open") {
      const inline = tokens[i + 1];
      const content =
        inline?.type === "inline" ? convertInline(inline.children ?? []) : "";
      // Asana는 h1/h2만 허용 — h3 이상은 <strong>으로 폴백.
      const tag = token.tag === "h1" || token.tag === "h2" ? token.tag : null;
      out.push(tag ? `<${tag}>${content}</${tag}>` : `<strong>${content}</strong>`);
      i += 3;
      continue;
    }

    if (token.type === "paragraph_open") {
      const inline = tokens[i + 1];
      out.push(
        inline?.type === "inline" ? convertInline(inline.children ?? []) : "",
      );
      i += 3;
      continue;
    }

    if (token.type === "bullet_list_open") {
      const end = findClosingToken(tokens, i, "bullet_list_open", "bullet_list_close");
      out.push(`<ul>${convertListItems(tokens.slice(i + 1, end))}</ul>`);
      i = end + 1;
      continue;
    }

    if (token.type === "ordered_list_open") {
      const end = findClosingToken(tokens, i, "ordered_list_open", "ordered_list_close");
      out.push(`<ol>${convertListItems(tokens.slice(i + 1, end))}</ol>`);
      i = end + 1;
      continue;
    }

    if (token.type === "blockquote_open") {
      const end = findClosingToken(tokens, i, "blockquote_open", "blockquote_close");
      out.push(`<blockquote>${convertBlocks(tokens.slice(i + 1, end))}</blockquote>`);
      i = end + 1;
      continue;
    }

    if (token.type === "table_open") {
      const end = findClosingToken(tokens, i, "table_open", "table_close");
      out.push(tableToPre(tokens.slice(i, end + 1)));
      i = end + 1;
      continue;
    }

    if (token.type === "fence" || token.type === "code_block") {
      out.push(`<pre>${escapeHtml(token.content.replace(/\n$/, ""))}</pre>`);
      i++;
      continue;
    }

    if (token.type === "hr") {
      out.push("<hr/>");
      i++;
      continue;
    }

    i++;
  }

  return out.join("\n");
}

function convertListItems(tokens: Token[]): string {
  const items: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i].type === "list_item_open") {
      const end = findClosingToken(tokens, i, "list_item_open", "list_item_close");
      items.push(`<li>${convertBlocks(tokens.slice(i + 1, end)).trim()}</li>`);
      i = end + 1;
      continue;
    }
    i++;
  }
  return items.join("");
}

function convertInline(children: Token[]): string {
  let out = "";
  for (const child of children) {
    switch (child.type) {
      case "text":
        out += escapeHtml(child.content);
        break;
      case "code_inline":
        out += `<code>${escapeHtml(child.content)}</code>`;
        break;
      case "softbreak":
      case "hardbreak":
        out += "\n";
        break;
      case "image": {
        // 업로드된 첨부면 GID로 인라인, 아니면 캡션(alt)만 남긴다.
        // data-src-width/height + style이 있어야 썸네일 크기가 아닌 원본 비율로 렌더된다.
        const src = child.attrGet("src") ?? "";
        const ref = imageRefByName[src];
        if (ref) {
          const srcAttr = ref.viewUrl
            ? ` src="${escapeAttr(ref.viewUrl)}"`
            : "";
          const dims =
            ref.width && ref.height
              ? ` data-src-width="${ref.width}" data-src-height="${ref.height}"`
              : "";
          out += `<img${srcAttr} data-asana-gid="${escapeAttr(ref.gid)}"${dims} style="display:block;max-width:100%">`;
        } else {
          const alt = child.content || child.attrGet("alt") || "";
          if (alt) out += escapeHtml(alt);
        }
        break;
      }
      case "strong_open":
        out += "<strong>";
        break;
      case "strong_close":
        out += "</strong>";
        break;
      case "em_open":
        out += "<em>";
        break;
      case "em_close":
        out += "</em>";
        break;
      case "s_open":
        out += "<s>";
        break;
      case "s_close":
        out += "</s>";
        break;
      case "link_open":
        out += `<a href="${escapeAttr(child.attrGet("href") ?? "")}">`;
        break;
      case "link_close":
        out += "</a>";
        break;
      default:
        break;
    }
  }
  return out;
}

// 테이블 → <pre> 폴백. 모노스페이스 고정폭이므로 컬럼별 max-width로 공백 패딩해 정렬.
function tableToPre(tokens: Token[]): string {
  const rows: string[][] = [];
  let current: string[] | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.type === "tr_open") current = [];
    else if (tk.type === "tr_close") {
      if (current) rows.push(current);
      current = null;
    } else if ((tk.type === "th_open" || tk.type === "td_open") && current) {
      const inline = tokens[i + 1];
      current.push(
        inline?.type === "inline" ? plainText(inline.children ?? []) : "",
      );
    }
  }
  if (rows.length === 0) return "<pre></pre>";

  const cols = Math.max(...rows.map((r) => r.length));
  const widths: number[] = [];
  for (let c = 0; c < cols; c++) {
    widths[c] = Math.max(...rows.map((r) => (r[c] ?? "").length));
  }
  const fmt = (r: string[]) =>
    widths.map((w, c) => (r[c] ?? "").padEnd(w)).join(" | ");
  const divider = widths.map((w) => "-".repeat(w)).join(" | ");
  const lines = [fmt(rows[0]), divider, ...rows.slice(1).map(fmt)];
  return `<pre>${escapeHtml(lines.join("\n"))}</pre>`;
}

function plainText(children: Token[]): string {
  let out = "";
  for (const child of children) {
    if (child.type === "text" || child.type === "code_inline") out += child.content;
    else if (child.type === "image") out += child.content || child.attrGet("alt") || "";
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
