import { t } from "@/i18n";
import {
  POST_MEDIA_SECTION_IDS,
  sectionMdLabelKey,
  type IssueSection,
} from "@/store/settings-ui-store";
import {
  escapeMdLinkText,
  mdInlineCode,
  resolveStyleElements,
  styleDomLabel,
  type MarkdownContext,
} from "./buildIssueMarkdown";
import { ccMarkdownLine } from "./ccMention";
import { segmentsToMarkdown } from "./classDiff";
import { filterEnvironmentRows } from "./environmentRows";
import { formatTimestamp } from "./formatTimestamp";

export interface MarkdownMediaInput {
  filename: string;
  contentType: string;
  url?: string;
}

export interface MarkdownIssueBuildInput {
  ctx: MarkdownContext;
  images?: MarkdownMediaInput[];
  video?: MarkdownMediaInput;
  logs?: MarkdownMediaInput[];
  attachments?: MarkdownMediaInput[];
  cc?: string[];
}

export interface MarkdownIssueBuildOpts {
  // i18n 키 접두어(attachmentNotInline·mediaUploadFailed) 해소용.
  platform: "github" | "gitlab";
  // 비디오 임베드 문법 — 미디어 섹션과 첨부 섹션 두 지점에 적용.
  // github: bare URL(플레이어 자동 임베드), gitlab: 기본값(이미지 문법).
  videoEmbed?: (media: { filename: string; url: string }) => string;
}

export interface MarkdownIssueBuildResult {
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

function imageCell(media: MarkdownMediaInput | undefined): string {
  if (!media?.url) return "";
  return `![${media.filename}](${media.url})`;
}

function footerMarkdown(): string {
  return `_Reported via [BugShot](https://bug-shot.com)_`;
}

function defaultVideoEmbed(media: { filename: string; url: string }): string {
  return `![${escapeMdLinkText(media.filename)}](${media.url})`;
}

export function buildMarkdownIssueBody(
  input: MarkdownIssueBuildInput,
  opts: MarkdownIssueBuildOpts,
): MarkdownIssueBuildResult {
  const { ctx, images = [], video, logs = [] } = input;
  const videoEmbed = opts.videoEmbed ?? defaultVideoEmbed;
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
  const mediaHandled = new Set<string>();

  let mediaEmitted = false;
  const emitMedia = () => {
    if (mediaEmitted) return;
    mediaEmitted = true;

    if (isFreeform) {
      // no media section
    } else if (isElement) {
      // element 모드: styleElements를 반복(단수도 1개짜리). 각 섹션이 자기 before-${i}/after-${i}.
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

        if (before?.url) { attached.push(before.filename); mediaHandled.add(before.filename); }
        if (after?.url) { attached.push(after.filename); mediaHandled.add(after.filename); }
      }
    } else if (isVideo && video?.url) {
      lines.push(`## ${t("md.section.media")}`, "");
      lines.push(videoEmbed({ filename: video.filename, url: video.url }));
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

  const extras: MarkdownMediaInput[] = [
    ...images.filter((i) => !mediaHandled.has(i.filename)),
    ...(video && !mediaHandled.has(video.filename) ? [video] : []),
    ...logs,
    ...(input.attachments ?? []),
  ];
  emitAttachments(lines, attached, extras, opts.platform, videoEmbed);

  // github login·gitlab username 모두 영숫자·`-`(·`_`·`.`)뿐 — 이스케이프가
  // 멘션 해석을 깰 수 있어 raw로 넣는다.
  const ccLine = ccMarkdownLine(input.cc ?? [], { escape: false });
  if (ccLine) lines.push(ccLine, "");

  lines.push("---", "");
  lines.push(footerMarkdown(), "");

  return { body: lines.join("\n"), attached };
}

function emitAttachments(
  lines: string[],
  attached: string[],
  items: MarkdownMediaInput[],
  platform: MarkdownIssueBuildOpts["platform"],
  videoEmbed: (media: { filename: string; url: string }) => string,
): void {
  if (items.length === 0) return;
  const inlined = items.filter((a) => a.url);
  const notInlined = items.filter((a) => !a.url);

  if (inlined.length > 0) {
    lines.push(`## ${t("md.section.attachments")}`, "");
    for (const a of inlined) {
      if (a.contentType.startsWith("image/")) {
        lines.push(`![${escapeMdLinkText(a.filename)}](${a.url})`);
      } else if (a.contentType.startsWith("video/")) {
        lines.push(videoEmbed({ filename: a.filename, url: a.url! }));
      } else {
        lines.push(`[${escapeMdLinkText(a.filename)}](${a.url})`);
      }
      attached.push(a.filename);
    }
    lines.push("");
  }

  if (notInlined.length > 0) {
    if (inlined.length === 0) lines.push(`## ${t("md.section.attachments")}`, "");
    lines.push(t(`${platform}.attachmentNotInline`), "");
    for (const a of notInlined) {
      lines.push(`- \`${a.filename}\``);
      attached.push(a.filename);
    }
    lines.push("");
  }
}

function emitLogSummary(lines: string[], ctx: MarkdownContext, logsHref?: string): void {
  const { networkLogSummary: net, consoleLogSummary: con, actionLogCaptured: act } = ctx;
  if (!net && !con && !act) return;
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
  if (act) {
    lines.push(`- ${t("logSummary.action.line", { n: act })}`);
  }
  lines.push("");
  const file = logsHref ? `[logs.html](${logsHref})` : "logs.html";
  lines.push(`_${t("logSummary.logs.detail", { file })}_`, "");
}
