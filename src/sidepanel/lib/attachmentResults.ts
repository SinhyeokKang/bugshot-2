import type { AttachmentResult, SubmissionFile } from "@/types/attachment";

export type AttachmentEvidence = AttachmentResult & { locator?: string };

export function reconcileAttachmentResults(
  expected: ReadonlyArray<Pick<SubmissionFile, "id">>,
  responses: readonly AttachmentEvidence[],
): AttachmentResult[] {
  if (new Set(expected.map((f) => f.id)).size !== expected.length) throw new Error("Duplicate submission file ID");
  return expected.map(({ id }) => {
    const matches = responses.filter((result) => result.fileId === id);
    if (matches.length !== 1 || (matches[0].delivery === "attached" && !matches[0].locator?.trim())) {
      return { fileId: id, delivery: "unknown", presentation: "failed", failure: { stage: "upload", code: "invalid-response" } };
    }
    const { fileId, delivery, presentation, failure } = matches[0];
    return { fileId, delivery, presentation, ...(failure ? { failure: { stage: failure.stage, code: failure.code, ...(failure.httpStatus !== undefined ? { httpStatus: failure.httpStatus } : {}) } } : {}) };
  });
}

export { attachmentFailureCode } from "@/lib/attachment-failure";

export function submissionPresentation(creation: "created" | "unknown", results: readonly AttachmentResult[]) {
  const screen = creation === "unknown" ? "unknown"
    : results.some((r) => r.delivery !== "attached" || r.presentation === "failed") ? "partial" : "success";
  return { screen, showPanel: screen !== "success", showToast: false } as const;
}

export function legacyAttachmentDrops(
  files: ReadonlyArray<Pick<SubmissionFile, "id" | "kind">>,
  results: readonly AttachmentResult[],
): { logsDropped: boolean; mediaDropped: boolean } {
  const dropped = (file: (typeof files)[number]) => {
    const matches = results.filter((r) => r.fileId === file.id);
    return matches.length !== 1 || matches[0].delivery !== "attached";
  };
  return {
    logsDropped: files.some((f) => f.kind === "logs" && dropped(f)),
    mediaDropped: files.some((f) => ["capture", "video", "inline"].includes(f.kind) && dropped(f)),
  };
}
