import { t } from "@/i18n";
import {
  POST_MEDIA_SECTION_IDS,
  sectionMdLabelKey,
  type IssueSection,
} from "@/store/app-settings-store";
import type { MarkdownContext } from "./buildIssueMarkdown";
import { formatTimestamp } from "./formatTimestamp";

export interface LinearMediaInput {
  filename: string;
}

export interface LinearBuildInput {
  ctx: MarkdownContext;
  images?: LinearMediaInput[];
  video?: LinearMediaInput;
  logs?: LinearMediaInput[];
}

export interface LinearBuildResult {
  body: string;
}

function sectionLabel(section: IssueSection): string {
  return section.labelOverride?.trim() || t(sectionMdLabelKey(section.id));
}

function listItems(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function webstoreUrl(): string {
  return (import.meta.env.VITE_WEBSTORE_URL as string | undefined) ?? "";
}

function footerMarkdown(): string {
  const url = webstoreUrl();
  const brand = url ? `[BugShot](${url})` : "BugShot";
  return `_Reported via ${brand}_`;
}

export function buildLinearIssueBody(
  input: LinearBuildInput,
): LinearBuildResult {
  const { ctx, images = [], video, logs = [] } = input;
  const lines: string[] = [];

  lines.push(`## ${t("md.section.env")}`, "");
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

    const allAttachments: LinearMediaInput[] = [
      ...images,
      ...(video ? [video] : []),
      ...logs,
    ];
    if (allAttachments.length > 0) {
      lines.push(`## ${t("md.section.attachments")}`, "");
      lines.push(t("linear.attachmentNotInline"), "");
      for (const a of allAttachments) {
        lines.push(`- \`${a.filename}\``);
      }
      lines.push("");
    }

    if (
      ctx.captureMode !== "video" &&
      ctx.captureMode !== "screenshot" &&
      ctx.diffs.length > 0
    ) {
      lines.push(`## ${t("md.section.styleChanges")}`, "");
      lines.push(`| ${t("md.column.property")} | As is | To be |`);
      lines.push("| --- | --- | --- |");
      for (const d of ctx.diffs) {
        lines.push(
          `| ${escapeCell(d.prop)} | ${escapeCell(d.asIs)} | ${escapeCell(d.toBe)} |`,
        );
      }
      lines.push("");
    }

    emitLogSummary(lines, ctx);
  };

  for (const section of ctx.sectionConfig) {
    if (!section.enabled) continue;
    if (POST_MEDIA_SECTION_IDS.has(section.id)) {
      emitMedia();
    }
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

  lines.push("---", "");
  lines.push(footerMarkdown(), "");

  return { body: lines.join("\n") };
}

function emitLogSummary(lines: string[], ctx: MarkdownContext): void {
  const { networkLogSummary: net, consoleLogSummary: con } = ctx;
  if (net) {
    lines.push(`## ${t("logSummary.network.title")}`, "");
    if (net.errors.length > 0) {
      lines.push(
        t("logSummary.network.captured", {
          n: net.captured,
          errors: net.errors.length,
        }),
      );
      for (const e of net.errors) {
        lines.push(`- ${e.method} ${e.path} → ${e.status} ${e.statusText}`);
      }
    } else {
      lines.push(t("logSummary.network.capturedNoError", { n: net.captured }));
    }
    lines.push("", `_${t("logSummary.network.detail")}_`, "");
  }
  if (con) {
    lines.push(`## ${t("logSummary.console.title")}`, "");
    if (con.errorCount > 0 || con.warnCount > 0) {
      lines.push(
        t("logSummary.console.captured", {
          n: con.captured,
          errors: con.errorCount,
          warns: con.warnCount,
        }),
      );
      for (const msg of con.topErrors) {
        lines.push(`- ${msg}`);
      }
    } else {
      lines.push(t("logSummary.console.capturedNoError", { n: con.captured }));
    }
    lines.push("", `_${t("logSummary.console.detail")}_`, "");
  }
}
