import { buildNotionIssueBody } from "./buildNotionIssueBody";
import type { MarkdownContext } from "./buildIssueMarkdown";
import { sendBg } from "@/types/messages";
import type {
  NotionCreatePageResult,
  NotionFileUploadResult,
  NotionSelectFieldValue,
} from "@/types/notion";
import type { NormalizedSubmitResult } from "@/types/platform";

export interface NotionFileInput {
  filename: string;
  dataUrl: string;
}

export interface NotionSubmitInput {
  ctx: MarkdownContext;
  images?: NotionFileInput[];
  video?: NotionFileInput;
  logs?: NotionFileInput[];
  databaseId: string;
  titlePropertyName: string;
  statusOption?: { propertyName: string; optionName: string };
  selectValues: NotionSelectFieldValue[];
}

function guessMime(filename: string): string {
  if (filename.endsWith(".webp")) return "image/webp";
  if (filename.endsWith(".webm")) return "video/webm";
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) return "image/jpeg";
  if (filename.endsWith(".md")) return "text/markdown";
  if (filename.endsWith(".har")) return "application/json";
  if (filename.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

export async function submitToNotion(
  input: NotionSubmitInput,
): Promise<NormalizedSubmitResult> {
  const { blocks, attachments } = buildNotionIssueBody({
    ctx: input.ctx,
    images: input.images?.map((f) => ({
      filename: f.filename,
      contentType: guessMime(f.filename),
      dataUrl: f.dataUrl,
    })),
    video: input.video
      ? {
          filename: input.video.filename,
          contentType: guessMime(input.video.filename),
          dataUrl: input.video.dataUrl,
        }
      : undefined,
    logs: input.logs?.map((f) => ({
      filename: f.filename,
      contentType: guessMime(f.filename),
      dataUrl: f.dataUrl,
      category: "log" as const,
    })),
  });

  // 직렬 업로드 — Notion rate limit (3 req/sec) 보호
  const uploaded: { placeholderId: string; fileUploadId: string; filename: string; category: typeof attachments[number]["category"] }[] = [];
  for (const a of attachments) {
    const res = await sendBg<NotionFileUploadResult>({
      type: "notion.uploadFile",
      filename: a.filename,
      contentType: a.contentType,
      dataUrl: a.dataUrl,
    });
    uploaded.push({
      placeholderId: a.placeholderId,
      fileUploadId: res.fileUploadId,
      filename: a.filename,
      category: a.category,
    });
  }

  const result = await sendBg<NotionCreatePageResult>({
    type: "notion.submitPage",
    payload: {
      databaseId: input.databaseId,
      titlePropertyName: input.titlePropertyName,
      title: input.ctx.title.trim(),
      statusOption: input.statusOption,
      selectValues: input.selectValues,
      blocks,
      attachments: uploaded,
    },
  });

  const shortKey = result.pageId.replace(/-/g, "").slice(0, 8);
  return { key: shortKey, url: result.url };
}
