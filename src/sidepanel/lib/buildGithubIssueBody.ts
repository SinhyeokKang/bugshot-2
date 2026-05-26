import { t } from "@/i18n";
import {
  POST_MEDIA_SECTION_IDS,
  sectionMdLabelKey,
  type IssueSection,
} from "@/store/settings-ui-store";
import type { MarkdownContext } from "./buildIssueMarkdown";
import { filterEnvironmentRows } from "./environmentRows";
import { formatTimestamp } from "./formatTimestamp";

export interface GithubMediaInput {
  filename: string;
  contentType: string;
  url?: string;
}

export interface GithubBuildInput {
  ctx: MarkdownContext;
  images?: GithubMediaInput[];
  video?: GithubMediaInput;
  logs?: GithubMediaInput[];
}

export interface GithubBuildResult {
  body: string;
  attached: string[];
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

function imageCell(media: GithubMediaInput | undefined): string {
  if (!media?.url) return "";
  return `![${media.filename}](${media.url})`;
}

function footerMarkdown(): string {
  return `_Reported via [BugShot](https://bug-shot.com)_`;
}

export function buildGithubIssueBody(
  input: GithubBuildInput,
): GithubBuildResult {
  const { ctx, images = [], video, logs = [] } = input;
  const lines: string[] = [];
  const attached: string[] = [];

  lines.push(`## ${t("md.section.env")}`, "");
  if (ctx.os) {
    lines.push(`- **OS**: ${ctx.os}`);
  }
  if (ctx.browser) {
    lines.push(`- **Browser**: ${ctx.browser}`);
  }
  lines.push(`- **Page**: ${ctx.url}`);
  if (ctx.captureMode !== "screenshot" && ctx.captureMode !== "video" && ctx.captureMode !== "freeform" && ctx.selector) {
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

  const isFreeform = ctx.captureMode === "freeform";
  const isElement = ctx.captureMode !== "video" && ctx.captureMode !== "screenshot" && !isFreeform;
  const isVideo = ctx.captureMode === "video";
  const mediaHandled = new Set<string>();

  let mediaEmitted = false;
  const emitMedia = () => {
    if (mediaEmitted) return;
    mediaEmitted = true;

    if (isFreeform) {
      // no media section
    } else if (isElement) {
      const before = images.find((i) => i.filename.startsWith("before"));
      const after = images.find((i) => i.filename.startsWith("after"));
      const hasSnapshots = !!(before?.url || after?.url);

      if (hasSnapshots || ctx.diffs.length > 0) {
        lines.push(`## ${t("md.section.styleChanges")}`, "");
        lines.push(`| ${t("md.column.property")} | As is | To be |`);
        lines.push("| --- | --- | --- |");
        if (hasSnapshots) {
          lines.push(
            `| **${t("styleTable.snapshot")}** | ${imageCell(before)} | ${imageCell(after)} |`,
          );
        }
        for (const d of ctx.diffs) {
          lines.push(
            `| ${escapeCell(d.prop)} | ${escapeCell(d.asIs)} | ${escapeCell(d.toBe)} |`,
          );
        }
        lines.push("");
      } else {
        const screenshot = images.find((i) => i.filename.startsWith("screenshot"));
        lines.push(`## ${t("md.section.media")}`, "");
        if (screenshot?.url) {
          lines.push(`![${screenshot.filename}](${screenshot.url})`);
          attached.push(screenshot.filename);
          mediaHandled.add(screenshot.filename);
        }
        lines.push("");
      }

      if (before?.url) { attached.push(before.filename); mediaHandled.add(before.filename); }
      if (after?.url) { attached.push(after.filename); mediaHandled.add(after.filename); }
    } else if (isVideo && video?.url) {
      lines.push(`## ${t("md.section.media")}`, "");
      lines.push(video.url);
      attached.push(video.filename);
      mediaHandled.add(video.filename);
      lines.push("");
    } else if (!isVideo && images[0]?.url) {
      lines.push(`## ${t("md.section.media")}`, "");
      lines.push(`![${images[0].filename}](${images[0].url})`);
      attached.push(images[0].filename);
      mediaHandled.add(images[0].filename);
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

  const extras: GithubMediaInput[] = [
    ...images.filter((i) => !mediaHandled.has(i.filename)),
    ...(video && !mediaHandled.has(video.filename) ? [video] : []),
    ...logs,
  ];
  emitAttachments(lines, attached, extras);

  lines.push("---", "");
  lines.push(footerMarkdown(), "");

  return { body: lines.join("\n"), attached };
}

function emitAttachments(
  lines: string[],
  attached: string[],
  items: GithubMediaInput[],
): void {
  if (items.length === 0) return;
  const inlined = items.filter((a) => a.url);
  const notInlined = items.filter((a) => !a.url);

  if (inlined.length > 0) {
    lines.push(`## ${t("md.section.attachments")}`, "");
    for (const a of inlined) {
      if (a.contentType.startsWith("image/")) {
        lines.push(`![${a.filename}](${a.url})`);
      } else if (a.contentType.startsWith("video/")) {
        lines.push(a.url!);
      } else {
        lines.push(`[${a.filename}](${a.url})`);
      }
      attached.push(a.filename);
    }
    lines.push("");
  }

  if (notInlined.length > 0) {
    if (inlined.length === 0) lines.push(`## ${t("md.section.attachments")}`, "");
    lines.push(t("github.attachmentNotInline"), "");
    for (const a of notInlined) {
      lines.push(`- \`${a.filename}\``);
      attached.push(a.filename);
    }
    lines.push("");
  }
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
    lines.push("", `_${t("logSummary.network.detail", { filename: "network-log.json" })}_`, "");
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
