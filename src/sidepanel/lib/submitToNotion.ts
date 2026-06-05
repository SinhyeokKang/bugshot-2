import { buildAiMetaAttachment } from "./buildAiMetaAttachment";
import { buildNotionIssueBody } from "./buildNotionIssueBody";
import type { MarkdownContext } from "./buildIssueMarkdown";
import { type InlineImageInput } from "./resolveInlineImages";
import { zipLogsHtml } from "./zipLogsHtml";
import { guessUploadMime } from "./uploadMime";
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
  inlineImages?: InlineImageInput[];
  databaseId: string;
  titlePropertyName: string;
  statusOption?: { propertyName: string; optionName: string };
  selectValues: NotionSelectFieldValue[];
}

export async function submitToNotion(
  input: NotionSubmitInput,
): Promise<NormalizedSubmitResult> {
  const inlineImages = input.inlineImages ?? [];

  // 1. inline image 업로드
  const inlineUploaded: { refId: string; fileUploadId: string }[] = [];
  for (const img of inlineImages) {
    const res = await sendBg<NotionFileUploadResult>({
      type: "notion.uploadFile",
      filename: `inline-${img.refId}.webp`,
      contentType: "image/webp",
      dataUrl: img.dataUrl,
    });
    inlineUploaded.push({ refId: img.refId, fileUploadId: res.fileUploadId });
  }

  // 2. blocks 빌드 — logs.html은 Notion이 text/html을 403으로 거부해서 .zip으로 래핑.
  const mappedLogs = input.logs
    ? await Promise.all(
        input.logs.map(async (f) => {
          if (guessUploadMime(f.filename) === "text/html") {
            const z = await zipLogsHtml(f.filename, f.dataUrl);
            return {
              filename: z.filename,
              contentType: z.contentType,
              dataUrl: z.dataUrl,
              category: "log" as const,
            };
          }
          return {
            filename: f.filename,
            contentType: guessUploadMime(f.filename),
            dataUrl: f.dataUrl,
            category: "log" as const,
          };
        }),
      )
    : undefined;
  const { blocks, attachments } = buildNotionIssueBody({
    ctx: input.ctx,
    images: input.images?.map((f) => ({
      filename: f.filename,
      contentType: guessUploadMime(f.filename),
      dataUrl: f.dataUrl,
    })),
    video: input.video
      ? {
          filename: input.video.filename,
          contentType: guessUploadMime(input.video.filename),
          dataUrl: input.video.dataUrl,
        }
      : undefined,
    logs: mappedLogs,
    inlineImageRefIds: inlineUploaded.map((iu) => iu.refId),
  });

  // 3. 일반 첨부 업로드 — 직렬 (Notion rate limit 보호)
  const uploaded: { placeholderId: string; fileUploadId: string; filename: string; category: typeof attachments[number]["category"] }[] = [];
  let logsDropped = false;
  for (const a of attachments) {
    try {
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
    } catch (err) {
      // 로그 첨부 실패는 격리 — 누락 placeholder 블록은 createPage에서 자연 스킵.
      // image/video는 본문 핵심이라 strict 유지(전체 실패).
      if (a.category === "log") {
        logsDropped = true;
        continue;
      }
      throw err;
    }
  }

  // 4. inline uploads를 uploaded 배열에 추가
  for (const iu of inlineUploaded) {
    uploaded.push({
      placeholderId: `inline-${iu.refId}`,
      fileUploadId: iu.fileUploadId,
      filename: `inline-${iu.refId}.webp`,
      category: "image",
    });
  }

  // 5. AI/디버그 메타 마크다운 — 본문 인라인이 아니라 첨부 file 블록으로
  const aiMeta = buildAiMetaAttachment(input.ctx);
  const aiMetaUploaded = await sendBg<NotionFileUploadResult>({
    type: "notion.uploadFile",
    filename: aiMeta.filename,
    contentType: "text/markdown",
    dataUrl: aiMeta.dataUrl,
  });
  uploaded.push({
    placeholderId: "ai-meta",
    fileUploadId: aiMetaUploaded.fileUploadId,
    filename: aiMeta.filename,
    category: "log",
  });

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
  return { key: shortKey, url: result.url, logsDropped };
}
