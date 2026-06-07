import { t } from "@/i18n";
import {
  POST_MEDIA_SECTION_IDS,
  sectionMdLabelKey,
  type IssueSection,
} from "@/store/settings-ui-store";
import type { StyleDiffRow } from "@/sidepanel/components/StyleChangesTable";
import type { NetworkLogSummary, ConsoleLogSummary } from "./buildLogSummary";
import { filterEnvironmentRows, type EnvironmentRow } from "./environmentRows";
import { formatTimestamp } from "./formatTimestamp";
import { renderMarkdown } from "./renderMarkdown";

export interface MarkdownContext {
  os?: string | null;
  browser?: string | null;
  captureMode?: "element" | "screenshot" | "video" | "freeform";
  title: string;
  sections: Record<string, string>;
  sectionConfig: IssueSection[];
  url: string;
  selector: string;
  tagName: string;
  classListBefore: string[];
  classListAfter: string[];
  specifiedStyles: Record<string, string>;
  tokens: { name: string; value: string }[];
  viewport: { width: number; height: number } | null;
  capturedAt: number;
  diffs: StyleDiffRow[];
  environment: EnvironmentRow[];
  networkLogSummary?: NetworkLogSummary;
  consoleLogSummary?: ConsoleLogSummary;
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

export function buildIssueMarkdown(ctx: MarkdownContext): string {
  const lines: string[] = [];

  lines.push(buildMetaComment(ctx));
  lines.push("");
  lines.push(`# ${ctx.title}`);
  lines.push("");

  lines.push(`## ${t("md.section.env")}`);
  lines.push("");
  if (ctx.os) {
    lines.push(`- **OS**: ${ctx.os}`);
  }
  if (ctx.browser) {
    lines.push(`- **Browser**: ${ctx.browser}`);
  }
  lines.push(`- **Page**: ${ctx.url}`);
  if (ctx.selector) {
    lines.push(`- **DOM**: ${ctx.selector}`);
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
    if (ctx.captureMode === "freeform") {
      // no media section
    } else if (ctx.captureMode === "video") {
      lines.push(`## ${t("md.section.media")}`);
      lines.push("");
      lines.push(t("md.videoAttached"));
      lines.push("");
    } else if (ctx.captureMode === "screenshot") {
      lines.push(`## ${t("md.section.media")}`);
      lines.push("");
      lines.push(t("md.imageAttached"));
      lines.push("");
    } else {
      if (ctx.diffs.length > 0) {
        lines.push(`## ${t("md.section.styleChanges")}`);
        lines.push("");
        lines.push(`| ${t("md.column.property")} | As is | To be |`);
        lines.push("| --- | --- | --- |");
        for (const d of ctx.diffs) {
          lines.push(
            `| ${escapeCell(d.prop)} | ${escapeCell(d.asIs)} | ${escapeCell(d.toBe)} |`,
          );
        }
        lines.push("");
      } else {
        lines.push(`## ${t("md.section.media")}`);
        lines.push("");
        lines.push(t("md.imageAttached"));
        lines.push("");
      }
    }
    emitLogSummaryMd(lines, ctx);
  };

  for (const section of ctx.sectionConfig) {
    if (!section.enabled) continue;
    if (POST_MEDIA_SECTION_IDS.has(section.id)) {
      emitMedia();
    }
    const content = ctx.sections[section.id] ?? "";
    lines.push(`## ${sectionLabel(section)}`);
    lines.push("");
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

  lines.push("---");
  lines.push("");
  lines.push(footerMarkdown());
  lines.push("");

  return lines.join("\n");
}

export function buildIssueHtml(ctx: MarkdownContext): string {
  const parts: string[] = [];

  parts.push(buildMetaComment(ctx));
  parts.push(`<h1>${escapeHtml(ctx.title)}</h1>`);

  parts.push(`<h2>${t("md.section.env")}</h2>`);
  parts.push(`<ul>`);
  if (ctx.os) {
    parts.push(`<li><strong>OS</strong>: ${escapeHtml(ctx.os)}</li>`);
  }
  if (ctx.browser) {
    parts.push(`<li><strong>Browser</strong>: ${escapeHtml(ctx.browser)}</li>`);
  }
  parts.push(`<li><strong>Page</strong>: ${escapeHtml(ctx.url)}</li>`);
  if (ctx.selector) {
    parts.push(`<li><strong>DOM</strong>: ${escapeHtml(ctx.selector)}</li>`);
  }
  if (ctx.viewport) {
    parts.push(
      `<li><strong>Viewport</strong>: ${ctx.viewport.width}×${ctx.viewport.height}</li>`,
    );
  }
  parts.push(
    `<li><strong>Captured</strong>: ${escapeHtml(formatTimestamp(ctx.capturedAt))}</li>`,
  );
  for (const row of filterEnvironmentRows(ctx.environment)) {
    parts.push(
      `<li><strong>${escapeHtml(row.label)}</strong>: ${escapeHtml(row.value)}</li>`,
    );
  }
  parts.push(`</ul>`);

  let mediaEmitted = false;
  const emitMedia = () => {
    if (mediaEmitted) return;
    mediaEmitted = true;
    if (ctx.captureMode === "freeform") {
      // no media section
    } else if (ctx.captureMode === "video") {
      parts.push(`<h2>${t("md.section.media")}</h2>`);
      parts.push(`<p>${t("md.videoAttached")}</p>`);
    } else if (ctx.captureMode === "screenshot") {
      parts.push(`<h2>${t("md.section.media")}</h2>`);
      parts.push(`<p>${t("md.imageAttached")}</p>`);
    } else {
      if (ctx.diffs.length > 0) {
        parts.push(`<h2>${t("md.section.styleChanges")}</h2>`);
        parts.push(
          `<table><thead><tr><th>${t("md.column.property")}</th><th>As is</th><th>To be</th></tr></thead><tbody>`,
        );
        for (const d of ctx.diffs) {
          parts.push(
            `<tr><td>${escapeHtml(d.prop)}</td><td>${escapeHtml(d.asIs)}</td><td>${escapeHtml(d.toBe)}</td></tr>`,
          );
        }
        parts.push(`</tbody></table>`);
      } else {
        parts.push(`<h2>${t("md.section.media")}</h2>`);
        parts.push(`<p>${t("md.imageAttached")}</p>`);
      }
    }
    emitLogSummaryHtml(parts, ctx);
  };

  for (const section of ctx.sectionConfig) {
    if (!section.enabled) continue;
    if (POST_MEDIA_SECTION_IDS.has(section.id)) {
      emitMedia();
    }
    const content = ctx.sections[section.id] ?? "";
    parts.push(`<h2>${escapeHtml(sectionLabel(section))}</h2>`);
    if (section.renderAs === "orderedList") {
      const items = listItems(content);
      if (items.length === 0) {
        parts.push(`<p>${escapeHtml(t("md.noValue"))}</p>`);
      } else {
        parts.push(
          `<ol>${items.map((it) => `<li>${escapeHtml(it)}</li>`).join("")}</ol>`,
        );
      }
    } else {
      parts.push(
        content.trim()
          ? renderMarkdown(content)
          : `<p>${escapeHtml(t("md.noValue"))}</p>`,
      );
    }
  }

  emitMedia();

  parts.push("<hr>");
  parts.push(footerHtml());

  return parts.join("\n");
}

function footerMarkdown(): string {
  return `_Reported via [BugShot](https://bug-shot.com)_`;
}

function footerHtml(): string {
  return `<p><em>Reported via <a href="https://bug-shot.com">BugShot</a></em></p>`;
}

function buildMetaComment(ctx: MarkdownContext): string {
  const meta: Record<string, unknown> = {
    version: 1,
    captureMode: ctx.captureMode ?? "element",
    url: ctx.url,
    capturedAt: ctx.capturedAt,
  };
  if (ctx.os) meta.os = ctx.os;
  if (ctx.browser) meta.browser = ctx.browser;
  if (ctx.viewport) meta.viewport = ctx.viewport;
  const envRows = filterEnvironmentRows(ctx.environment);
  if (envRows.length > 0) {
    meta.environment = Object.fromEntries(envRows.map((r) => [r.label, r.value]));
  }
  if (ctx.captureMode !== "freeform") {
    meta.selector = ctx.selector;
    meta.tagName = ctx.tagName;
    meta.classListBefore = ctx.classListBefore;
    meta.classListAfter = ctx.classListAfter;
    meta.specifiedStyles = ctx.specifiedStyles;
    meta.cssChanges = ctx.diffs.map((d) => ({
      property: d.prop,
      from: d.asIs,
      to: d.toBe,
    }));
    meta.tokens = ctx.tokens;
  }
  return `<!-- bugshot-meta-for-ai\n${JSON.stringify(meta, null, 2)}\n-->`;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function emitLogSummaryMd(lines: string[], ctx: MarkdownContext): void {
  const { networkLogSummary: net, consoleLogSummary: con } = ctx;
  if (!net && !con) return;
  lines.push(`## ${t("logSummary.title")}`);
  lines.push("");
  if (net) {
    lines.push(
      net.errors.length > 0
        ? `- ${t("logSummary.network.line", { n: net.captured, errors: net.errors.length })}`
        : `- ${t("logSummary.network.lineNoError", { n: net.captured })}`,
    );
  }
  if (con) {
    lines.push(
      con.errorCount > 0 || con.warnCount > 0
        ? `- ${t("logSummary.console.line", { n: con.captured, errors: con.errorCount, warns: con.warnCount })}`
        : `- ${t("logSummary.console.lineNoError", { n: con.captured })}`,
    );
  }
  lines.push("");
  lines.push(`_${t("logSummary.logs.detail")}_`);
  lines.push("");
}

function emitLogSummaryHtml(parts: string[], ctx: MarkdownContext): void {
  const { networkLogSummary: net, consoleLogSummary: con } = ctx;
  if (!net && !con) return;
  parts.push(`<h2>${escapeHtml(t("logSummary.title"))}</h2>`);
  parts.push("<ul>");
  if (net) {
    const line = net.errors.length > 0
      ? t("logSummary.network.line", { n: net.captured, errors: net.errors.length })
      : t("logSummary.network.lineNoError", { n: net.captured });
    parts.push(`<li>${escapeHtml(line)}</li>`);
  }
  if (con) {
    const line = con.errorCount > 0 || con.warnCount > 0
      ? t("logSummary.console.line", { n: con.captured, errors: con.errorCount, warns: con.warnCount })
      : t("logSummary.console.lineNoError", { n: con.captured });
    parts.push(`<li>${escapeHtml(line)}</li>`);
  }
  parts.push("</ul>");
  parts.push(`<p><em>${escapeHtml(t("logSummary.logs.detail"))}</em></p>`);
}
