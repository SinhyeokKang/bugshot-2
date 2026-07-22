import { t } from "@/i18n";
import {
  POST_MEDIA_SECTION_IDS,
  sectionMdLabelKey,
  type IssueSection,
} from "@/store/settings-ui-store";
import {
  mdInlineCode,
  resolveStyleElements,
  styleDomLabel,
  type MarkdownContext,
} from "./buildIssueMarkdown";
import { filterEnvironmentRows } from "./environmentRows";
import { formatTimestamp } from "./formatTimestamp";
import { escapeMrkdwn, markdownToMrkdwn } from "./markdownToMrkdwn";

export interface SlackBuildInput {
  ctx: MarkdownContext;
}

export interface SlackBuildResult {
  body: string;
  attached: string[];
}

// Slack mrkdwn은 헤딩 문법이 없어 섹션 제목을 *볼드 줄*로, 테이블이 없어 스타일 diff를
// `prop: as-is → to-be` 텍스트 줄로 낸다. 이미지/영상/첨부는 본문에 넣지 않고 스레드 첨부로 보낸다.
function sectionLabel(section: IssueSection): string {
  return section.labelOverride?.trim() || t(sectionMdLabelKey(section.id));
}

function listItems(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function footerMarkdown(): string {
  return `_Reported via <https://bug-shot.com|BugShot>_`;
}

export function buildSlackBody(input: SlackBuildInput): SlackBuildResult {
  const { ctx } = input;
  const lines: string[] = [];

  lines.push(`*${t("md.section.env")}*`, "");
  if (ctx.os) lines.push(`• *OS*: ${escapeMrkdwn(ctx.os)}`);
  if (ctx.browser) lines.push(`• *Browser*: ${escapeMrkdwn(ctx.browser)}`);
  lines.push(`• *Page*: ${ctx.url}`);
  const domLabel = styleDomLabel(ctx, mdInlineCode);
  if (domLabel) lines.push(`• *DOM*: ${domLabel}`);
  if (ctx.viewport) {
    lines.push(`• *Viewport*: ${ctx.viewport.width}×${ctx.viewport.height}`);
  }
  lines.push(`• *Captured*: ${escapeMrkdwn(formatTimestamp(ctx.capturedAt))}`);
  for (const row of filterEnvironmentRows(ctx.environment)) {
    lines.push(`• *${escapeMrkdwn(row.label)}*: ${escapeMrkdwn(row.value)}`);
  }
  lines.push("");

  const isElement =
    ctx.captureMode !== "video" &&
    ctx.captureMode !== "screenshot" &&
    ctx.captureMode !== "freeform";

  let emitted = false;
  const emitStyleAndLogs = () => {
    if (emitted) return;
    emitted = true;

    if (isElement) {
      for (const el of resolveStyleElements(ctx)) {
        lines.push(`*${t("md.section.styleChanges")} (${escapeMrkdwn(el.selector)})*`, "");
        for (const d of el.diffs) {
          lines.push(
            `• ${escapeMrkdwn(d.prop)}: ${escapeMrkdwn(d.asIs)} → ${escapeMrkdwn(d.toBe)}`,
          );
        }
        lines.push("");
      }
    }

    emitLogSummary(lines, ctx);
  };

  for (const section of ctx.sectionConfig) {
    if (!section.enabled) continue;
    if (POST_MEDIA_SECTION_IDS.has(section.id)) emitStyleAndLogs();
    const content = ctx.sections[section.id] ?? "";
    lines.push(`*${sectionLabel(section)}*`, "");
    if (section.renderAs === "orderedList") {
      const items = listItems(content);
      if (items.length === 0) {
        lines.push(t("md.noValue"));
      } else {
        items.forEach((it, idx) => lines.push(`${idx + 1}. ${markdownToMrkdwn(it)}`));
      }
    } else {
      lines.push(content.trim() ? markdownToMrkdwn(content) : t("md.noValue"));
    }
    lines.push("");
  }

  emitStyleAndLogs();

  lines.push(footerMarkdown(), "");

  return { body: lines.join("\n"), attached: [] };
}

function emitLogSummary(lines: string[], ctx: MarkdownContext): void {
  const { networkLogSummary: net, consoleLogSummary: con, actionLogCaptured: act } = ctx;
  if (!net && !con && !act) return;
  lines.push(`*${t("logSummary.title")}*`, "");
  lines.push(`*${t("logSummary.logs.lead")}* ${t("logSummary.logs.detail", { file: "logs.html" })}`, "");
  if (net) {
    lines.push(
      net.errors.length > 0
        ? `• ${t("logSummary.network.line", { n: net.captured, errors: net.errors.length })}`
        : `• ${t("logSummary.network.lineNoError", { n: net.captured })}`,
    );
  }
  if (con) {
    lines.push(
      con.errorCount > 0 || con.warnCount > 0
        ? `• ${t("logSummary.console.line", { n: con.captured, errors: con.errorCount, warns: con.warnCount })}`
        : `• ${t("logSummary.console.lineNoError", { n: con.captured })}`,
    );
  }
  if (act) lines.push(`• ${t("logSummary.action.line", { n: act })}`);
  lines.push("");
}
