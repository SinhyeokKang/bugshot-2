import { t } from "@/i18n";
import { escapeTableCell as escapeCell } from "./markdownCell";
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
import { ccMarkdownLine } from "./ccMention";
import { segmentsToMarkdown } from "./classDiff";
import { filterEnvironmentRows } from "./environmentRows";
import { formatTimestamp } from "./formatTimestamp";

export interface ClickupMediaInput {
  filename: string;
  contentType: string;
  url?: string;
}

export interface ClickupBuildInput {
  ctx: MarkdownContext;
  images?: ClickupMediaInput[];
  video?: ClickupMediaInput;
  logs?: ClickupMediaInput[];
  cc?: string[];
}

export interface ClickupBuildResult {
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

function imageCell(media: ClickupMediaInput | undefined): string {
  if (!media?.url) return "";
  return `![${media.filename}](${media.url})`;
}

function footerMarkdown(): string {
  return `_Reported via [BugShot](https://bug-shot.com)_`;
}

export function buildClickupIssueBody(
  input: ClickupBuildInput,
): ClickupBuildResult {
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

  const isFreeform = ctx.captureMode === "freeform";
  const isElement = ctx.captureMode !== "video" && ctx.captureMode !== "screenshot" && !isFreeform;
  const isVideo = ctx.captureMode === "video";

  let mediaEmitted = false;
  const emitMedia = () => {
    if (mediaEmitted) return;
    mediaEmitted = true;

    if (isElement) {
      for (const el of resolveStyleElements(ctx)) {
        const before = images.find((im) => im.filename === el.beforeFilename);
        const after = images.find((im) => im.filename === el.afterFilename);
        const hasSnapshots = !!(before?.url || after?.url);

        lines.push(`## ${t("md.section.styleChanges")} (${el.selector})`, "");
        lines.push(`| ${t("md.column.property")} | As is | To be |`);
        lines.push("| --- | --- | --- |");
        if (hasSnapshots) {
          lines.push(
            `| **${t("styleTable.snapshot")}** | ${imageCell(before)} | ${imageCell(after)} |`,
          );
        }
        for (const d of el.diffs) {
          const asIs = d.asIsSegments ? segmentsToMarkdown(d.asIsSegments) : escapeCell(d.asIs);
          const toBe = d.toBeSegments ? segmentsToMarkdown(d.toBeSegments) : escapeCell(d.toBe);
          lines.push(`| ${escapeCell(d.prop)} | ${asIs} | ${toBe} |`);
        }
        lines.push("");

        if (before?.url) attached.push(before.filename);
        if (after?.url) attached.push(after.filename);
      }
    } else if (isVideo && video?.url) {
      // ClickUp은 영상을 본문에 inline embed 못 한다 — 본문은 Quill Delta고 영상은 에디터 전용
      // `frame`/clickup_video op라 markdown_content에 대응 문법이 없다(이미지 ![](url)만 변환됨).
      // 대신 `?view=open`(ClickUp 뷰어로 바로 여는 파라미터)을 붙인 맨 URL을 두어, 클릭하면
      // ClickUp 뷰어에서 재생되게 한다. 파일 자체는 네이티브 task 첨부로도 올라간다.
      const videoUrl = video.url.includes("?") ? video.url : `${video.url}?view=open`;
      lines.push(`## ${t("md.section.media")}`, "");
      lines.push(videoUrl);
      attached.push(video.filename);
      lines.push("");
    } else if (!isVideo && !isFreeform && images[0]?.url) {
      lines.push(`## ${t("md.section.media")}`, "");
      lines.push(`![${images[0].filename}](${images[0].url})`);
      attached.push(images[0].filename);
      lines.push("");
    }

    emitLogSummary(lines, ctx, logs.find((l) => l.filename === "logs.html")?.url);
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

  // 영상·로그파일·사용자첨부는 ClickUp 네이티브 task 첨부 영역에 자동 표시되므로 본문에 나열하지
  // 않는다(Asana 패턴). 본문 inline은 이미지만, logs.html은 로그 요약 섹션의 링크로 노출.

  const ccLine = ccMarkdownLine(input.cc ?? [], { escape: false });
  if (ccLine) lines.push(ccLine, "");

  lines.push("---", "");
  lines.push(footerMarkdown(), "");

  return { body: lines.join("\n"), attached };
}

function emitLogSummary(lines: string[], ctx: MarkdownContext, logsHref?: string): void {
  const { networkLogSummary: net, consoleLogSummary: con, actionLogCaptured: act } = ctx;
  if (!net && !con && !act) return;
  lines.push(`## ${t("logSummary.title")}`, "");
  const file = logsHref ? `[logs.html](${logsHref})` : "logs.html";
  lines.push(`**${t("logSummary.logs.lead")}** ${t("logSummary.logs.detail", { file })}`, "");
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
  if (act) {
    lines.push(`- ${t("logSummary.action.line", { n: act })}`);
  }
  lines.push("");
}
