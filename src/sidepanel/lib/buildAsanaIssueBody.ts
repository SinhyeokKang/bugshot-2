import { t } from "@/i18n";
import {
  POST_MEDIA_SECTION_IDS,
  sectionMdLabelKey,
  type IssueSection,
} from "@/store/settings-ui-store";
import {
  resolveStyleElements,
  styleDomLabel,
  type MarkdownContext,
} from "./buildIssueMarkdown";
import { filterEnvironmentRows } from "./environmentRows";
import { formatTimestamp } from "./formatTimestamp";

export interface AsanaMediaInput {
  filename: string;
  contentType: string;
}

export interface AsanaBuildInput {
  ctx: MarkdownContext;
  images?: AsanaMediaInput[];
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
  const { ctx, images = [] } = input;
  const lines: string[] = [];
  const attached: string[] = [];

  lines.push(`## ${t("md.section.env")}`, "");
  if (ctx.os) lines.push(`- **OS**: ${ctx.os}`);
  if (ctx.browser) lines.push(`- **Browser**: ${ctx.browser}`);
  lines.push(`- **Page**: ${ctx.url}`);
  const domLabel = styleDomLabel(ctx);
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
          lines.push(`- **${escapeCell(d.prop)}**: ${escapeCell(d.asIs)}`);
        }
        lines.push("");
        lines.push(`## ${t("styleTable.toBe")} (${el.selector})`, "");
        if (after) { inlineImage(after); handled.add(after); }
        for (const d of el.diffs) {
          lines.push(`- **${escapeCell(d.prop)}**: ${escapeCell(d.toBe)}`);
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
  lines.push(`_${t("logSummary.logs.detail", { file: "logs.html" })}_`, "");
}
