import { t } from "@/i18n";
import {
  POST_MEDIA_SECTION_IDS,
  sectionMdLabelKey,
  type IssueSection,
} from "@/store/settings-ui-store";
import { IMAGE_PLACEHOLDER, VIDEO_PLACEHOLDER, inlineImagePlaceholder } from "@/lib/adf-sentinels";
import {
  resolveStyleElements,
  styleDomLabel,
  type MarkdownContext,
} from "./buildIssueMarkdown";
import type { NetworkLogSummary, ConsoleLogSummary } from "./buildLogSummary";
import { filterEnvironmentRows } from "./environmentRows";
import { formatTimestamp } from "./formatTimestamp";
import { markdownToAdf } from "./markdownToAdf";
import { extractInlineRefs, stripInlineImageRefs } from "./resolveInlineImages";

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

export function buildIssueAdf(ctx: MarkdownContext, inlineImageRefIds?: string[]): AdfDoc {
  const content: AdfNode[] = [];
  const uploadedRefSet = new Set(inlineImageRefIds ?? []);
  const isVideo = ctx.captureMode === "video";
  const isScreenshot = ctx.captureMode === "screenshot";
  const isFreeform = ctx.captureMode === "freeform";

  content.push(heading(2, t("md.section.env")));
  const envItems: AdfNode[] = [];
  if (ctx.os) {
    envItems.push(keyValueItem("OS", ctx.os));
  }
  if (ctx.browser) {
    envItems.push(keyValueItem("Browser", ctx.browser));
  }
  envItems.push(keyValueItem("Page", ctx.url));
  const domLabel = styleDomLabel(ctx);
  if (domLabel) {
    envItems.push(keyValueItem("DOM", domLabel));
  }
  if (ctx.viewport) {
    envItems.push(keyValueItem("Viewport", `${ctx.viewport.width}×${ctx.viewport.height}`));
  }
  envItems.push(keyValueItem("Captured", formatTimestamp(ctx.capturedAt)));
  for (const row of filterEnvironmentRows(ctx.environment)) {
    envItems.push(keyValueItem(row.label, row.value));
  }
  content.push(bulletList(envItems));

  let mediaEmitted = false;
  const emitMedia = () => {
    if (mediaEmitted) return;
    mediaEmitted = true;
    if (isFreeform) {
      // no media section
    } else if (isVideo) {
      content.push(heading(2, t("md.section.media")));
      content.push(paragraph([textNode(VIDEO_PLACEHOLDER)]));
    } else if (isScreenshot) {
      content.push(heading(2, t("md.section.media")));
      content.push(paragraph([textNode(IMAGE_PLACEHOLDER)]));
    } else {
      // element 모드: styleElements마다 heading + 텍스트 table(이미지 셀 없음). before/after
      // Snapshot 행은 messages.ts 제출 후처리가 업로드 후 i번째 table에 splice(A-4b).
      for (const el of resolveStyleElements(ctx)) {
        content.push(heading(2, `${t("md.section.styleChanges")} (${el.selector})`));
        content.push(
          table(
            [t("md.column.property"), "As is", "To be"],
            el.diffs.map((d) => [d.prop, d.asIs, d.toBe]),
          ),
        );
      }
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
      const sectionRefs = extractInlineRefs(raw).filter((r) => uploadedRefSet.has(r));
      const processed = sectionRefs.length > 0 ? stripInlineImageRefs(raw) : raw;
      if (processed.trim() || sectionRefs.length === 0) {
        content.push(...markdownToAdf(processed));
      }
      for (const refId of sectionRefs) {
        content.push(paragraph([textNode(inlineImagePlaceholder(refId))]));
      }
    }
  }

  emitMedia();

  content.push({ type: "rule" });
  content.push(footerParagraph());

  return { version: 1, type: "doc", content };
}

function footerParagraph(): AdfNode {
  const brandMarks: { type: string; attrs?: Record<string, unknown> }[] = [
    { type: "em" },
    { type: "link", attrs: { href: "https://bug-shot.com" } },
  ];
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
          // Jira ADF는 빈 text 노드를 거부(400) — 빈 셀(class 전부 제거 등)은 빈 paragraph로.
          content: [paragraph(cell === "" ? [] : [textNode(cell)])],
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
  if (!net && !con) return;
  content.push(heading(2, t("logSummary.title")));
  const items: AdfNode[] = [];
  if (net) {
    const line = net.errors.length > 0
      ? t("logSummary.network.line", { n: net.captured, errors: net.errors.length })
      : t("logSummary.network.lineNoError", { n: net.captured });
    items.push(listItem([paragraph([textNode(line)])]));
  }
  if (con) {
    const line = con.errorCount > 0 || con.warnCount > 0
      ? t("logSummary.console.line", { n: con.captured, errors: con.errorCount, warns: con.warnCount })
      : t("logSummary.console.lineNoError", { n: con.captured });
    items.push(listItem([paragraph([textNode(line)])]));
  }
  content.push(bulletList(items));
  content.push(paragraph(logsDetailNodes()));
}

// "logs.html"을 별도 em 노드로 분리해 emit한다. 제출 후처리(injectLogsLink)가
// 이 노드에 link mark를 붙여 본문에서 첨부로 점프하게 한다.
function logsDetailNodes(): AdfNode[] {
  const em = [{ type: "em" }];
  const segments = t("logSummary.logs.detail").split("{file}");
  const nodes: AdfNode[] = [];
  segments.forEach((seg, i) => {
    if (seg) nodes.push({ type: "text", text: seg, marks: em });
    if (i < segments.length - 1) nodes.push({ type: "text", text: "logs.html", marks: em });
  });
  return nodes;
}
