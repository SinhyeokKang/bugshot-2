import { t } from "@/i18n";
import {
  POST_MEDIA_SECTION_IDS,
  sectionMdLabelKey,
  type IssueSection,
} from "@/store/settings-ui-store";
import type { MarkdownContext } from "./buildIssueMarkdown";
import { filterEnvironmentRows } from "./environmentRows";
import { formatTimestamp } from "./formatTimestamp";

export interface AsanaMediaInput {
  filename: string;
  contentType: string;
}

export interface AsanaBuildInput {
  ctx: MarkdownContext;
  images?: AsanaMediaInput[];
  video?: AsanaMediaInput;
  logs?: AsanaMediaInput[];
}

export interface AsanaBuildResult {
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

export function buildAsanaIssueBody(input: AsanaBuildInput): AsanaBuildResult {
  const { ctx, images = [], video, logs = [] } = input;
  const lines: string[] = [];
  const attached: string[] = [];

  lines.push(`## ${t("md.section.env")}`, "");
  if (ctx.os) lines.push(`- **OS**: ${ctx.os}`);
  if (ctx.browser) lines.push(`- **Browser**: ${ctx.browser}`);
  lines.push(`- **Page**: ${ctx.url}`);
  if (
    ctx.captureMode !== "screenshot" &&
    ctx.captureMode !== "video" &&
    ctx.captureMode !== "freeform" &&
    ctx.selector
  ) {
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

  const isElement =
    ctx.captureMode !== "video" &&
    ctx.captureMode !== "screenshot" &&
    ctx.captureMode !== "freeform";

  let mediaEmitted = false;
  const emitMedia = () => {
    if (mediaEmitted) return;
    mediaEmitted = true;
    // Asana html_notes는 인라인 이미지 미지원 — 스타일 diff 테이블만 본문에 남기고 미디어는 첨부로 분리.
    if (isElement && ctx.diffs.length > 0) {
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
    if (POST_MEDIA_SECTION_IDS.has(section.id)) emitMedia();
    const content = ctx.sections[section.id] ?? "";
    lines.push(`## ${sectionLabel(section)}`, "");
    if (section.renderAs === "orderedList") {
      const items = listItems(content);
      if (items.length === 0) lines.push(t("md.noValue"));
      else items.forEach((it, idx) => lines.push(`${idx + 1}. ${it}`));
    } else {
      lines.push(content.trim() ? content : t("md.noValue"));
    }
    lines.push("");
  }

  emitMedia();

  const allMedia: AsanaMediaInput[] = [
    ...images,
    ...(video ? [video] : []),
    ...logs,
  ];
  if (allMedia.length > 0) {
    lines.push(`## ${t("md.section.attachments")}`, "");
    lines.push(t("asana.attachmentNotInline"), "");
    for (const a of allMedia) {
      lines.push(`- \`${a.filename}\``);
      attached.push(a.filename);
    }
    lines.push("");
  }

  lines.push("---", "");
  lines.push(`_Reported via [BugShot](https://bug-shot.com)_`, "");

  return { body: lines.join("\n"), attached };
}

function emitLogSummary(lines: string[], ctx: MarkdownContext): void {
  const { networkLogSummary: net, consoleLogSummary: con } = ctx;
  if (!net && !con) return;
  lines.push(`## ${t("logSummary.title")}`, "");
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
  lines.push(`_${t("logSummary.logs.detail")}_`, "");
}
