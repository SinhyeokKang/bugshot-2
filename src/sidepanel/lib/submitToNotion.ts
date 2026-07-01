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
  // 사용자 첨부: file block 표시명(원본). 업로드 filename은 고유.
  displayName?: string;
}

export interface NotionSubmitInput {
  ctx: MarkdownContext;
  images?: NotionFileInput[];
  video?: NotionFileInput;
  logs?: NotionFileInput[];
  attachments?: NotionFileInput[];
  inlineImages?: InlineImageInput[];
  databaseId: string;
  titlePropertyName: string;
  statusOption?: { propertyName: string; optionName: string };
  selectValues: NotionSelectFieldValue[];
  cc?: string[];
  // 승격(Slack 보존 이슈)처럼 성공 시 원본을 파괴하는 흐름에서는 사용자 첨부(other) 업로드
  // 실패도 페이지 생성 전에 중단해 원본 손실을 막는다. 이미지·비디오는 상시 strict, 로그는 best-effort.
  requireMediaUpload?: boolean;
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
    userAttachments: input.attachments?.map((f) => {
      const name = f.displayName ?? f.filename;
      return {
        filename: name,
        contentType: guessUploadMime(name),
        dataUrl: f.dataUrl,
        category: "other" as const,
      };
    }),
    inlineImageRefIds: inlineUploaded.map((iu) => iu.refId),
    cc: input.cc,
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
      // 로그·사용자 첨부 실패는 격리 — 누락 placeholder 블록은 createPage에서 자연 스킵.
      // image/video는 본문 핵심이라 strict 유지(전체 실패). 승격(requireMediaUpload)이면
      // 사용자 첨부(other)도 strict — 원본 파괴 전에 중단. 로그는 승격에서도 best-effort.
      if (a.category === "log" || (a.category === "other" && !input.requireMediaUpload)) {
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
