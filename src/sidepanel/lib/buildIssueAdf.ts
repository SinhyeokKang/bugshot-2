import type { MarkdownContext } from "./buildIssueMarkdown";

interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

export interface AdfDoc {
  version: 1;
  type: "doc";
  content: AdfNode[];
}

export function buildIssueAdf(ctx: MarkdownContext): AdfDoc {
  const content: AdfNode[] = [];

  content.push(heading(2, "발생 환경"));
  content.push(
    bulletList([
      keyValueItem("Page", ctx.url),
      keyValueItem("DOM", ctx.selector),
      keyValueItem("Viewport", `${ctx.viewport.width}×${ctx.viewport.height}`),
      keyValueItem("Captured", formatTimestamp(ctx.capturedAt)),
    ]),
  );

  content.push(heading(2, "발생 현상"));
  content.push(...textBlock(ctx.body));

  content.push(heading(2, "스타일 변경사항"));
  if (ctx.diffs.length > 0) {
    content.push(
      table(
        ["속성", "As is", "To be"],
        ctx.diffs.map((d) => [d.prop, d.asIs, d.toBe]),
      ),
    );
  } else {
    content.push(paragraph([textNode("변경 사항 없음")]));
  }

  content.push(heading(2, "기대 결과"));
  content.push(...textBlock(ctx.expectedResult));

  return { version: 1, type: "doc", content };
}

function heading(level: number, text: string): AdfNode {
  return {
    type: "heading",
    attrs: { level },
    content: [textNode(text)],
  };
}

function paragraph(children: AdfNode[]): AdfNode {
  return { type: "paragraph", content: children };
}

function textNode(value: string): AdfNode {
  return { type: "text", text: value };
}

function strongTextNode(value: string): AdfNode {
  return { type: "text", text: value, marks: [{ type: "strong" }] };
}

function hardBreak(): AdfNode {
  return { type: "hardBreak" };
}

function textBlock(raw: string): AdfNode[] {
  const trimmed = raw.trim();
  if (!trimmed) return [paragraph([textNode("")])];
  const paragraphs = trimmed.split(/\n\s*\n/);
  return paragraphs.map((p) => {
    const lines = p.split(/\n/);
    const inline: AdfNode[] = [];
    lines.forEach((line, idx) => {
      if (line) inline.push(textNode(line));
      if (idx < lines.length - 1) inline.push(hardBreak());
    });
    return paragraph(inline.length > 0 ? inline : [textNode("")]);
  });
}

function bulletList(items: AdfNode[]): AdfNode {
  return { type: "bulletList", content: items };
}

function keyValueItem(key: string, value: string): AdfNode {
  return {
    type: "listItem",
    content: [
      paragraph([strongTextNode(`${key}: `), textNode(value)]),
    ],
  };
}

function table(headers: string[], rows: string[][]): AdfNode {
  return {
    type: "table",
    attrs: { isNumberColumnEnabled: false, layout: "default" },
    content: [
      {
        type: "tableRow",
        content: headers.map((h) => ({
          type: "tableHeader",
          attrs: {},
          content: [paragraph([strongTextNode(h)])],
        })),
      },
      ...rows.map((row) => ({
        type: "tableRow",
        content: row.map((cell) => ({
          type: "tableCell",
          attrs: {},
          content: [paragraph([textNode(cell)])],
        })),
      })),
    ],
  };
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
