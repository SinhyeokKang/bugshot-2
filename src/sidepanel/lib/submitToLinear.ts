import {
  buildLinearIssueBody,
  type LinearMediaInput,
} from "./buildLinearIssueBody";
import { buildAiMetaAttachment } from "./buildAiMetaAttachment";
import { replaceInlineRefs, type InlineImageInput } from "./resolveInlineImages";
import { guessUploadMime } from "./uploadMime";
import type { MarkdownContext } from "./buildIssueMarkdown";
import { sendBg } from "@/types/messages";
import type { LinearCreateIssueResult } from "@/types/linear";
import type { NormalizedSubmitResult } from "@/types/platform";
import { injectIssueUrl } from "@/lib/inject-issue-url";

export interface LinearFileInput {
  filename: string;
  dataUrl: string;
}

export interface LinearSubmitInput {
  ctx: MarkdownContext;
  images?: LinearFileInput[];
  video?: LinearFileInput;
  logs?: LinearFileInput[];
  inlineImages?: InlineImageInput[];
  teamId: string;
  projectId?: string;
  labelId?: string;
  assigneeId?: string;
  priority?: number;
}

async function uploadFile(file: LinearFileInput): Promise<LinearMediaInput> {
  const { assetUrl } = await sendBg<{ assetUrl: string }>({
    type: "linear.uploadFile",
    filename: file.filename,
    contentType: guessUploadMime(file.filename),
    dataUrl: file.dataUrl,
  });
  return { filename: file.filename, assetUrl };
}

export async function submitToLinear(
  input: LinearSubmitInput,
): Promise<NormalizedSubmitResult> {
  const uploadPromises: Promise<LinearMediaInput>[] = [];
  const imageIndexes = input.images ?? [];
  for (const img of imageIndexes) uploadPromises.push(uploadFile(img));
  const videoPromise = input.video ? uploadFile(input.video) : null;

  const [imageResults, videoResult, inlineResults] = await Promise.all([
    Promise.all(uploadPromises),
    videoPromise,
    Promise.all(
      (input.inlineImages ?? []).map(async (img) => {
        const result = await uploadFile({
          filename: `inline-${img.refId}.webp`,
          dataUrl: img.dataUrl,
        });
        return { refId: img.refId, assetUrl: result.assetUrl };
      }),
    ),
  ]);

  let resolvedCtx = input.ctx;
  if (inlineResults.length > 0) {
    const refToUrl = new Map<string, string>();
    for (const r of inlineResults) {
      if (r.assetUrl) refToUrl.set(r.refId, r.assetUrl);
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

  const { body } = buildLinearIssueBody({
    ctx: resolvedCtx,
    images: imageResults,
    video: videoResult ?? undefined,
  });

  const result = await sendBg<LinearCreateIssueResult>({
    type: "linear.submitIssue",
    payload: {
      teamId: input.teamId,
      title: input.ctx.title.trim(),
      description: body,
      projectId: input.projectId,
      labelId: input.labelId,
      assigneeId: input.assigneeId,
      priority: input.priority,
    },
  });

  const logFiles = await Promise.all(
    (input.logs ?? []).map(async (l) =>
      l.filename === "logs.html"
        ? { ...l, dataUrl: await injectIssueUrl(l.dataUrl, result.url, result.identifier) }
        : l,
    ),
  );
  // 이슈는 이미 생성됨 — 로그 첨부 실패(대용량 logs.html 등)가 전체 제출을 실패로 만들지 않게 격리.
  const logResults = (
    await Promise.all(logFiles.map((l) => uploadFile(l).catch(() => null)))
  ).filter((r): r is LinearMediaInput => r !== null);
  const logsDropped = logResults.length < logFiles.length;

  // 이슈는 이미 생성됨 — 비필수 메타 업로드·첨부 연결 실패가 전체 제출을 실패로 만들지 않게 격리
  // (실패로 보고되면 재시도 시 중복 이슈가 생긴다).
  const aiMeta = buildAiMetaAttachment(input.ctx);
  const aiMetaUploaded = await uploadFile(aiMeta).catch(() => null);

  const attachments = [
    ...logResults.filter((log) => log.assetUrl),
    ...(aiMetaUploaded?.assetUrl ? [aiMetaUploaded] : []),
  ];
  await Promise.all(
    attachments.map((att) =>
      sendBg({
        type: "linear.createAttachment",
        issueId: result.id,
        title: att.filename,
        url: att.assetUrl!,
      }).catch(() => null),
    ),
  );

  return { key: result.identifier, url: result.url, logsDropped };
}
