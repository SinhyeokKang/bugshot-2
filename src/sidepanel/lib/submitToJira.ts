import { safeAttachmentFailure } from "@/lib/attachment-failure";
import { bindSubmissionFiles, deliveryResults, submitCreation, type SubmissionAdapterInput } from "./submissionAdapter";
import { failedStageState } from "./attachmentCheckpoints";
import type { JiraAdfDoc } from "@/types/jira";
import { buildIssueAdf } from "./buildIssueAdf";
import { annotateAttachmentDimensions } from "./attachmentDimensions";
import type { MarkdownContext } from "./buildIssueMarkdown";
import type { CaptureFile } from "./buildCaptureFiles";
import type { InlineImageInput } from "./resolveInlineImages";
import { sendBg } from "@/lib/bg-client";
import type { JiraAttachmentInput } from "@/types/jira";
import type { NormalizedSubmitResult } from "@/types/platform";
import { inlineUploadFilename } from "@/lib/inline-ref";

export type { NormalizedSubmitResult } from "@/types/platform";

export interface JiraSubmitInput extends SubmissionAdapterInput {
  ctx: MarkdownContext;
  inlineImages?: InlineImageInput[];
  images?: CaptureFile[];
  video?: CaptureFile;
  logs?: CaptureFile[];
  attachments?: CaptureFile[];
  projectKey: string;
  summary: string;
  issueTypeId: string;
  assigneeAccountId?: string;
  priorityId?: string;
  parentKey?: string;
  sprintId?: number;
  relates?: { key: string; label: string }[];
  cc?: { accountId: string; displayName: string }[];
}

export async function submitToJira(input: JiraSubmitInput): Promise<NormalizedSubmitResult> {
  input = bindSubmissionFiles(input);
  const inlineImages = input.inlineImages ?? [];
  const rawAttachments: JiraAttachmentInput[] = [
    ...(input.images ?? []),
    ...(input.video ? [input.video] : []),
    ...(input.logs ?? []),
  ];
  for (const img of inlineImages) {
    rawAttachments.push({ fileId: img.fileId, filename: img.filename ?? inlineUploadFilename(img.refId), dataUrl: img.dataUrl });
  }
  // 사용자 첨부: Jira는 업로드 시 attachment 영역에 자동 등록(본문 placeholder 불필요). 표시명=원본.
  for (const a of input.attachments ?? []) {
    rawAttachments.push({
      fileId: (a as CaptureFile & { fileId?: string }).fileId,
      filename: a.displayName ?? a.filename,
      dataUrl: a.dataUrl,
      userAttachment: true,
    });
  }
  const attachments = await annotateAttachmentDimensions(rawAttachments);

  const description = buildIssueAdf(input.ctx, inlineImages.map((i) => i.refId), input.cc);
  const result = await submitCreation(input.progress, () => sendBg<{ key: string; url: string; siteId: string; description?: JiraAdfDoc }>({
    type: "jira.createIssue",
    payload: {
      bodyLocale: input.ctx.bodyLocale,
      projectKey: input.projectKey,
      summary: input.summary,
      description,
      issueTypeId: input.issueTypeId,
      assigneeAccountId: input.assigneeAccountId,
      priorityId: input.priorityId,
      parentKey: input.parentKey,
      sprintId: input.sprintId,
    },

  }));
  await input.progress?.created({ platform: "jira", key: result.key, url: result.url, locator: { issueKey: result.key, siteId: result.siteId } });
  // The background builds the safe ADF actually written; only that is a valid patch base.
  if (result.description) await input.progress?.bodyWritten(JSON.stringify(result.description));
  type Uploaded = import("@/types/messages").UploadFileResult & { attachmentId?: string; file?: { kind: "media"; mediaId: string } | { kind: "external"; url: string } };
  const responses: Uploaded[] = [];
  for (const attachment of attachments) {
    let response: Uploaded;
    try {
      response = await sendBg<Uploaded>({ type: "jira.uploadAttachment", issueKey: result.key, attachment });
    } catch (error) { response = { fileId: attachment.fileId, filename: attachment.filename, ok: false, failure: safeAttachmentFailure(error) }; }
    responses.push(response);
    if (!attachment.fileId) continue;
    const located = response.ok && response.fileId === attachment.fileId && response.attachmentId ? response : undefined;
    await input.progress?.fileCheckpoint(located?.ok
      ? { fileId: attachment.fileId, upload: "done", uploaded: { platform: "jira", id: located.attachmentId!, href: located.href, ...(located.file?.kind === "media" ? { mediaId: located.file.mediaId } : {}) } }
      : { fileId: attachment.fileId, upload: response.ok ? "unknown" : failedStageState(response.failure) });
  }
  const uploads: Array<{ filename: string; file: NonNullable<Uploaded["file"]> }> = [];
  const inBody: string[] = [];
  let logsUrl: string | undefined;
  for (const attachment of attachments) {
    const matches = responses.filter((r) => attachment.fileId ? r.fileId === attachment.fileId : r.filename === attachment.filename);
    const r = matches.length === 1 ? matches[0] : undefined;
    if (!r?.ok || attachment.userAttachment) continue;
    const prepared = input.submissionFiles?.find((f) => f.id === attachment.fileId);
    const bodyFilename = prepared?.id === "capture:screenshot" ? "screenshot.webp"
      : prepared?.kind === "capture" && /^capture:(before|after)-\d+$/.test(prepared.id) ? `${prepared.id.slice("capture:".length)}.webp`
      : prepared?.kind === "inline" ? inlineUploadFilename(prepared.id.slice("inline:".length)) : attachment.filename;
    if (r.file) uploads.push({ filename: bodyFilename, file: r.file });
    if (attachment.fileId === "logs" || (!attachment.fileId && attachment.filename === "logs.html")) logsUrl = r.href;
    if (attachment.fileId && (r.file || attachment.fileId === "logs")) inBody.push(attachment.fileId);
  }
  let bodyFailed = false;
  let written: { description?: JiraAdfDoc } | undefined;
  let bodyFailure: ReturnType<typeof safeAttachmentFailure> | undefined;
  try {
    written = await sendBg<{ description?: JiraAdfDoc }>({ type: "jira.updateIssueDescription", issueKey: result.key, description, bodyLocale: input.ctx.bodyLocale, uploads, logsUrl, relates: input.relates?.map((r) => r.key) });
  } catch (error) { bodyFailed = true; bodyFailure = safeAttachmentFailure(error, "body"); }
  const bodyStates = inBody.map((fileId) => ({ fileId, body: bodyFailed ? failedStageState(bodyFailure) : "done" as const }));
  if (!bodyFailed && written?.description) await input.progress?.bodyWritten(JSON.stringify(written.description), ...bodyStates);
  else if (bodyStates.length) await input.progress?.fileCheckpoint(...bodyStates);
  return { key: result.key, url: result.url,
    attachments: deliveryResults(input.submissionFiles ?? [], responses, bodyFailed),
  };
}
