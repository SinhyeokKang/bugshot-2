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
  updatedAt: number;
}

export class MissingSubmissionFilesError extends Error {
  constructor(readonly fileIds: string[]) {
    super("Submission source files are missing");
    this.name = "MissingSubmissionFilesError";
  }
}
