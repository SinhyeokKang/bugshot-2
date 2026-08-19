import { t, withLocale } from "@/i18n";
import { escapeTableCell as escapeCell } from "./markdownCell";
import { bodyBlocks } from "./bodyBlocks";
import {
  mdInlineCode,
  resolveStyleElements,
  styleDomLabel,
  type MarkdownContext,
} from "./buildIssueMarkdown";
import { ccMarkdownLine } from "./ccMention";
import { segmentsToMarkdown } from "./classDiff";
import { filterEnvironmentRows } from "./environmentRows";
import { formatTimestamp } from "./formatTimestamp";
import { emitMarkdownLogSummary, footerMarkdown, imageCell, listItems, sectionLabel } from "./issueBodyShared";

export interface LinearMediaInput {
  filename: string;
  assetUrl?: string;
}

export interface LinearBuildInput {
  ctx: MarkdownContext;
  images?: LinearMediaInput[];
  video?: LinearMediaInput;
  cc?: string[];
}

export interface LinearBuildResult {
  body: string;
}

export function buildLinearIssueBody(
  input: LinearBuildInput,
): LinearBuildResult {
  return withLocale(input.ctx.bodyLocale, () => buildLinearIssueBodyInner(input));
}

function buildLinearIssueBodyInner(
  input: LinearBuildInput,
): LinearBuildResult {
  const { ctx, images = [], video } = input;
  const lines: string[] = [];
  const isVideo = ctx.captureMode === "video";
  const isScreenshot = ctx.captureMode === "screenshot";
  const isFreeform = ctx.captureMode === "freeform";

  lines.push(`## ${t("md.section.env")}`, "");
  if (ctx.os) {
    lines.push(`- **OS**: ${ctx.os}`);
  }
  if (ctx.browser) {
    lines.push(`- **Browser**: ${ctx.browser}`);
  }
  lines.push(`- **Page**: ${ctx.url}`);
  const domLabel = styleDomLabel(ctx, mdInlineCode);
  if (domLabel) {
    lines.push(`- **DOM**: ${domLabel}`);
  }
  if (ctx.viewport) {
    lines.push(`- **Viewport**: ${ctx.viewport.width}×${ctx.viewport.height}`);
  }
  lines.push(`- **Captured**: ${formatTimestamp(ctx.capturedAt)}`);
  for (const row of filterEnvironmentRows(ctx.environment)) {
    lines.push(`- **${row.label}**: ${row.value}`);
  }
  lines.push("");

  let mediaEmitted = false;
  const emitMedia = () => {
    if (mediaEmitted) return;
    mediaEmitted = true;

    if (isFreeform) {
      // no media section
    } else if (isVideo) {
      lines.push(`## ${t("md.section.media")}`, "");
      if (video?.assetUrl) {
        lines.push(`![${video.filename}](${video.assetUrl})`);
      } else {
        lines.push(t("md.videoAttached"));
      }
      lines.push("");
    } else if (isScreenshot) {
      lines.push(`## ${t("md.section.media")}`, "");
      const img = images[0];
      if (img?.assetUrl) {
        lines.push(`![${img.filename}](${img.assetUrl})`);
      }
      lines.push("");
    } else {
      // element 모드: styleElements 반복(단수도 1개짜리). 각 섹션이 자기 before-${i}/after-${i}.
      for (const el of resolveStyleElements(ctx)) {
        const before = images.find((im) => im.filename === el.beforeFilename);
        const after = images.find((im) => im.filename === el.afterFilename);
        const hasSnapshots = !!(before?.assetUrl || after?.assetUrl);

        lines.push(`## ${t("md.section.styleChanges")} (${el.selector})`, "");
        lines.push(`| ${t("md.column.property")} | As is | To be |`);
        lines.push("| --- | --- | --- |");
        if (hasSnapshots) {
          lines.push(
            `| **${t("styleTable.snapshot")}** | ${imageCell(before && { filename: before.filename, url: before.assetUrl })} | ${imageCell(after && { filename: after.filename, url: after.assetUrl })} |`,
          );
        }
        for (const d of el.diffs) {
          const asIs = d.asIsSegments ? segmentsToMarkdown(d.asIsSegments) : escapeCell(d.asIs);
          const toBe = d.toBeSegments ? segmentsToMarkdown(d.toBeSegments) : escapeCell(d.toBe);
          lines.push(`| ${escapeCell(d.prop)} | ${asIs} | ${toBe} |`);
        }
        lines.push("");
      }
    }

    emitMarkdownLogSummary(lines, ctx);
  };

  for (const block of bodyBlocks(ctx.sectionConfig)) {
    if (block.kind === "meta") {
      emitMedia();
      continue;
    }
    const section = block.section;
    const content = ctx.sections[section.id] ?? "";
    lines.push(`## ${sectionLabel(section)}`, "");
    if (section.renderAs === "orderedList") {
      const items = listItems(content);
      if (items.length === 0) {
        lines.push(t("md.noValue"));
      } else {
        items.forEach((it, idx) => lines.push(`${idx + 1}. ${it}`));
      }
    } else {
      lines.push(content.trim() ? content : t("md.noValue"));
    }
    lines.push("");
  }

  emitMedia();

  const ccLine = ccMarkdownLine(input.cc ?? []);
  if (ccLine) lines.push(ccLine, "");

  lines.push("---", "");
  lines.push(footerMarkdown(), "");

  return { body: lines.join("\n") };
}

