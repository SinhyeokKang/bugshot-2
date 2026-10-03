import { resolveStyleElements, type MarkdownContext } from "./buildIssueMarkdown";
import type { AttachmentResult, SubmissionFile } from "@/types/attachment";
import type { SubmissionProgress } from "./submissionRecovery";
import { reconcileAttachmentResults, type AttachmentEvidence } from "./attachmentResults";

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
}
export function deliveryResults(files: readonly SubmissionFile[], responses: readonly DeliveryResponse[], bodyFailed = false): AttachmentResult[] {
  const evidence: AttachmentEvidence[] = responses.filter((r) => r.fileId).map((r) => {
    const kind = files.find((f) => f.id === r.fileId)?.kind;
    const presentation = !r.ok ? "failed" : r.presentation ?? (r.ok ? bodyFailed && kind !== "user" ? "failed" : kind === "user" ? "not-applicable" : "complete" : "failed");
    const ambiguous = r.failure?.stage === "upload" && (
      (r.failure.httpStatus === undefined && ["network", "timeout", "unknown"].includes(r.failure.code))
      || r.failure.httpStatus === 408 || (r.failure.httpStatus ?? 0) >= 500
    );
    return { fileId: r.fileId!, delivery: r.ok ? "attached" : ambiguous ? "unknown" : "failed", locator: r.href, presentation,
      ...(!r.ok ? { failure: r.failure ?? { stage: "upload" as const, code: "unknown" as const } } : presentation === "failed" ? { failure: r.failure ?? { stage: "body" as const, code: "unknown" as const } } : {}) };
  });
  return reconcileAttachmentResults(files, evidence);
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
