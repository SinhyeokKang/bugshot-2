import type { AttachmentCheckpoint, AttachmentKind, AttachmentResult, AttachmentRetryReason, RetryPlatform, SubmissionRecoveryMeta } from "@/types/attachment";

type Stages = Pick<AttachmentCheckpoint, "link" | "body">;
const PENDING_BODY: Stages = { link: "not-applicable", body: "pending" };
const NOTHING: Stages = { link: "not-applicable", body: "not-applicable" };
const LINK_ONLY: Stages = { link: "pending", body: "not-applicable" };

// Which stages make a file reachable from the remote issue on each platform.
const STAGES: Record<RetryPlatform, (kind: AttachmentKind) => Stages> = {
  github: () => PENDING_BODY,
  gitlab: () => PENDING_BODY,
  jira: (kind) => kind === "user" ? NOTHING : PENDING_BODY,
  linear: (kind) => kind === "logs" ? { link: "pending", body: "pending" } : kind === "user" ? LINK_ONLY : PENDING_BODY,
  notion: () => LINK_ONLY,
  asana: (kind) => kind === "capture" || kind === "inline" || kind === "logs" ? PENDING_BODY : NOTHING,
  clickup: (kind) => kind === "user" ? NOTHING : PENDING_BODY,
  slack: () => LINK_ONLY,
};

export function initialAttachmentCheckpoints(platform: RetryPlatform, files: ReadonlyArray<{ id: string; kind: AttachmentKind }>): AttachmentCheckpoint[] {
  return files.map((file) => ({ fileId: file.id, upload: "pending", ...STAGES[platform](file.kind) }));
}

// A write whose outcome we cannot know must not be replayed blindly.
export function failedStageState(failure: AttachmentResult["failure"] | undefined): "failed" | "unknown" {
  if (!failure) return "unknown";
  const status = failure.httpStatus;
  if (status === undefined) return ["network", "timeout", "unknown"].includes(failure.code) ? "unknown" : "failed";
  return status === 408 || status >= 500 ? "unknown" : "failed";
}

export function retrySnapshotBlocker(meta: SubmissionRecoveryMeta): AttachmentRetryReason | null {
  if (meta.platform === "webhook") return "webhook-unsupported";
  if (meta.phase !== "partial" || !meta.destination) return "ambiguous";
  if (!meta.retry) return "legacy";
  if (meta.localFilesRemoved) return "local-missing";
  if (meta.retry.accountIdentity === null) return "account-unverified";
  return null;
}
