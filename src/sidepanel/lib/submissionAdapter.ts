import { resolveStyleElements, type MarkdownContext } from "./buildIssueMarkdown";
import type { AttachmentBodyPlan, AttachmentCheckpointPatch, AttachmentResult, SubmissionFile, UploadedAttachment } from "@/types/attachment";
import type { SubmissionProgress } from "./submissionRecovery";
import { reconcileAttachmentResults, type AttachmentEvidence } from "./attachmentResults";
import { failedStageState } from "./attachmentCheckpoints";

export interface SubmissionAdapterInput {
  progress?: SubmissionProgress;
  submissionFiles?: SubmissionFile[];
}
interface FileInput { filename: string; dataUrl: string; displayName?: string; fileId?: string; contentType?: string }
interface FilesInput extends SubmissionAdapterInput {
  ctx?: MarkdownContext;
  images?: FileInput[];
  video?: FileInput;
  logs?: FileInput[];
  attachments?: FileInput[];
  inlineImages?: { refId: string; dataUrl: string; fileId?: string; filename?: string; contentType?: string }[];
}
export function bindSubmissionFiles<T extends FilesInput>(input: T): T {
  if (!input.submissionFiles) return input;
  const byKind = (kind: SubmissionFile["kind"]) => input.submissionFiles!.filter((f) => f.kind === kind);
  const bind = (old: FileInput[] | undefined, kind: SubmissionFile["kind"]) => byKind(kind).map((f, i) => ({ ...old?.[i], filename: kind === "user" ? old?.[i]?.filename ?? f.filename : f.filename, dataUrl: f.dataUrl, contentType: f.contentType, fileId: f.id }));
  const renames = new Map((input.images ?? []).map((f, i) => [f.filename, byKind("capture")[i]?.filename ?? f.filename]));
  const ctx = input.ctx && [...renames].some(([before, after]) => before !== after)
    ? { ...input.ctx, styleElements: resolveStyleElements(input.ctx).map((e) => ({ ...e, beforeFilename: e.beforeFilename ? renames.get(e.beforeFilename) ?? e.beforeFilename : undefined, afterFilename: e.afterFilename ? renames.get(e.afterFilename) ?? e.afterFilename : undefined })) } : input.ctx;
  return { ...input, ...(ctx ? { ctx } : {}), images: bind(input.images, "capture"), video: bind(input.video ? [input.video] : [], "video")[0], logs: bind(input.logs, "logs"), attachments: bind(input.attachments, "user"), inlineImages: byKind("inline").map((f) => ({ refId: f.id.slice("inline:".length), dataUrl: f.dataUrl, filename: f.filename, fileId: f.id, contentType: f.contentType })) };
}
export interface DeliveryResponse {
  fileId?: string;
  filename?: string;
  ok: boolean;
  href?: string;
  failure?: AttachmentResult["failure"];
  presentation?: AttachmentResult["presentation"];
  // A write that may or may not have landed (e.g. Slack complete internal_error).
  ambiguous?: boolean;
}
export function deliveryResults(files: readonly SubmissionFile[], responses: readonly DeliveryResponse[], bodyFailed = false): AttachmentResult[] {
  const evidence: AttachmentEvidence[] = responses.filter((r) => r.fileId).map((r) => {
    const kind = files.find((f) => f.id === r.fileId)?.kind;
    const presentation = !r.ok ? "failed" : r.presentation ?? (r.ok ? bodyFailed && kind !== "user" ? "failed" : kind === "user" ? "not-applicable" : "complete" : "failed");
    const ambiguous = r.failure?.stage === "upload" && failedStageState(r.failure) === "unknown";
    return { fileId: r.fileId!, delivery: r.ok ? "attached" : ambiguous || r.ambiguous ? "unknown" : "failed", locator: r.href, presentation,
      ...(!r.ok ? { failure: r.failure ?? { stage: "upload" as const, code: "unknown" as const } } : presentation === "failed" ? { failure: r.failure ?? { stage: "body" as const, code: "unknown" as const } } : {}) };
  });
  return reconcileAttachmentResults(files, evidence);
}

// Upload-stage checkpoint from one batch response, keyed by file ID like deliveryResults.
export function uploadCheckpoints(
  files: readonly SubmissionFile[],
  responses: readonly DeliveryResponse[],
  locator: (response: DeliveryResponse) => UploadedAttachment | undefined,
): AttachmentCheckpointPatch[] {
  return files.map((file) => {
    const matches = responses.filter((r) => r.fileId === file.id);
    const response = matches.length === 1 ? matches[0] : undefined;
    const uploaded = response?.ok ? locator(response) : undefined;
    return uploaded ? { fileId: file.id, upload: "done", uploaded } : { fileId: file.id, upload: response ? failedStageState(response.failure) : "unknown" };
  });
}

export async function submitCreation<T>(progress: SubmissionProgress | undefined, create: () => Promise<T>): Promise<T> {
  await progress?.beforeCreate();
  try { return await create(); }
  catch (error) {
    const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
    const body = error && typeof error === "object" && "body" in error ? error.body : undefined;
    const rejected = body && typeof body === "object" && "platform" in body && body.platform === "slack" && "creationRejected" in body && body.creationRejected === true;
    if (rejected || (typeof status === "number" && [400, 401, 403, 404, 413, 422, 429].includes(status))) {
      const { SubmissionCreationRejectedError } = await import("./submissionRecovery");
      throw new SubmissionCreationRejectedError();
    }
    throw error;
  }
}

// Retry slots are best effort: a failure to compute them leaves the record without slots, which a
// retry offers as download only (legacy) — it must never fail the already-created submission.
export async function recordBodySlots(
  progress: SubmissionProgress | undefined,
  lastWritten: string,
  pending: readonly string[],
  compute: () => AttachmentBodyPlan["replacements"] | Promise<AttachmentBodyPlan["replacements"]>,
): Promise<void> {
  if (!progress?.bodySlots || !pending.length) return;
  let replacements: AttachmentBodyPlan["replacements"];
  try { replacements = await compute(); } catch { return; }
  await progress.bodySlots(lastWritten, replacements);
}
