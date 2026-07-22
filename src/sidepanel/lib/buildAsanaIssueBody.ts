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
import { CC_SENTINEL } from "./ccMention";
import { segmentsToMarkdown } from "./classDiff";
import { filterEnvironmentRows } from "./environmentRows";
import { formatTimestamp } from "./formatTimestamp";

export interface AsanaMediaInput {
  filename: string;
  contentType: string;
}

export interface AsanaBuildInput {
  ctx: MarkdownContext;
  images?: AsanaMediaInput[];
  hasCc?: boolean;
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

export function buildAsanaIssueBody(input: AsanaBuildInput): AsanaBuildResult {
  const { ctx, images = [] } = input;
  const lines: string[] = [];
  const attached: string[] = [];

  lines.push(`## ${t("md.section.env")}`, "");
  if (ctx.os) lines.push(`- **OS**: ${ctx.os}`);
  if (ctx.browser) lines.push(`- **Browser**: ${ctx.browser}`);
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

  const isElement =
    ctx.captureMode !== "video" &&
    ctx.captureMode !== "screenshot" &&
    ctx.captureMode !== "freeform";

  const inlineImage = (img: AsanaMediaInput) => {
    // 본문 인라인(`![filename](filename)`) — 업로드 후 GID로 <img data-asana-gid> 치환된다.
    lines.push(`![${img.filename}](${img.filename})`, "");
    attached.push(img.filename);
  };

  let mediaEmitted = false;
  const emitMedia = () => {
    if (mediaEmitted) return;
    mediaEmitted = true;

    // 비교 캡처: element마다 As is / To be 섹션으로 분리 (Asana 테이블은 셀 이미지·가로 비교 불가).
    const handled = new Set<AsanaMediaInput>();
    if (isElement) {
      for (const el of resolveStyleElements(ctx)) {
        const before = images.find((im) => im.filename === el.beforeFilename);
        const after = images.find((im) => im.filename === el.afterFilename);
        lines.push(`## ${t("styleTable.asIs")} (${el.selector})`, "");
        if (before) { inlineImage(before); handled.add(before); }
        for (const d of el.diffs) {
          const asIs = d.asIsSegments ? segmentsToMarkdown(d.asIsSegments) : escapeCell(d.asIs);
          lines.push(`- **${escapeCell(d.prop)}**: ${asIs}`);
        }
        lines.push("");
        lines.push(`## ${t("styleTable.toBe")} (${el.selector})`, "");
        if (after) { inlineImage(after); handled.add(after); }
        for (const d of el.diffs) {
          const toBe = d.toBeSegments ? segmentsToMarkdown(d.toBeSegments) : escapeCell(d.toBe);
          lines.push(`- **${escapeCell(d.prop)}**: ${toBe}`);
        }
        lines.push("");
      }
    }

    // 비교에 쓰이지 않은 이미지(단일 스크린샷 등)는 미디어 섹션에 인라인.
    const rest = images.filter((i) => !handled.has(i));
    if (rest.length > 0) {
      lines.push(`## ${t("md.section.media")}`, "");
      for (const img of rest) inlineImage(img);
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

  // 영상·로그·메타 첨부는 Asana task 첨부 영역(본문 바로 아래)에 자동 표시되므로 본문에 나열하지 않는다.

  // 네이티브 앵커는 HTML 변환 후 submitToAsana의 injectAsanaCc가 치환.
  if (input.hasCc) lines.push(CC_SENTINEL, "");

  lines.push("---", "");
  lines.push(`_Reported via [BugShot](https://bug-shot.com)_`, "");

  return { body: lines.join("\n"), attached };
}

function emitLogSummary(lines: string[], ctx: MarkdownContext): void {
  const { networkLogSummary: net, consoleLogSummary: con, actionLogCaptured: act } = ctx;
  if (!net && !con && !act) return;
  lines.push(`## ${t("logSummary.title")}`, "");
  lines.push(`**${t("logSummary.logs.lead")}** ${t("logSummary.logs.detail", { file: "logs.html" })}`, "");
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
