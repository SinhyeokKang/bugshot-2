import { t } from "@/i18n";
import {
  POST_MEDIA_SECTION_IDS,
  sectionMdLabelKey,
  type IssueSection,
} from "@/store/app-settings-store";
import type { MarkdownContext } from "./buildIssueMarkdown";
import { formatTimestamp } from "./formatTimestamp";

export const GITHUB_BODY_BUDGET = 60_000;
export const GITHUB_INLINE_IMAGE_MAX = 64 * 1024;

export interface GithubMediaInput {
  filename: string;
  blob: Blob;
}

export interface GithubBuildInput {
  ctx: MarkdownContext;
  images?: GithubMediaInput[];
  video?: GithubMediaInput;
  logs?: GithubMediaInput[];
}

export interface GithubBuildResult {
  body: string;
  inlined: string[];
  notInlined: string[];
}

export async function tryInlineImage(
  blob: Blob,
  remainingBudget: number,
): Promise<string | null> {
  if (blob.size > GITHUB_INLINE_IMAGE_MAX) return null;
  const dataUri = await blobToDataUri(blob);
  // markdown wrap `![filename](...)\n` 기본 30~50 byte 가산 추정
  if (dataUri.length + 50 > remainingBudget) return null;
  return dataUri;
}

async function blobToDataUri(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const base64 = btoa(bin);
  const mime = blob.type || "image/webp";
  return `data:${mime};base64,${base64}`;
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

function joinedSize(lines: string[]): number {
  // joined string size approx — 1 byte per char + newlines
  let n = 0;
  for (const l of lines) n += l.length + 1;
  return n;
}

function webstoreUrl(): string {
  return (import.meta.env.VITE_WEBSTORE_URL as string | undefined) ?? "";
}

function footerMarkdown(): string {
  const url = webstoreUrl();
  const brand = url ? `[BugShot](${url})` : "BugShot";
  return `_Reported via ${brand}_`;
}

export async function buildGithubIssueBody(
  input: GithubBuildInput,
): Promise<GithubBuildResult> {
  const { ctx, images = [], video, logs = [] } = input;
  const lines: string[] = [];
  const inlined: string[] = [];
  const notInlined: string[] = [];

  lines.push(`# ${ctx.title}`, "");

  lines.push(`## ${t("md.section.env")}`, "");
  lines.push(`- **Page**: ${ctx.url}`);
  if (ctx.captureMode !== "screenshot" && ctx.captureMode !== "video" && ctx.selector) {
    lines.push(`- **DOM**: ${ctx.selector}`);
  }
  lines.push(`- **Viewport**: ${ctx.viewport.width}×${ctx.viewport.height}`);
  lines.push(`- **Captured**: ${formatTimestamp(ctx.capturedAt)}`);
  lines.push("");

  let mediaEmitted = false;
  const emitMedia = async () => {
    if (mediaEmitted) return;
    mediaEmitted = true;

    const hasVisualMedia =
      images.length > 0 || !!video || ctx.captureMode === "screenshot" || ctx.captureMode === "video";
    if (hasVisualMedia) {
      lines.push(`## ${t("md.section.media")}`, "");

      for (const img of images) {
        const remaining = GITHUB_BODY_BUDGET - joinedSize(lines);
        const dataUri = await tryInlineImage(img.blob, remaining);
        if (dataUri) {
          lines.push(`![${img.filename}](${dataUri})`, "");
          inlined.push(img.filename);
        } else {
          lines.push(
            `- \`${img.filename}\` — ${t("github.attachmentTooLarge")}`,
            "",
          );
          notInlined.push(img.filename);
        }
      }

      if (video) {
        lines.push(
          `- \`${video.filename}\` — ${t("github.attachmentNotInline")}`,
          "",
        );
        notInlined.push(video.filename);
      }
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

    for (const log of logs) {
      lines.push(
        `- \`${log.filename}\` — ${t("github.attachmentNotInline")}`,
        "",
      );
      notInlined.push(log.filename);
    }

    emitLogSummary(lines, ctx);
  };

  for (const section of ctx.sectionConfig) {
    if (!section.enabled) continue;
    if (POST_MEDIA_SECTION_IDS.has(section.id)) {
      await emitMedia();
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

  await emitMedia();

  lines.push("---", "");
  lines.push(footerMarkdown(), "");

  return { body: lines.join("\n"), inlined, notInlined };
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
