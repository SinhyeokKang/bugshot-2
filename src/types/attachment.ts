// Relative on purpose: e2e specs import this file under a tsconfig without the `@/` alias.
import type { LocaleMode } from "../i18n/locales";

// 사용자가 직접 첨부한 로컬 파일의 메타(Blob은 IndexedDB attachments store에, 메타만 session/IssueRecord).
export interface UserAttachmentMeta {
  id: string;
  filename: string;
  contentType: string;
  size: number;
}

export type AttachmentKind = "capture" | "video" | "inline" | "logs" | "user";
export type AttachmentFailureCode =
  | "missing-source" | "local-storage" | "authentication" | "permission"
  | "size-limit" | "rate-limit" | "network" | "timeout"
  | "invalid-response" | "body-limit" | "unknown";
export type AttachmentStage = "source" | "upload" | "link" | "body";

export interface SubmissionFile {
  id: string;
  kind: AttachmentKind;
  filename: string;
  contentType: string;
  dataUrl: string;
}

export interface AttachmentResult {
  fileId: string;
  delivery: "attached" | "failed" | "unknown";
  presentation: "complete" | "failed" | "not-applicable";
  failure?: { stage: AttachmentStage; code: AttachmentFailureCode; httpStatus?: number };
}

export type CreatedDestination = {
  [P in keyof DestinationLocators]: {
    platform: P;
    key: string;
    url?: string;
    locator: DestinationLocators[P];
  }
}[keyof DestinationLocators];

interface DestinationLocators {
  jira: { issueKey: string; siteId: string };
  github: { owner: string; repo: string; number: string };
  gitlab: { projectId: string; iid: string };
  linear: { issueId: string };
  notion: { pageId: string };
  asana: { taskGid: string };
  clickup: { taskId: string };
  slack: { channelId: string; ts: string };
  webhook: { key: string; url: string };
}

export type RecoverySource =
  | { kind: "original"; store: "blobs" | "images" | "inlineImages" | "attachments"; key: string }
  | { kind: "generated"; key: string };

export interface SubmissionRecoveryMeta {
  attemptId: string;
  issueId: string;
  title: string;
  platform: CreatedDestination["platform"];
  createdAt: number;
  expiresAt: number;
  localFilesRemoved?: boolean;
  phase: "prepared" | "creating" | "created" | "partial" | "complete" | "unknown";
  destination?: CreatedDestination;
  files: Array<Omit<SubmissionFile, "dataUrl"> & { source: RecoverySource; originalSource?: Extract<RecoverySource, { kind: "original" }> }>;
  results: AttachmentResult[];
  submissionFailure?: AttachmentResult["failure"];
  retry?: AttachmentRetrySnapshot;
  updatedAt: number;
}

export class MissingSubmissionFilesError extends Error {
  constructor(readonly fileIds: string[]) {
    super("Submission source files are missing");
    this.name = "MissingSubmissionFilesError";
  }
}

// Why an automatic retry cannot run; every case keeps the local download.
export type AttachmentRetryReason =
  | "authentication" | "permission" | "remote-missing" | "account-changed" | "account-unverified"
  | "ambiguous" | "body-conflict" | "webhook-unsupported" | "local-missing" | "legacy";
export type RetryPlatform = Exclude<CreatedDestination["platform"], "webhook">;
// Remote locators only — never signed upload URLs or tokens.
export type UploadedAttachment =
  | { platform: "github" | "gitlab" | "linear" | "clickup"; href: string }
  | { platform: "jira"; id: string; href: string; mediaId?: string }
  | { platform: "asana"; id: string }
  | { platform: "notion"; id: string; expiresAt: number | null }
  | { platform: "slack"; id: string };
export type CheckpointState = "pending" | "done" | "failed" | "unknown";
export interface AttachmentCheckpoint {
  fileId: string;
  upload: CheckpointState;
  link: CheckpointState | "not-applicable";
  body: CheckpointState | "conflict" | "not-applicable";
  uploaded?: UploadedAttachment;
  linkedId?: string;
}
export type AttachmentCheckpointPatch = Pick<AttachmentCheckpoint, "fileId"> & Partial<Omit<AttachmentCheckpoint, "fileId">>;
export interface AttachmentBodyPlan {
  format: "markdown" | "adf" | "asana-html" | "notion-blocks" | "slack-thread";
  lastWritten: string;
  replacements: Array<{ fileId: string; anchor: string; before: string; after?: string; renderTemplate: string }>;
}
export interface AttachmentRetrySnapshot {
  schemaVersion: 1;
  // null = not verified at submission; auto-retry stays blocked.
  accountIdentity: string | null;
  bodyLocale: LocaleMode;
  checkpoints: AttachmentCheckpoint[];
  bodyPlan: AttachmentBodyPlan;
  revision: number;
}
export interface AttachmentRetryPatch {
  checkpoints?: AttachmentCheckpoint[];
  lastWritten?: string;
  bodyPlan?: AttachmentBodyPlan;
  accountIdentity?: string;
}
