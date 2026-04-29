import { t } from "@/i18n";
import { IMAGE_PLACEHOLDER } from "@/lib/adf-sentinels";
import { formatElementName } from "@/lib/element-label";
import type { MarkdownContext } from "./buildIssueMarkdown";
import { formatTimestamp } from "./formatTimestamp";

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
  const isVideo = ctx.captureMode === "video";
  const isScreenshot = ctx.captureMode === "screenshot";

  content.push(heading(2, t("md.section.env")));
  if (isVideo) {
    const items = [
      keyValueItem("Page", ctx.url),
      keyValueItem("Viewport", `${ctx.viewport.width}×${ctx.viewport.height}`),
      keyValueItem("Captured", formatTimestamp(ctx.capturedAt)),
    ];
    content.push(bulletList(items));
  } else if (isScreenshot) {
    const items = [
      keyValueItem("Page", ctx.url),
      keyValueItem("Viewport", `${ctx.viewport.width}×${ctx.viewport.height}`),
      keyValueItem("Captured", formatTimestamp(ctx.capturedAt)),
    ];
    content.push(bulletList(items));
  } else {
    const domLabel = ctx.tagName
      ? formatElementName({ tag: ctx.tagName, classList: ctx.classListBefore })
      : "";
    content.push(
      bulletList([
        keyValueItem("Page", ctx.url),
        ...(domLabel ? [keyValueItem("DOM", domLabel)] : []),
        keyValueItem("Viewport", `${ctx.viewport.width}×${ctx.viewport.height}`),
        keyValueItem("Captured", formatTimestamp(ctx.capturedAt)),
      ]),
    );
  }

  content.push(heading(2, t("md.section.description")));
  content.push(...textBlock(ctx.body));

  if (isVideo) {
    content.push(heading(2, t("md.section.media")));
    content.push(paragraph([textNode(t("md.videoAttached"))]));
  } else if (isScreenshot) {
    content.push(heading(2, t("md.section.media")));
    content.push(paragraph([textNode(IMAGE_PLACEHOLDER)]));
  } else {
    content.push(heading(2, t("md.section.styleChanges")));
    content.push(
      table(
        [t("md.column.property"), "As is", "To be"],
        ctx.diffs.map((d) => [d.prop, d.asIs, d.toBe]),
      ),
    );
  }

  content.push(heading(2, t("md.section.expectedResult")));
  content.push(...textBlock(ctx.expectedResult));

  content.push(footerParagraph());

  return { version: 1, type: "doc", content };
}

function footerParagraph(): AdfNode {
  const url = (import.meta.env.VITE_WEBSTORE_URL as string | undefined) ?? "";
  const brandMarks: { type: string; attrs?: Record<string, unknown> }[] = [
    { type: "em" },
  ];
  if (url) brandMarks.push({ type: "link", attrs: { href: url } });
  return {
    type: "paragraph",
    content: [
      { type: "text", text: "Reported via ", marks: [{ type: "em" }] },
      { type: "text", text: "BugShot", marks: brandMarks },
    ],
  };
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
  if (!trimmed) return [paragraph([textNode(t("md.noValue"))])];
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

