import { t } from "@/i18n";
import {
  POST_MEDIA_SECTION_IDS,
  sectionMdLabelKey,
  type IssueSection,
} from "@/store/app-settings-store";
import type { NetworkRequest } from "@/types/network";
import type { StyleDiffRow } from "../components/StyleChangesTable";
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
  networkLog?: {
    requests: NetworkRequest[];
    selectedIds: string[];
  };
}

export function networkLogPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function buildNetworkLogMd(ctx: MarkdownContext): string[] {
  if (!ctx.networkLog || ctx.networkLog.selectedIds.length === 0) return [];
  const selected = new Set(ctx.networkLog.selectedIds);
  const reqs = ctx.networkLog.requests.filter((r) => selected.has(r.id));
  if (reqs.length === 0) return [];
  const lines: string[] = [];
  lines.push(`## ${t("networkLog.dialog.title")}`);
  lines.push("");
  lines.push("| Method | Path | Status | Time |");
  lines.push("|--------|------|--------|------|");
  for (const r of reqs) {
    lines.push(`| ${r.method} | ${escapeCell(networkLogPath(r.url))} | ${r.status} ${escapeCell(r.statusText)} | ${r.durationMs}ms |`);
  }
  lines.push("");
  lines.push(t("networkLog.har.summary"));
  lines.push("");
  return lines;
}

function buildNetworkLogHtml(ctx: MarkdownContext): string[] {
  if (!ctx.networkLog || ctx.networkLog.selectedIds.length === 0) return [];
  const selected = new Set(ctx.networkLog.selectedIds);
  const reqs = ctx.networkLog.requests.filter((r) => selected.has(r.id));
  if (reqs.length === 0) return [];
  const parts: string[] = [];
  parts.push(`<h2>${escapeHtml(t("networkLog.dialog.title"))}</h2>`);
  parts.push("<table><thead><tr><th>Method</th><th>Path</th><th>Status</th><th>Time</th></tr></thead><tbody>");
  for (const r of reqs) {
    parts.push(`<tr><td>${escapeHtml(r.method)}</td><td>${escapeHtml(networkLogPath(r.url))}</td><td>${r.status} ${escapeHtml(r.statusText)}</td><td>${r.durationMs}ms</td></tr>`);
  }
  parts.push("</tbody></table>");
  parts.push(`<p>${escapeHtml(t("networkLog.har.summary"))}</p>`);
  return parts;
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
  };

  let networkLogEmitted = false;
  const emitNetworkLog = () => {
    if (networkLogEmitted) return;
    networkLogEmitted = true;
    lines.push(...buildNetworkLogMd(ctx));
  };

  for (const section of ctx.sectionConfig) {
    if (!section.enabled) continue;
    if (POST_MEDIA_SECTION_IDS.has(section.id)) {
      emitMedia();
      emitNetworkLog();
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
  emitNetworkLog();

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
  };

  let networkLogEmittedHtml = false;
  const emitNetworkLogHtml = () => {
    if (networkLogEmittedHtml) return;
    networkLogEmittedHtml = true;
    parts.push(...buildNetworkLogHtml(ctx));
  };

  for (const section of ctx.sectionConfig) {
    if (!section.enabled) continue;
    if (POST_MEDIA_SECTION_IDS.has(section.id)) {
      emitMedia();
      emitNetworkLogHtml();
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
  emitNetworkLogHtml();

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
