import { t } from "@/i18n";
import {
  POST_MEDIA_SECTION_IDS,
  sectionMdLabelKey,
  type IssueSection,
} from "@/store/app-settings-store";
import { IMAGE_PLACEHOLDER } from "@/lib/adf-sentinels";
import { formatElementName } from "@/lib/element-label";
import type { MarkdownContext } from "./buildIssueMarkdown";
import type { NetworkLogSummary, ConsoleLogSummary } from "./buildLogSummary";
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

function sectionLabel(section: IssueSection): string {
  return section.labelOverride?.trim() || t(sectionMdLabelKey(section.id));
}

function listItems(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function buildIssueAdf(ctx: MarkdownContext): AdfDoc {
  const content: AdfNode[] = [];
  const isVideo = ctx.captureMode === "video";
  const isScreenshot = ctx.captureMode === "screenshot";

  content.push(heading(2, t("md.section.env")));
  if (isVideo || isScreenshot) {
    content.push(
      bulletList([
        keyValueItem("Page", ctx.url),
        keyValueItem("Viewport", `${ctx.viewport.width}×${ctx.viewport.height}`),
        keyValueItem("Captured", formatTimestamp(ctx.capturedAt)),
      ]),
    );
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

  let mediaEmitted = false;
  const emitMedia = () => {
    if (mediaEmitted) return;
    mediaEmitted = true;
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
    emitLogSummaryAdf(content, ctx.networkLogSummary, ctx.consoleLogSummary);
  };

  for (const section of ctx.sectionConfig) {
    if (!section.enabled) continue;
    if (POST_MEDIA_SECTION_IDS.has(section.id)) {
      emitMedia();
    }
    const raw = ctx.sections[section.id] ?? "";
    content.push(heading(2, sectionLabel(section)));
    if (section.renderAs === "orderedList") {
      const items = listItems(raw);
      if (items.length === 0) {
        content.push(paragraph([textNode(t("md.noValue"))]));
      } else {
        content.push(orderedList(items.map((it) => listItem([paragraph([textNode(it)])]))));
      }
    } else {
      content.push(...textBlock(raw));
    }
  }

  emitMedia();

  content.push({ type: "rule" });
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

function orderedList(items: AdfNode[]): AdfNode {
  return { type: "orderedList", content: items };
}

function listItem(children: AdfNode[]): AdfNode {
  return { type: "listItem", content: children };
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

function emitLogSummaryAdf(
  content: AdfNode[],
  net: NetworkLogSummary | undefined,
  con: ConsoleLogSummary | undefined,
): void {
  if (net) {
    content.push(heading(2, t("logSummary.network.title")));
    if (net.errors.length > 0) {
      content.push(paragraph([textNode(t("logSummary.network.captured", { n: net.captured, errors: net.errors.length }))]));
      content.push(
        bulletList(
          net.errors.map((e) =>
            listItem([paragraph([textNode(`${e.method} ${e.path} → ${e.status} ${e.statusText}`)])]),
          ),
        ),
      );
    } else {
      content.push(paragraph([textNode(t("logSummary.network.capturedNoError", { n: net.captured }))]));
    }
    content.push(paragraph([{ type: "text", text: t("logSummary.network.detail"), marks: [{ type: "em" }] }]));
  }
  if (con) {
    content.push(heading(2, t("logSummary.console.title")));
    if (con.errorCount > 0 || con.warnCount > 0) {
      content.push(paragraph([textNode(t("logSummary.console.captured", { n: con.captured, errors: con.errorCount, warns: con.warnCount }))]));
      if (con.topErrors.length > 0) {
        content.push(
          bulletList(
            con.topErrors.map((msg) =>
              listItem([paragraph([textNode(msg)])]),
            ),
          ),
        );
      }
    } else {
      content.push(paragraph([textNode(t("logSummary.console.capturedNoError", { n: con.captured }))]));
    }
    content.push(paragraph([{ type: "text", text: t("logSummary.console.detail"), marks: [{ type: "em" }] }]));
  }
}
