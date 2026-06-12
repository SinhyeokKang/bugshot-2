import { t } from "@/i18n";
import {
  POST_MEDIA_SECTION_IDS,
  sectionMdLabelKey,
  type IssueSection,
} from "@/store/settings-ui-store";
import type {
  NotionAttachmentInput,
  NotionAttachmentCategory,
  NotionBlock,
  NotionRichText,
} from "@/types/notion";
import {
  resolveStyleElements,
  styleSelectorList,
  type MarkdownContext,
} from "./buildIssueMarkdown";
import { filterEnvironmentRows } from "./environmentRows";
import { formatTimestamp } from "./formatTimestamp";
import { markdownToNotionBlocks } from "./markdownToNotionBlocks";
import {
  extractInlineRefs,
  stripInlineImageRefs,
} from "./resolveInlineImages";

export interface NotionMediaInput {
  filename: string;
  contentType: string;
  dataUrl: string;
  category?: NotionAttachmentCategory;
}

export interface NotionBuildInput {
  ctx: MarkdownContext;
  images?: NotionMediaInput[];
  video?: NotionMediaInput;
  logs?: NotionMediaInput[];
  inlineImageRefIds?: string[];
  cc?: string[];
}

export interface NotionBuildResult {
  blocks: NotionBlock[];
  attachments: NotionAttachmentInput[];
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

// DOM 줄: "DOM: " 뒤에 selector를 code annotation으로, 복수면 ", "로 잇는다.
function domSelectorRichText(selectors: string[]): NotionRichText[] {
  const rich: NotionRichText[] = [{ type: "text", text: { content: "DOM: " } }];
  selectors.forEach((selector, i) => {
    if (i > 0) rich.push({ type: "text", text: { content: ", " } });
    rich.push({ type: "text", text: { content: selector }, annotations: { code: true } });
  });
  return rich;
}

function categorize(
  media: NotionMediaInput,
  fallback: NotionAttachmentCategory,
): NotionAttachmentCategory {
  if (media.category) return media.category;
  if (media.contentType.startsWith("image/")) return "image";
  if (media.contentType.startsWith("video/")) return "video";
  return fallback;
}

export function buildNotionIssueBody(
  input: NotionBuildInput,
): NotionBuildResult {
  const { ctx, images = [], video, logs = [] } = input;
  const blocks: NotionBlock[] = [];
  const attachments: NotionAttachmentInput[] = [];
  const isVideo = ctx.captureMode === "video";
  const isScreenshot = ctx.captureMode === "screenshot";
  const isFreeform = ctx.captureMode === "freeform";
  let placeholderCounter = 0;
  const nextPlaceholder = (prefix: string) =>
    `${prefix}-${placeholderCounter++}`;

  const queueAttachment = (
    media: NotionMediaInput,
    category: NotionAttachmentCategory,
    placeholderId: string,
  ): void => {
    attachments.push({
      placeholderId,
      filename: media.filename,
      contentType: media.contentType,
      dataUrl: media.dataUrl,
      category,
    });
  };

  // 환경 섹션
  blocks.push({ type: "heading_2", text: t("md.section.env") });
  if (ctx.os) {
    blocks.push({ type: "bulleted_list_item", text: `OS: ${ctx.os}` });
  }
  if (ctx.browser) {
    blocks.push({ type: "bulleted_list_item", text: `Browser: ${ctx.browser}` });
  }
  blocks.push({ type: "bulleted_list_item", text: `Page: ${ctx.url}` });
  const domSelectors = styleSelectorList(ctx);
  if (domSelectors.length > 0) {
    blocks.push({
      type: "rich_bulleted_list_item",
      richText: domSelectorRichText(domSelectors),
    });
  }
  if (ctx.viewport) {
    blocks.push({
      type: "bulleted_list_item",
      text: `Viewport: ${ctx.viewport.width}×${ctx.viewport.height}`,
    });
  }
  blocks.push({
    type: "bulleted_list_item",
    text: `Captured: ${formatTimestamp(ctx.capturedAt)}`,
  });
  for (const row of filterEnvironmentRows(ctx.environment)) {
    blocks.push({
      type: "bulleted_list_item",
      text: `${row.label}: ${row.value}`,
    });
  }

  let mediaEmitted = false;
  const emitMedia = (): void => {
    if (mediaEmitted) return;
    mediaEmitted = true;

    if (isFreeform) {
      // no media section
    } else if (isVideo) {
      blocks.push({ type: "heading_2", text: t("md.section.media") });
      if (video) {
        const cat = categorize(video, "video");
        const placeholder = nextPlaceholder("video");
        if (cat === "image") {
          blocks.push({ type: "image", placeholderId: placeholder });
        } else if (cat === "video") {
          blocks.push({ type: "video", placeholderId: placeholder });
        } else {
          blocks.push({ type: "paragraph", text: t("md.videoAttached") });
        }
        queueAttachment(video, cat, placeholder);
      } else {
        blocks.push({ type: "paragraph", text: t("md.videoAttached") });
      }
    } else if (isScreenshot) {
      blocks.push({ type: "heading_2", text: t("md.section.media") });
      const img = images[0];
      if (img) {
        const cat = categorize(img, "image");
        const placeholder = nextPlaceholder("screenshot");
        if (cat === "image") {
          blocks.push({ type: "image", placeholderId: placeholder });
        }
        queueAttachment(img, cat, placeholder);
      }
    } else {
      // element 모드: styleElements 반복(단수도 1개짜리). 각 섹션이 자기 before-${i}/after-${i}.
      for (const el of resolveStyleElements(ctx)) {
        const before = images.find((im) => im.filename === el.beforeFilename);
        const after = images.find((im) => im.filename === el.afterFilename);

        blocks.push({
          type: "heading_2",
          text: `${t("md.section.styleChanges")} (${el.selector})`,
        });
        blocks.push({ type: "heading_3", text: t("md.section.before") });
        if (before) {
          const ph = nextPlaceholder("before");
          blocks.push({ type: "image", placeholderId: ph });
          queueAttachment(before, categorize(before, "image"), ph);
        }
        for (const d of el.diffs) {
          blocks.push({ type: "bulleted_list_item", text: `${d.prop}: ${d.asIs}` });
        }
        blocks.push({ type: "heading_3", text: t("md.section.after") });
        if (after) {
          const ph = nextPlaceholder("after");
          blocks.push({ type: "image", placeholderId: ph });
          queueAttachment(after, categorize(after, "image"), ph);
        }
        for (const d of el.diffs) {
          blocks.push({ type: "bulleted_list_item", text: `${d.prop}: ${d.toBe}` });
        }
      }
    }

    emitLogSummary(blocks, ctx);

    // 로그 첨부 (파일 자체)
    for (const log of logs) {
      const ph = nextPlaceholder("log");
      queueAttachment(log, categorize(log, "log"), ph);
    }
  };

  const uploadedRefSet = new Set(input.inlineImageRefIds ?? []);

  for (const section of ctx.sectionConfig) {
    if (!section.enabled) continue;
    if (POST_MEDIA_SECTION_IDS.has(section.id)) {
      emitMedia();
    }
    const content = ctx.sections[section.id] ?? "";
    blocks.push({ type: "heading_2", text: sectionLabel(section) });
    if (section.renderAs === "orderedList") {
      const items = listItems(content);
      if (items.length === 0) {
        blocks.push({ type: "paragraph", text: t("md.noValue") });
      } else {
        for (const it of items) {
          blocks.push({ type: "bulleted_list_item", text: it });
        }
      }
    } else {
      const sectionRefs = extractInlineRefs(content).filter((r) => uploadedRefSet.has(r));
      const processed = sectionRefs.length > 0 ? stripInlineImageRefs(content) : content;
      if (processed.trim()) {
        blocks.push(...markdownToNotionBlocks(processed));
      } else if (sectionRefs.length === 0) {
        blocks.push({ type: "paragraph", text: t("md.noValue") });
      }
      for (const refId of sectionRefs) {
        blocks.push({ type: "image", placeholderId: `inline-${refId}` });
      }
    }
  }

  emitMedia();

  if (input.cc?.length) {
    blocks.push({ type: "mention_paragraph", userIds: input.cc });
  }
  // 'Reported via *BugShot*' 푸터는 createPage가 첨부 섹션 뒤에 직접 append (본문 가장 하단 보장).

  return { blocks, attachments };
}

function emitLogSummary(blocks: NotionBlock[], ctx: MarkdownContext): void {
  const { networkLogSummary: net, consoleLogSummary: con } = ctx;
  if (!net && !con) return;
  blocks.push({ type: "heading_2", text: t("logSummary.title") });
  const codeLines: string[] = [];
  if (net) {
    codeLines.push(
      net.errors.length > 0
        ? t("logSummary.network.line", { n: net.captured, errors: net.errors.length })
        : t("logSummary.network.lineNoError", { n: net.captured }),
    );
  }
  if (con) {
    codeLines.push(
      con.errorCount > 0 || con.warnCount > 0
        ? t("logSummary.console.line", { n: con.captured, errors: con.errorCount, warns: con.warnCount })
        : t("logSummary.console.lineNoError", { n: con.captured }),
    );
  }
  blocks.push({
    type: "code",
    language: "plain text",
    text: codeLines.join("\n"),
  });
}
