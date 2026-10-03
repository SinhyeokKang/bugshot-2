import { safeAttachmentFailure } from "@/lib/attachment-failure";
import { bindSubmissionFiles, deliveryResults, recordBodySlots, submitCreation, type SubmissionAdapterInput } from "./submissionAdapter";
import { bodySlotToken, buildBodyReplacements } from "./attachmentBodyPatch";
import { failedStageState } from "./attachmentCheckpoints";
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
  const progress = input.progress;
  // Pre-create uploads are strict (any failure aborts before creation), so only successes are recorded.
  const uploadAndCheckpoint = async (file: LinearFileInput): Promise<LinearMediaInput> => {
    const uploaded = await uploadFile(file);
    if (file.fileId) await progress?.fileCheckpoint({ fileId: file.fileId, upload: "done", uploaded: { platform: "linear", href: uploaded.assetUrl! } });
    return uploaded;
  };
  const uploadPromises: Promise<LinearMediaInput>[] = [];
  const imageIndexes = input.images ?? [];
  for (const img of imageIndexes) uploadPromises.push(uploadAndCheckpoint(img));
  const videoPromise = input.video ? uploadAndCheckpoint(input.video) : null;

  const [imageResults, videoResult, inlineResults] = await Promise.all([
    Promise.all(uploadPromises),
    videoPromise,
    Promise.all(
      (input.inlineImages ?? []).map(async (img) => {
        const result = await uploadAndCheckpoint({
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
  await progress?.bodyWritten(body, ...(input.submissionFiles ?? []).filter((f) => ["capture", "video", "inline"].includes(f.kind)).map((f) => ({ fileId: f.id, body: "done" as const })));

  const responses: import("./submissionAdapter").DeliveryResponse[] = [];
  for (const f of input.submissionFiles ?? []) {
    if (["capture", "video", "inline"].includes(f.kind)) responses.push({ fileId: f.id, ok: true, href: result.url });
  }
  let lastBody = body;
  const logsInBody: string[] = [];
  for (const file of [...(input.logs ?? []), ...(input.attachments ?? [])]) {
    const isLog = (input.logs ?? []).includes(file);
    let uploaded: LinearMediaInput;
    try {
      const dataUrl = !input.submissionFiles && isLog && file.filename === "logs.html"
        ? await injectIssueUrl(file.dataUrl, result.url, result.identifier) : file.dataUrl;
      uploaded = await uploadFile({ ...file, dataUrl });
    } catch (error) {
      const failure = safeAttachmentFailure(error);
      responses.push({ fileId: file.fileId, ok: false, failure });
      if (file.fileId) await progress?.fileCheckpoint({ fileId: file.fileId, upload: failedStageState(failure) });
      continue;
    }
    if (file.fileId) await progress?.fileCheckpoint({ fileId: file.fileId, upload: "done", uploaded: { platform: "linear", href: uploaded.assetUrl! } });
    let linked = false;
    let linkFailure: ReturnType<typeof safeAttachmentFailure> | undefined;
    try {
      const response = await sendBg<{ ok: boolean }>({ type: "linear.createAttachment", issueId: result.id, title: file.displayName ?? file.filename, url: uploaded.assetUrl! });
      linked = response?.ok === true;
    } catch (error) { linkFailure = safeAttachmentFailure(error, "link"); /* The body link is an independent delivery path for logs. */ }
    if (file.fileId) await progress?.fileCheckpoint({ fileId: file.fileId, link: linked ? "done" : linkFailure ? failedStageState(linkFailure) : "failed" });
    let bodyLinked = false;
    let linkedBody = body;
    if (isLog) {
      try { linkedBody = buildLinearIssueBody({ ctx: resolvedCtx, images: imageResults, video: videoResult ?? undefined, cc: input.cc?.map((u) => u.name), logsUrl: uploaded.assetUrl }).body; }
      catch { /* Preserve the native attachment result. */ }
    }
    if (linkedBody !== body) {
      let bodyFailure: ReturnType<typeof safeAttachmentFailure> | undefined;
      try {
        const response = await sendBg<{ ok: boolean }>({ type: "linear.updateIssueDescription", issueId: result.id, description: linkedBody });
        bodyLinked = response?.ok === true;
      } catch (error) { bodyFailure = safeAttachmentFailure(error, "body"); /* Preserve the native attachment result. */ }
      if (file.fileId) {
        if (bodyLinked) await progress?.bodyWritten(linkedBody, { fileId: file.fileId, body: "done" });
        else await progress?.fileCheckpoint({ fileId: file.fileId, body: bodyFailure ? failedStageState(bodyFailure) : "failed" });
      }
    }
    if (bodyLinked) { lastBody = linkedBody; if (file.fileId) logsInBody.push(file.fileId); }
    responses.push({ fileId: file.fileId, ok: linked || bodyLinked, href: uploaded.assetUrl, presentation: isLog && !bodyLinked && linked ? "failed" : isLog ? "complete" : "not-applicable",
      ...(!linked && !bodyLinked ? { failure: { stage: "link", code: "unknown" } as const } : {}) });
  }
  const pending = (input.logs ?? []).filter((f) => f.fileId && !logsInBody.includes(f.fileId)).map((f) => f.fileId!);
  await recordBodySlots(progress, lastBody, pending, () => buildBodyReplacements({ format: "markdown", base: lastBody, pending,
    render: (success) => buildLinearIssueBody({ ctx: resolvedCtx, images: imageResults, video: videoResult ?? undefined, cc: input.cc?.map((u) => u.name),
      logsUrl: pending.find((id) => success.has(id)) ? bodySlotToken(pending.find((id) => success.has(id))!) : undefined }).body }));
  const attachments = deliveryResults(input.submissionFiles ?? [], responses);
  return { key: result.identifier, url: result.url, attachments };
}
