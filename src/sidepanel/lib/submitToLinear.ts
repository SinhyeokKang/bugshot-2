import { safeAttachmentFailure } from "@/lib/attachment-failure";
import { bindSubmissionFiles, deliveryResults, submitCreation, type SubmissionAdapterInput } from "./submissionAdapter";
import {
  buildLinearIssueBody,
  type LinearMediaInput,
} from "./buildLinearIssueBody";
import { replaceInlineRefs, type InlineImageInput } from "./resolveInlineImages";
import { guessUploadMime } from "./uploadMime";
import type { MarkdownContext } from "./buildIssueMarkdown";
import { sendBg } from "@/lib/bg-client";
import type { LinearCreateIssueResult } from "@/types/linear";
import type { NormalizedSubmitResult } from "@/types/platform";
import { injectIssueUrl } from "@/lib/inject-issue-url";
import { inlineUploadFilename } from "@/lib/inline-ref";

export interface LinearFileInput {
  fileId?: string;
  contentType?: string;
  filename: string;
  dataUrl: string;
  // 사용자 첨부: createAttachment 표시명(원본). 업로드 filename은 고유.
  displayName?: string;
}

export interface LinearSubmitInput extends SubmissionAdapterInput {
  ctx: MarkdownContext;
  images?: LinearFileInput[];
  video?: LinearFileInput;
  logs?: LinearFileInput[];
  attachments?: LinearFileInput[];
  inlineImages?: InlineImageInput[];
  teamId: string;
  projectId?: string;
  labelId?: string;
  assigneeId?: string;
  priority?: number;
  cc?: { id: string; name: string }[];
}

async function uploadFile(file: LinearFileInput): Promise<LinearMediaInput> {
  const { assetUrl, fileId } = await sendBg<{ assetUrl: string; fileId?: string }>({
    ...(file.fileId ? { fileId: file.fileId } : {}),
    type: "linear.uploadFile",
    filename: file.filename,
    contentType: file.contentType ?? guessUploadMime(file.filename),
    dataUrl: file.dataUrl,
  });
  if (!assetUrl || (file.fileId && fileId !== file.fileId)) throw new Error("Invalid upload response");
  return { filename: file.filename, assetUrl };
}

export async function submitToLinear(
  input: LinearSubmitInput,
): Promise<NormalizedSubmitResult> {
  input = bindSubmissionFiles(input);
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
          fileId: img.fileId,
          contentType: img.contentType,
          filename: img.filename ?? inlineUploadFilename(img.refId),
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
    cc: input.cc?.map((u) => u.name),
  });

  const result = await submitCreation(input.progress, () => sendBg<LinearCreateIssueResult>({
    type: "linear.submitIssue",
    payload: {
      teamId: input.teamId,
      title: input.ctx.title.trim(),
      description: body,
      projectId: input.projectId,
      labelId: input.labelId,
      assigneeId: input.assigneeId,
      priority: input.priority,
      subscriberIds: input.cc?.length ? input.cc.map((u) => u.id) : undefined,
    },
  }));
  await input.progress?.created({ platform: "linear", key: result.identifier, url: result.url, locator: { issueId: result.id } });

  const responses: import("./submissionAdapter").DeliveryResponse[] = [];
  for (const f of input.submissionFiles ?? []) {
    if (["capture", "video", "inline"].includes(f.kind)) responses.push({ fileId: f.id, ok: true, href: result.url });
  }
  let logsDropped = false;
  for (const file of [...(input.logs ?? []), ...(input.attachments ?? [])]) {
    const isLog = (input.logs ?? []).includes(file);
    let uploaded: LinearMediaInput;
    try {
      const dataUrl = !input.submissionFiles && isLog && file.filename === "logs.html"
        ? await injectIssueUrl(file.dataUrl, result.url, result.identifier) : file.dataUrl;
      uploaded = await uploadFile({ ...file, dataUrl });
    } catch (error) {
      if (isLog) logsDropped = true;
      responses.push({ fileId: file.fileId, ok: false, failure: safeAttachmentFailure(error) });
      continue;
    }
    let linked = false;
    try {
      const response = await sendBg<{ ok: boolean }>({ type: "linear.createAttachment", issueId: result.id, title: file.displayName ?? file.filename, url: uploaded.assetUrl! });
      linked = response?.ok === true;
    } catch { /* The body link is an independent delivery path for logs. */ }
    let bodyLinked = false;
    if (isLog) {
      try {
        const linkedBody = buildLinearIssueBody({ ctx: resolvedCtx, images: imageResults, video: videoResult ?? undefined, cc: input.cc?.map((u) => u.name), logsUrl: uploaded.assetUrl }).body;
        if (linkedBody !== body) {
          const response = await sendBg<{ ok: boolean }>({ type: "linear.updateIssueDescription", issueId: result.id, description: linkedBody });
          bodyLinked = response?.ok === true;
        }
      } catch { /* Preserve the native attachment result. */ }
    }
    responses.push({ fileId: file.fileId, ok: linked || bodyLinked, href: uploaded.assetUrl, presentation: isLog && !bodyLinked && linked ? "failed" : isLog ? "complete" : "not-applicable",
      ...(!linked && !bodyLinked ? { failure: { stage: "link", code: "unknown" } as const } : {}) });
  }
  const attachments = input.submissionFiles ? deliveryResults(input.submissionFiles, responses) : undefined;
  return { key: result.identifier, url: result.url, logsDropped, ...(attachments ? { attachments } : {}) };
}
