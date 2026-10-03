import type { AttachmentCheckpoint, AttachmentResult, SubmissionRecoveryMeta } from "@/types/attachment";

const ISSUE_URL = "https://github.com/o/r/issues/7";

type Overrides = Partial<SubmissionRecoveryMeta> & { identity?: string | null; checkpoints?: AttachmentCheckpoint[]; slots?: boolean };

export const failedCheckpoint = (fileId: string, patch: Partial<AttachmentCheckpoint> = {}): AttachmentCheckpoint => ({ fileId, upload: "failed", link: "not-applicable", body: "pending", ...patch });
export const failedResult = (fileId: string, patch: Partial<AttachmentResult> = {}): AttachmentResult => ({ fileId, delivery: "failed", presentation: "failed", failure: { stage: "upload", code: "network" }, ...patch });

// A GitHub record whose first upload failed: retryable unless an override says otherwise.
export function retryMeta({ identity = "github:1", checkpoints, slots = true, ...rest }: Overrides = {}): SubmissionRecoveryMeta {
  const cps = checkpoints ?? [failedCheckpoint("capture:after-0")];
  return {
    attemptId: "a", issueId: "issue", title: "Report", platform: "github", phase: "partial",
    createdAt: 1, updatedAt: 1, expiresAt: Date.now() + 10 * 86_400_000,
    destination: { platform: "github", key: "#7", url: ISSUE_URL, locator: { owner: "o", repo: "r", number: "7" } },
    files: cps.map((c) => ({ id: c.fileId, kind: "capture", filename: `${c.fileId}.webp`, contentType: "image/webp", source: { kind: "generated", key: `file:a:${c.fileId}` } })),
    results: cps.map((c) => failedResult(c.fileId)),
    retry: {
      schemaVersion: 1, accountIdentity: identity, bodyLocale: "en", revision: 1, checkpoints: cps,
      bodyPlan: { format: "markdown", lastWritten: "", replacements: slots ? cps.map((c) => ({ fileId: c.fileId, anchor: "[]", before: "[]", after: "[]", renderTemplate: "[]" })) : [] },
    },
    ...rest,
  };
}
