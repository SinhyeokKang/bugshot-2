import { t } from "@/i18n";
import {
  POST_MEDIA_SECTION_IDS,
  sectionMdLabelKey,
  type IssueSection,
} from "@/store/app-settings-store";
import type { StyleDiffRow } from "../components/StyleChangesTable";
import type { NetworkLogSummary, ConsoleLogSummary } from "./buildLogSummary";
import { formatTimestamp } from "./formatTimestamp";

export interface MarkdownContext {
  captureMode?: "element" | "screenshot" | "video";
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
  viewport: { width: number; height: number };
  capturedAt: number;
  diffs: StyleDiffRow[];
  networkLogSummary?: NetworkLogSummary;
  consoleLogSummary?: ConsoleLogSummary;
}

export function networkLogPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
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
  lines.push(`- **Page**: ${ctx.url}`);
  if (ctx.captureMode !== "screenshot" && ctx.captureMode !== "video" && ctx.selector) {
    lines.push(`- **DOM**: ${ctx.selector}`);
  }
  lines.push(`- **Viewport**: ${ctx.viewport.width}×${ctx.viewport.height}`);
  lines.push(`- **Captured**: ${formatTimestamp(ctx.capturedAt)}`);
  lines.push("");

  let mediaEmitted = false;
  const emitMedia = () => {
    if (mediaEmitted) return;
    mediaEmitted = true;
    if (ctx.captureMode === "video") {
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
      lines.push(`## ${t("md.section.styleChanges")}`);
      lines.push("");
      if (ctx.diffs.length > 0) {
        lines.push(`| ${t("md.column.property")} | As is | To be |`);
        lines.push("| --- | --- | --- |");
        for (const d of ctx.diffs) {
          lines.push(
            `| ${escapeCell(d.prop)} | ${escapeCell(d.asIs)} | ${escapeCell(d.toBe)} |`,
          );
        }
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
  parts.push(`<li><strong>Page</strong>: ${escapeHtml(ctx.url)}</li>`);
  if (ctx.captureMode !== "screenshot" && ctx.captureMode !== "video" && ctx.selector) {
    parts.push(`<li><strong>DOM</strong>: ${escapeHtml(ctx.selector)}</li>`);
  }
  parts.push(
    `<li><strong>Viewport</strong>: ${ctx.viewport.width}×${ctx.viewport.height}</li>`,
  );
  parts.push(
    `<li><strong>Captured</strong>: ${escapeHtml(formatTimestamp(ctx.capturedAt))}</li>`,
  );
  parts.push(`</ul>`);

  let mediaEmitted = false;
  const emitMedia = () => {
    if (mediaEmitted) return;
    mediaEmitted = true;
    if (ctx.captureMode === "video") {
      parts.push(`<h2>${t("md.section.media")}</h2>`);
      parts.push(`<p>${t("md.videoAttached")}</p>`);
    } else if (ctx.captureMode === "screenshot") {
      parts.push(`<h2>${t("md.section.media")}</h2>`);
      parts.push(`<p>${t("md.imageAttached")}</p>`);
    } else {
      parts.push(`<h2>${t("md.section.styleChanges")}</h2>`);
      if (ctx.diffs.length > 0) {
        parts.push(
          `<table><thead><tr><th>${t("md.column.property")}</th><th>As is</th><th>To be</th></tr></thead><tbody>`,
        );
        for (const d of ctx.diffs) {
          parts.push(
            `<tr><td>${escapeHtml(d.prop)}</td><td>${escapeHtml(d.asIs)}</td><td>${escapeHtml(d.toBe)}</td></tr>`,
          );
        }
        parts.push(`</tbody></table>`);
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
          ? paragraphize(content)
          : `<p>${escapeHtml(t("md.noValue"))}</p>`,
      );
    }
  }

  emitMedia();

  parts.push("<hr>");
  parts.push(footerHtml());

  return parts.join("\n");
}

function webstoreUrl(): string {
  return (import.meta.env.VITE_WEBSTORE_URL as string | undefined) ?? "";
}

function footerMarkdown(): string {
  const url = webstoreUrl();
  const brand = url ? `[BugShot](${url})` : "BugShot";
  return `_Reported via ${brand}_`;
}

function footerHtml(): string {
  const url = webstoreUrl();
  const brand = url
    ? `<a href="${escapeHtml(url)}">BugShot</a>`
    : "BugShot";
  return `<p><em>Reported via ${brand}</em></p>`;
}

function buildMetaComment(ctx: MarkdownContext): string {
  const meta = {
    version: 1,
    url: ctx.url,
    selector: ctx.selector,
    tagName: ctx.tagName,
    viewport: ctx.viewport,
    capturedAt: ctx.capturedAt,
    classListBefore: ctx.classListBefore,
    classListAfter: ctx.classListAfter,
    specifiedStyles: ctx.specifiedStyles,
    cssChanges: ctx.diffs.map((d) => ({
      property: d.prop,
      from: d.asIs,
      to: d.toBe,
    })),
    tokens: ctx.tokens,
  };
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

function paragraphize(text: string): string {
  if (!text.trim()) return "<p></p>";
  return text
    .split(/\n\s*\n/)
    .map((p) => {
      const lines = p.split(/\n/).map(escapeHtml).join("<br>");
      return `<p>${lines}</p>`;
    })
    .join("\n");
}

function emitLogSummaryMd(lines: string[], ctx: MarkdownContext): void {
  const { networkLogSummary: net, consoleLogSummary: con } = ctx;
  if (net) {
    lines.push(`## ${t("logSummary.network.title")}`);
    lines.push("");
    if (net.errors.length > 0) {
      lines.push(t("logSummary.network.captured", { n: net.captured, errors: net.errors.length }));
      for (const e of net.errors) {
        lines.push(`- ${e.method} ${e.path} → ${e.status} ${e.statusText}`);
      }
    } else {
      lines.push(t("logSummary.network.capturedNoError", { n: net.captured }));
    }
    lines.push("");
    lines.push(`_${t("logSummary.network.detail")}_`);
    lines.push("");
  }
  if (con) {
    lines.push(`## ${t("logSummary.console.title")}`);
    lines.push("");
    if (con.errorCount > 0 || con.warnCount > 0) {
      lines.push(t("logSummary.console.captured", { n: con.captured, errors: con.errorCount, warns: con.warnCount }));
      for (const msg of con.topErrors) {
        lines.push(`- ${msg}`);
      }
    } else {
      lines.push(t("logSummary.console.capturedNoError", { n: con.captured }));
    }
    lines.push("");
    lines.push(`_${t("logSummary.console.detail")}_`);
    lines.push("");
  }
}

function emitLogSummaryHtml(parts: string[], ctx: MarkdownContext): void {
  const { networkLogSummary: net, consoleLogSummary: con } = ctx;
  if (net) {
    parts.push(`<h2>${escapeHtml(t("logSummary.network.title"))}</h2>`);
    if (net.errors.length > 0) {
      parts.push(`<p>${escapeHtml(t("logSummary.network.captured", { n: net.captured, errors: net.errors.length }))}</p>`);
      parts.push("<ul>");
      for (const e of net.errors) {
        parts.push(`<li>${escapeHtml(`${e.method} ${e.path} → ${e.status} ${e.statusText}`)}</li>`);
      }
      parts.push("</ul>");
    } else {
      parts.push(`<p>${escapeHtml(t("logSummary.network.capturedNoError", { n: net.captured }))}</p>`);
    }
    parts.push(`<p><em>${escapeHtml(t("logSummary.network.detail"))}</em></p>`);
  }
  if (con) {
    parts.push(`<h2>${escapeHtml(t("logSummary.console.title"))}</h2>`);
    if (con.errorCount > 0 || con.warnCount > 0) {
      parts.push(`<p>${escapeHtml(t("logSummary.console.captured", { n: con.captured, errors: con.errorCount, warns: con.warnCount }))}</p>`);
      parts.push("<ul>");
      for (const msg of con.topErrors) {
        parts.push(`<li>${escapeHtml(msg)}</li>`);
      }
      parts.push("</ul>");
    } else {
      parts.push(`<p>${escapeHtml(t("logSummary.console.capturedNoError", { n: con.captured }))}</p>`);
    }
    parts.push(`<p><em>${escapeHtml(t("logSummary.console.detail"))}</em></p>`);
  }
}
