import { t } from "@/i18n";
import { replaceInlineRefs, type InlineImageInput } from "./resolveInlineImages";
import { guessUploadMime } from "./uploadMime";
import type { MarkdownContext } from "./buildIssueMarkdown";
import type { MarkdownMediaInput } from "./buildMarkdownIssueBody";
import { inlineUploadFilename } from "@/lib/inline-ref";

export interface UploadFileInput {
  contentType?: string;
  fileId?: string;
  filename: string;
  dataUrl: string;
  // 사용자 첨부: 업로드 식별용 filename(고유)과 본문 표시명(원본) 분리.
  displayName?: string;
}

export interface PrepareUploadInput {
  submissionFiles?: import("@/types/attachment").SubmissionFile[];
  ctx: MarkdownContext;
  images?: UploadFileInput[];
  video?: UploadFileInput;
  logs?: UploadFileInput[];
  attachments?: UploadFileInput[];
  inlineImages?: InlineImageInput[];
  // 승격(Slack 보존 이슈)처럼 성공 시 원본을 파괴하는 흐름에서는 미디어 업로드가
  // 하나라도 누락되면 이슈 생성 전에 중단해 원본 손실을 막는다. 로그는 best-effort라 제외.
  requireMediaUpload?: boolean;
}

export interface UploadEntry {
  fileId?: string;
  filename: string;
  contentType: string;
  dataUrl: string;
}

export type UploadFn = (
  files: UploadEntry[],
) => Promise<Array<{ fileId?: string; failure?: import("@/types/attachment").AttachmentResult["failure"]; filename: string; href: string | null }>>;

export interface PreparedUpload {
  responses: import("./submissionAdapter").DeliveryResponse[];
  hrefMap: Map<string, string | null>;
  resolvedCtx: MarkdownContext;
  toMedia: (f: UploadFileInput) => MarkdownMediaInput;
  toAttachmentMedia: (f: UploadFileInput) => MarkdownMediaInput;

}

// hrefMap에서 기대 파일 중 업로드 누락(href 부재)이 있는지.
export function someUploadMissing(
  filenames: string[],
  hrefMap: Map<string, string | null>,
): boolean {
  return filenames.some((f) => !hrefMap.get(f));
}

// refId를 함께 돌려주는 이유: 호출부가 업로드 결과를 되찾을 때 파일명을 두 번째로 조립하면
// 그 자리에서 다시 갈릴 수 있다. 짝을 여기서 한 번만 만든다.
export function toInlineUploadFiles(
  inlineImages: readonly InlineImageInput[] | undefined,
): Array<UploadFileInput & { refId: string }> {
  return (inlineImages ?? []).map((img) => ({
    refId: img.refId,
    fileId: img.fileId,
    filename: img.filename ?? inlineUploadFilename(img.refId),
    dataUrl: img.dataUrl,
  }));
}

export function toUploadEntry(f: UploadFileInput): UploadEntry {
  return {
    ...(f.fileId ? { fileId: f.fileId } : {}),
    filename: f.filename,
    contentType: f.contentType ?? guessUploadMime(f.filename),
    dataUrl: f.dataUrl,
  };
}

export async function prepareUpload(
  input: PrepareUploadInput,
  uploadFn: UploadFn,
  opts: { platform: "github" | "gitlab" | "webhook" },
): Promise<PreparedUpload> {
  const imageInputs = input.images ?? [];
  const logs = input.logs ?? [];
  const userAttachments = input.attachments ?? [];
  const inlineFiles = toInlineUploadFiles(input.inlineImages);
  const allFiles = [
    ...imageInputs,
    ...(input.video ? [input.video] : []),
    ...logs,
    ...inlineFiles,
    ...userAttachments,
  ];

  const uploadResults = await uploadFn(allFiles.map(toUploadEntry));

  const hrefMap = new Map(allFiles.map((f) => {
    const matches = uploadResults.filter((r) => f.fileId ? r.fileId === f.fileId : r.filename === f.filename);
    return [f.fileId ?? f.filename, matches.length === 1 ? matches[0].href : null];
  }));

  if (input.requireMediaUpload) {
    const requiredMedia = [
      ...imageInputs,
      ...(input.video ? [input.video] : []),
      ...inlineFiles,
      ...userAttachments,
    ].map((f) => f.fileId ?? f.filename);
    if (someUploadMissing(requiredMedia, hrefMap)) {
      throw new Error(t(`${opts.platform}.error.mediaUploadFailed`));
    }
  }

  let resolvedCtx = input.ctx;
  if (inlineFiles.length > 0) {
    const refToUrl = new Map<string, string>();
    for (const f of inlineFiles) {
      const href = hrefMap.get(f.fileId ?? f.filename);
      if (href) refToUrl.set(f.refId, href);
    }
    if (refToUrl.size > 0) {
      resolvedCtx = {
        ...input.ctx,
        sections: Object.fromEntries(
          Object.entries(input.ctx.sections).map(([k, v]) => [
            k,
            replaceInlineRefs(v, refToUrl),
          ]),
        ),
      };
    }
  }

  function toMedia(f: UploadFileInput): MarkdownMediaInput {
    return {
      filename: f.filename,
      contentType: f.contentType ?? guessUploadMime(f.filename),
      url: hrefMap.get(f.fileId ?? f.filename) ?? undefined,
    };
  }

  // 사용자 첨부: 본문 표시명은 원본(displayName), url 매칭은 업로드 filename(고유).
  function toAttachmentMedia(f: UploadFileInput): MarkdownMediaInput {
    const name = f.displayName ?? f.filename;
    return {
      filename: name,
      contentType: guessUploadMime(name),
      url: hrefMap.get(f.fileId ?? f.filename) ?? undefined,
    };
  }

  return { responses: uploadResults.map((r) => ({ ...r, ok: !!r.href, href: r.href ?? undefined })), hrefMap, resolvedCtx, toMedia, toAttachmentMedia };
}
