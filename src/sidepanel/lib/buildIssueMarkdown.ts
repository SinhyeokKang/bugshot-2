import { t } from "@/i18n";
import type { StyleDiffRow } from "../components/StyleChangesTable";
import { formatTimestamp } from "./formatTimestamp";

export interface MarkdownContext {
  captureMode?: "element" | "screenshot" | "video";
  title: string;
  body: string;
  expectedResult: string;
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

  lines.push(`## ${t("md.section.description")}`);
  lines.push("");
  lines.push(ctx.body);
  lines.push("");

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

  lines.push(`## ${t("md.section.expectedResult")}`);
  lines.push("");
  lines.push(ctx.expectedResult);
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

  parts.push(`<h2>${t("md.section.description")}</h2>`);
  parts.push(paragraphize(ctx.body));

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

  parts.push(`<h2>${t("md.section.expectedResult")}</h2>`);
  parts.push(paragraphize(ctx.expectedResult));

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

