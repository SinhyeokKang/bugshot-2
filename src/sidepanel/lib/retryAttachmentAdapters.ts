import { retryFailureReason, safeAttachmentFailure } from "@/lib/attachment-failure";
import { sendBg } from "@/lib/bg-client";
import type {
  AttachmentCheckpoint, AttachmentCheckpointPatch, AttachmentResult, AttachmentRetryReason, AttachmentStage,
  CreatedDestination, RetryPlatform, SubmissionRecoveryMeta, UploadedAttachment,
} from "@/types/attachment";
import type { AsanaUploadFileResult, UploadFileResult } from "@/types/messages";
import type { JiraAdfDoc } from "@/types/jira";
import type { SlackCompleteResult } from "@/types/slack";
import { failedStageState } from "./attachmentCheckpoints";
import { adfNodeKey, planAttachmentBodyPatch } from "./attachmentBodyPatch";
import { annotateAttachmentDimensions } from "./attachmentDimensions";
import { base64ByteLength, jiraBodyFilename } from "./uploadPayload";

type Failure = NonNullable<AttachmentResult["failure"]>;
type RecoveryFile = SubmissionRecoveryMeta["files"][number];
export type RetryStage = "upload" | "link" | "body";
export type RetryFileState = "running" | "done" | "failed" | "unknown" | "conflict" | "local-missing";

// A remote answer that ends the whole run: the issue is gone, unreadable or the account is not ours.
export class RetryStop extends Error {
  constructor(readonly reason: Extract<AttachmentRetryReason, "authentication" | "permission" | "remote-missing">) {
    super(`Attachment retry stopped: ${reason}`);
    this.name = "RetryStop";
  }
}

export interface RetryContext {
  meta: SubmissionRecoveryMeta & { destination: CreatedDestination; retry: NonNullable<SubmissionRecoveryMeta["retry"]> };
  checkpoint(fileId: string): AttachmentCheckpoint;
  // Durable before the next remote write; a rejection ends the run.
  save(...patches: AttachmentCheckpointPatch[]): Promise<void>;
  saveBody(lastWritten: string, ...patches: AttachmentCheckpointPatch[]): Promise<void>;
  // Preserved bytes as a data URL, or null when they are gone.
  bytes(fileId: string): Promise<string | null>;
  // Records that a file needing an upload has no preserved bytes (zero upload requests).
  missing(fileId: string): void;
  failed(fileId: string, failure: Failure): void;
  emit(fileId: string, stage: RetryStage, state: RetryFileState): void;
}

const isDone = (state: string) => state === "done" || state === "not-applicable";
// Linear delivers logs through either the native attachment or the body link.
export function fileFinished(platform: SubmissionRecoveryMeta["platform"], file: Pick<RecoveryFile, "kind">, cp: AttachmentCheckpoint): boolean {
  if (cp.upload !== "done") return false;
  if (platform === "linear" && file.kind === "logs" && cp.body === "done") return true;
  return isDone(cp.link) && isDone(cp.body);
}

// The first stage a retry runs for each unfinished file. Writes whose outcome cannot be checked
// (a Notion append or Slack complete without a block id / files:read) are never planned again.
// `hasSlot`: the record holds a body slot for the file. GitHub/GitLab uploads are reachable only
// through the body, so a slotless file (phase-one or pre-slot record) is never uploaded again.
export function planFileStage(platform: SubmissionRecoveryMeta["platform"], file: Pick<RecoveryFile, "kind">, cp: AttachmentCheckpoint, hasSlot = true): RetryStage | null {
  if (fileFinished(platform, file, cp)) return null;
  if ((platform === "github" || platform === "gitlab") && cp.body !== "not-applicable" && !hasSlot) return null;
  // Slack discards an uncompleted upload, so only an unconfirmed complete is never redone.
  if (platform === "slack") return cp.link === "unknown" ? null : "upload";
  // An upload whose result is unknown is sent again only where it cannot surface on the issue by
  // itself (Notion's unattached upload) or after a name check (Jira/Asana attachment lists).
  if (cp.upload !== "done") return cp.upload === "unknown" && !["notion", "jira", "asana"].includes(platform) ? null : "upload";
  if (!isDone(cp.link)) return cp.link === "unknown" && platform === "notion" ? null : "link";
  return hasSlot ? "body" : null;
}

// Classifies a remote failure; a fatal one is persisted by the caller and then stops the run.
function classify(error: unknown, stage: AttachmentStage): { failure: Failure; fatal?: RetryStop["reason"] } {
  const reason = retryFailureReason(error);
  return { failure: safeAttachmentFailure(error, stage), ...(reason !== "ambiguous" ? { fatal: reason } : {}) };
}

async function guarded<T>(ctx: RetryContext, fileIds: readonly string[], stage: RetryStage, write: () => Promise<T>,
  onError: (failure: Failure) => AttachmentCheckpointPatch[]): Promise<T | undefined> {
  try { return await write(); }
  catch (error) {
    // A per-file rejection inside a successful response keeps its own code and never stops the run.
    const { failure, fatal } = error instanceof UploadRejected ? { failure: error.failure, fatal: undefined } : classify(error, stage);
    await ctx.save(...onError(failure));
    for (const id of fileIds) { ctx.failed(id, failure); ctx.emit(id, stage, failedStageState(failure)); }
    if (fatal) throw new RetryStop(fatal);
    return undefined;
  }
}

async function probe<T>(read: () => Promise<T>): Promise<T> {
  try { return await read(); }
  catch (error) {
    const { fatal } = classify(error, "body");
    if (fatal) throw new RetryStop(fatal);
    throw error;
  }
}

interface BodyIo {
  format: "markdown" | "adf" | "asana-html";
  read(): Promise<string>;
  // `slotUnits`: top-level positions of our restored units in `body` (Jira renders only those).
  write(body: string, slotFiles: readonly string[], slotUnits: readonly number[]): Promise<string>;
  value(cp: AttachmentCheckpoint): string | undefined;
  // Provider-specific check on the planned body; false turns the planned slots into conflicts.
  valid?(body: string, slotFiles: readonly string[]): boolean;
}

// One file per upload message.
async function uploadStage(ctx: RetryContext, files: RecoveryFile[], upload: (file: RecoveryFile, dataUrl: string) => Promise<UploadedAttachment>): Promise<void> {
  for (const file of files) {
    const dataUrl = await ctx.bytes(file.id);
    if (!dataUrl) { ctx.missing(file.id); continue; }
    ctx.emit(file.id, "upload", "running");
    await ctx.save({ fileId: file.id, upload: "unknown", uploaded: undefined });
    const uploaded = await guarded(ctx, [file.id], "upload", () => upload(file, dataUrl), (failure) => [{ fileId: file.id, upload: failedStageState(failure) }]);
    if (!uploaded) continue;
    await ctx.save({ fileId: file.id, upload: "done", uploaded });
    ctx.emit(file.id, "upload", "done");
  }
}

class UploadRejected extends Error {
  constructor(readonly failure: Failure) { super("Upload rejected"); }
}
function uploadedFrom<T extends { fileId?: string; ok: boolean; failure?: Failure }>(results: T[], fileId: string): T & { ok: true } {
  const matches = (results ?? []).filter((r) => r.fileId === fileId);
  if (matches.length !== 1) throw new UploadRejected({ stage: "upload", code: "invalid-response" });
  if (!matches[0].ok) throw new UploadRejected(matches[0].failure ?? { stage: "upload", code: "unknown" });
  return matches[0] as T & { ok: true };
}

async function bodyStage(ctx: RetryContext, io: BodyIo): Promise<void> {
  const { meta } = ctx;
  const readyFile = (f: RecoveryFile) => { const cp = ctx.checkpoint(f.id); return cp.upload === "done" && isDone(cp.link) ? io.value(cp) : undefined; };
  const slotted = new Set(meta.retry.bodyPlan.replacements.map((r) => r.fileId));
  const targets = meta.files.filter((f) => { const cp = ctx.checkpoint(f.id); return cp.upload === "done" && isDone(cp.link) && !isDone(cp.body) && slotted.has(f.id); }).map((f) => f.id);
  if (!targets.length) return;
  const ready = new Map(meta.files.flatMap((f) => { const v = readyFile(f); return v === undefined ? [] : [[f.id, v] as const]; }));
  const plan = (remote: string) => planAttachmentBodyPatch(meta.retry.bodyPlan, remote, ready, targets);
  let remote = await probe(io.read);
  let result = plan(remote);
  // Re-read right before writing; one recompute on change, a second change is a conflict.
  for (let attempt = 0; result.body !== null; attempt++) {
    const latest = await probe(io.read);
    if (latest === remote) break;
    if (attempt === 1) { result = { ...result, body: null, conflict: [...result.conflict, ...result.written], written: [], slotFiles: [], slotUnits: [] }; break; }
    remote = latest;
    result = plan(remote);
  }
  if (result.body !== null && io.valid && !io.valid(result.body, result.slotFiles)) result = { ...result, body: null, conflict: [...result.conflict, ...result.written], written: [], slotFiles: [], slotUnits: [] };
  if (result.present.length) await ctx.save(...result.present.map((fileId) => ({ fileId, body: "done" as const })));
  if (result.conflict.length) await ctx.save(...result.conflict.map((fileId) => ({ fileId, body: "conflict" as const })));
  for (const id of result.present) ctx.emit(id, "body", "done");
  for (const id of result.conflict) ctx.emit(id, "body", "conflict");
  if (result.body === null) return;
  const body = result.body;
  for (const id of result.written) ctx.emit(id, "body", "running");
  await ctx.save(...result.written.map((fileId) => ({ fileId, body: "unknown" as const })));
  const written = await guarded(ctx, result.written, "body", () => io.write(body, result.slotFiles, result.slotUnits),
    (failure) => result.written.map((fileId) => ({ fileId, body: failedStageState(failure) })));
  if (written === undefined) return;
  await ctx.saveBody(written, ...result.written.map((fileId) => ({ fileId, body: "done" as const })));
  for (const id of result.written) ctx.emit(id, "body", "done");
}

const filesAt = (ctx: RetryContext, stage: RetryStage) => {
  const slotted = new Set(ctx.meta.retry.bodyPlan.replacements.map((r) => r.fileId));
  return ctx.meta.files.filter((f) => planFileStage(ctx.meta.platform, f, ctx.checkpoint(f.id), slotted.has(f.id)) === stage);
};

// Provider attachment listings let a lost upload be checked before it is sent again; a file that
// may already be there is left unknown instead of risking a duplicate attachment.
// Attachments this submission already owns (by id) never count as a lost upload's copy.
function reconcileUnknownUploads(ctx: RetryContext, files: RecoveryFile[], remote: ReadonlyArray<{ id: string; name: string }>): RecoveryFile[] {
  const owned = new Set(ctx.meta.files.flatMap((f) => { const u = ctx.checkpoint(f.id).uploaded; return u && "id" in u ? [u.id] : []; }));
  const names = remote.filter((a) => !owned.has(a.id)).map((a) => a.name);
  return files.filter((f) => ctx.checkpoint(f.id).upload !== "unknown" || !names.includes(f.filename));
}

type Adapter = (ctx: RetryContext) => Promise<void>;
type Dest<P extends CreatedDestination["platform"]> = Extract<CreatedDestination, { platform: P }>;
const dest = <P extends CreatedDestination["platform"]>(ctx: RetryContext) => ctx.meta.destination as Dest<P>;
const entry = (file: RecoveryFile, dataUrl: string) => ({ fileId: file.id, filename: file.filename, contentType: file.contentType, dataUrl });
const hrefOf = (cp: AttachmentCheckpoint) => cp.uploaded && "href" in cp.uploaded ? cp.uploaded.href : undefined;

const github: Adapter = async (ctx) => {
  const { locator } = dest<"github">(ctx);
  const at = { owner: locator.owner, repo: locator.repo, number: Number(locator.number) };
  const read = async () => (await sendBg<{ body?: string | null }>({ type: "github.getIssueBody", ...at }))?.body ?? "";
  await probe(read);
  await uploadStage(ctx, filesAt(ctx, "upload"), async (file, dataUrl) => {
    const results = await sendBg<UploadFileResult[]>({ type: "github.uploadFiles", owner: at.owner, repo: at.repo, files: [entry(file, dataUrl)] });
    return { platform: "github", href: uploadedFrom(results, file.id).href };
  });
  await bodyStage(ctx, { format: "markdown", read, value: hrefOf,
    write: async (body) => { await sendBg({ type: "github.updateIssueBody", ...at, body }); return body; } });
};

const gitlab: Adapter = async (ctx) => {
  const { locator } = dest<"gitlab">(ctx);
  const at = { projectId: Number(locator.projectId), iid: Number(locator.iid) };
  const read = async () => (await sendBg<{ description?: string | null }>({ type: "gitlab.getIssueDescription", ...at }))?.description ?? "";
  await probe(read);
  await uploadStage(ctx, filesAt(ctx, "upload"), async (file, dataUrl) => {
    const results = await sendBg<UploadFileResult[]>({ type: "gitlab.uploadFiles", projectId: at.projectId, files: [entry(file, dataUrl)] });
    return { platform: "gitlab", href: uploadedFrom(results, file.id).href };
  });
  await bodyStage(ctx, { format: "markdown", read, value: hrefOf,
    write: async (description) => { await sendBg({ type: "gitlab.updateIssueDescription", ...at, description }); return description; } });
};

const clickup: Adapter = async (ctx) => {
  const { taskId } = dest<"clickup">(ctx).locator;
  const fetchTask = () => sendBg<{ markdown: string; attachments: Array<{ id: string; url?: string }> }>({ type: "clickup.getTaskAttachments", taskId });
  await probe(fetchTask);
  await uploadStage(ctx, filesAt(ctx, "upload"), async (file, dataUrl) => {
    const results = await sendBg<UploadFileResult[]>({ type: "clickup.uploadFile", taskId, files: [entry(file, dataUrl)] });
    return { platform: "clickup", href: uploadedFrom(results, file.id).href };
  });
  await bodyStage(ctx, { format: "markdown", read: async () => (await fetchTask()).markdown, value: hrefOf,
    write: async (markdownContent) => { await sendBg({ type: "clickup.updateTaskMarkdown", taskId, markdownContent }); return markdownContent; } });
};

const asana: Adapter = async (ctx) => {
  const { taskGid } = dest<"asana">(ctx).locator;
  const fetchTask = () => sendBg<{ htmlNotes: string; attachments: Array<{ gid: string; name: string }> }>({ type: "asana.getTaskAttachments", taskGid });
  const task = await probe(fetchTask);
  await uploadStage(ctx, reconcileUnknownUploads(ctx, filesAt(ctx, "upload"), task.attachments.map((a) => ({ id: a.gid, name: a.name }))), async (file, dataUrl) => {
    const results = await sendBg<AsanaUploadFileResult[]>({ type: "asana.uploadFiles", parent: taskGid, files: [entry(file, dataUrl)] });
    return { platform: "asana", id: uploadedFrom(results, file.id).gid };
  });
  await bodyStage(ctx, { format: "asana-html", read: async () => (await fetchTask()).htmlNotes,
    value: (cp) => cp.uploaded?.platform === "asana" ? cp.uploaded.id : undefined,
    write: async (htmlNotes) => { await sendBg({ type: "asana.updateTaskNotes", taskGid, htmlNotes }); return htmlNotes; } });
};

const jira: Adapter = async (ctx) => {
  const { issueKey } = dest<"jira">(ctx).locator;
  const fetchIssue = () => sendBg<{ description: JiraAdfDoc | null; attachments: Array<{ id: string; filename: string }> }>({ type: "jira.getIssueAttachments", issueKey });
  const issue = await probe(fetchIssue);
  const fileOf = (id: string) => ctx.meta.files.find((f) => f.id === id)!;
  await uploadStage(ctx, reconcileUnknownUploads(ctx, filesAt(ctx, "upload"), issue.attachments.map((a) => ({ id: a.id, name: a.filename }))), async (file, dataUrl) => {
    const [attachment] = await annotateAttachmentDimensions([{ fileId: file.id, filename: file.filename, dataUrl, ...(file.kind === "user" ? { userAttachment: true } : {}) }]);
    const r = await sendBg<UploadFileResult & { attachmentId?: string; file?: { kind: "media"; mediaId: string } | { kind: "external"; url: string } }>({ type: "jira.uploadAttachment", issueKey, attachment });
    const ok = uploadedFrom([r], file.id);
    if (!ok.attachmentId) throw new UploadRejected({ stage: "upload", code: "invalid-response" });
    return { platform: "jira", id: ok.attachmentId, href: ok.href, ...(ok.file?.kind === "media" ? { mediaId: ok.file.mediaId } : {}) };
  });
  const logs = ctx.meta.files.find((f) => f.kind === "logs");
  const tables = (body: string) => ((JSON.parse(body) as JiraAdfDoc).content ?? []).filter((n) => (n as { type?: string }).type === "table").map(adfNodeKey);
  const restored = new Set(ctx.meta.retry.bodyPlan.replacements.flatMap((r) => { try { return JSON.parse(r.renderTemplate) as string[]; } catch { return []; } }));
  await bodyStage(ctx, { format: "adf",
    // The background puts before-i/after-i into the i-th style table it finds, so a removed or
    // added table would send the snapshot row to the wrong place.
    valid: (body, slotFiles) => {
      if (!slotFiles.some((id) => /^capture:(before|after)-\d+$/.test(id))) return true;
      const planned = tables(body);
      const written = tables(ctx.meta.retry.bodyPlan.lastWritten);
      return planned.length === written.length && planned.every((t, i) => t === written[i] || restored.has(t));
    },
    read: async () => JSON.stringify((await fetchIssue()).description ?? { version: 1, type: "doc", content: [] }),
    value: (cp) => cp.uploaded?.platform === "jira" ? cp.uploaded.mediaId ?? cp.uploaded.href : undefined,
    write: async (body, slotFiles, slotUnits) => {
      const uploads = await Promise.all(slotFiles.map(fileOf).filter((f) => f.kind !== "logs" && f.kind !== "user").map(async (f) => {
        const uploaded = ctx.checkpoint(f.id).uploaded;
        if (uploaded?.platform !== "jira") throw new Error("Missing Jira attachment");
        // A finished member's original may be cleaned up; its first render still carries the size.
        const dataUrl = await ctx.bytes(f.id);
        const [dims] = dataUrl ? await annotateAttachmentDimensions([{ filename: jiraBodyFilename(f), dataUrl }]) : [mediaSize(ctx.meta.retry.bodyPlan.lastWritten, uploaded.mediaId)];
        const size = { ...(dims?.width ? { width: dims.width } : {}), ...(dims?.height ? { height: dims.height } : {}) };
        return { filename: jiraBodyFilename(f), file: uploaded.mediaId ? { kind: "media" as const, mediaId: uploaded.mediaId, ...size } : { kind: "external" as const, url: uploaded.href, ...size } };
      }));
      const logsCp = logs && ctx.checkpoint(logs.id);
      // A finished logs link travels along so a restored logs slot renders linked, never "dropped".
      const logsUrl = logsCp?.upload === "done" && logsCp.uploaded?.platform === "jira" ? logsCp.uploaded.href : undefined;
      const written = await sendBg<{ description?: JiraAdfDoc }>({ type: "jira.updateIssueDescription", issueKey, description: JSON.parse(body) as JiraAdfDoc, bodyLocale: ctx.meta.retry.bodyLocale, uploads, ...(logsUrl ? { logsUrl } : {}), slots: [...slotUnits] });
      return JSON.stringify(written?.description ?? JSON.parse(body));
    } });
};

function mediaSize(adf: string, mediaId: string | undefined): { width?: number; height?: number } | undefined {
  if (!mediaId) return undefined;
  let found: { width?: number; height?: number } | undefined;
  JSON.parse(adf, (_key, value) => {
    if (value && typeof value === "object" && value.type === "media" && value.attrs?.id === mediaId) found = { width: value.attrs.width, height: value.attrs.height };
    return value;
  });
  return found;
}

const linear: Adapter = async (ctx) => {
  const { issueId } = dest<"linear">(ctx).locator;
  const fetchIssue = () => sendBg<{ description: string; attachments: Array<{ id: string; url: string }> }>({ type: "linear.getIssueAttachments", issueId });
  await probe(fetchIssue);
  await uploadStage(ctx, filesAt(ctx, "upload"), async (file, dataUrl) => {
    const r = await sendBg<{ assetUrl?: string; fileId?: string }>({ type: "linear.uploadFile", fileId: file.id, filename: file.filename, contentType: file.contentType, dataUrl });
    if (!r?.assetUrl || r.fileId !== file.id) throw new UploadRejected({ stage: "upload", code: "invalid-response" });
    return { platform: "linear", href: r.assetUrl };
  });
  const linkable = ctx.meta.files.filter((f) => { const cp = ctx.checkpoint(f.id); return cp.upload === "done" && !isDone(cp.link) && !fileFinished("linear", f, cp); });
  if (linkable.length) {
    const linked = (await fetchIssue()).attachments.map((a) => a.url);
    for (const file of linkable) {
      const url = hrefOf(ctx.checkpoint(file.id))!;
      ctx.emit(file.id, "link", "running");
      if (linked.includes(url)) { await ctx.save({ fileId: file.id, link: "done" }); ctx.emit(file.id, "link", "done"); continue; }
      await ctx.save({ fileId: file.id, link: "unknown" });
      const ok = await guarded(ctx, [file.id], "link", async () => {
        const r = await sendBg<{ ok: boolean }>({ type: "linear.createAttachment", issueId, title: file.filename, url });
        if (r?.ok !== true) throw Object.assign(new Error("Linear attachment was not acknowledged"), { status: 200 });
        return true;
      }, (failure) => [{ fileId: file.id, link: failedStageState(failure) }]);
      if (!ok) continue;
      await ctx.save({ fileId: file.id, link: "done" });
      ctx.emit(file.id, "link", "done");
    }
  }
  await bodyStage(ctx, { format: "markdown", read: async () => (await fetchIssue()).description ?? "", value: hrefOf,
    write: async (description) => {
      const r = await sendBg<{ ok: boolean }>({ type: "linear.updateIssueDescription", issueId, description });
      if (r?.ok !== true) throw Object.assign(new Error("Linear update was not acknowledged"), { status: 200 });
      return description;
    } });
};

const NOTION_BATCH = 100;
function notionBlock(file: RecoveryFile, uploadId: string): Record<string, unknown> {
  const fileUpload = { type: "file_upload", file_upload: { id: uploadId } };
  if (file.kind === "capture" || file.kind === "inline") return { object: "block", type: "image", image: fileUpload };
  if (file.kind === "video") return { object: "block", type: "video", video: fileUpload };
  return { object: "block", type: "file", file: { ...fileUpload, name: file.filename } };
}

const notion: Adapter = async (ctx) => {
  const { pageId } = dest<"notion">(ctx).locator;
  await probe(() => sendBg({ type: "notion.getBlockChildren", blockId: pageId }));
  const upload = (file: RecoveryFile, dataUrl: string) => sendBg<{ fileUploadId?: string; fileId?: string; expiresAt?: number | null }>({ type: "notion.uploadFile", fileId: file.id, filename: file.filename, contentType: file.contentType, dataUrl })
    .then((r): UploadedAttachment => {
      if (!r?.fileUploadId || r.fileId !== file.id) throw new UploadRejected({ stage: "upload", code: "invalid-response" });
      return { platform: "notion", id: r.fileUploadId, expiresAt: r.expiresAt ?? null };
    });
  // An unattached upload may expire; only those are sent again, never an attached block.
  const stale: RecoveryFile[] = [];
  for (const file of filesAt(ctx, "link")) {
    const uploaded = ctx.checkpoint(file.id).uploaded;
    if (uploaded?.platform !== "notion") continue;
    if (uploaded.expiresAt !== null && uploaded.expiresAt <= Date.now()) { stale.push(file); continue; }
    try {
      const status = await sendBg<{ status: string }>({ type: "notion.getFileUpload", fileUploadId: uploaded.id });
      if (status?.status !== "uploaded") stale.push(file);
    } catch (error) {
      const { fatal } = classify(error, "upload");
      if (fatal === "remote-missing") stale.push(file);
      else if (fatal) throw new RetryStop(fatal);
    }
  }
  const expired = new Map(stale.map((f) => [f.id, ctx.checkpoint(f.id).uploaded]));
  await uploadStage(ctx, [...filesAt(ctx, "upload"), ...stale], upload);
  // An expired upload whose bytes are gone stays unlinked rather than appending a dead id.
  const linkable = ctx.meta.files.filter((f) => { const cp = ctx.checkpoint(f.id); return cp.upload === "done" && (cp.link === "pending" || cp.link === "failed") && (!expired.has(f.id) || cp.uploaded !== expired.get(f.id)); });
  for (let i = 0; i < linkable.length; i += NOTION_BATCH) {
    const batch = linkable.slice(i, i + NOTION_BATCH);
    const ids = batch.map((f) => f.id);
    for (const id of ids) ctx.emit(id, "link", "running");
    await ctx.save(...ids.map((fileId) => ({ fileId, link: "unknown" as const })));
    const appended = await guarded(ctx, ids, "link", async () => {
      const r = await sendBg<{ blockIds: string[] }>({ type: "notion.appendBlockChildren", blockId: pageId,
        children: batch.map((f) => notionBlock(f, (ctx.checkpoint(f.id).uploaded as { id: string }).id)) });
      if (!Array.isArray(r?.blockIds) || r.blockIds.length !== batch.length) throw new Error("Unconfirmed Notion append");
      return r.blockIds;
    }, (failure) => ids.map((fileId) => ({ fileId, link: failedStageState(failure) })));
    if (!appended) return;
    await ctx.save(...batch.map((f, n) => ({ fileId: f.id, link: "done" as const, linkedId: appended[n] })));
    for (const id of ids) ctx.emit(id, "link", "done");
  }
};

const slack: Adapter = async (ctx) => {
  const { channelId, ts } = dest<"slack">(ctx).locator;
  const granted: Array<{ fileId: string; id: string; title: string }> = [];
  for (const file of filesAt(ctx, "upload")) {
    const dataUrl = await ctx.bytes(file.id);
    if (!dataUrl) { ctx.missing(file.id); continue; }
    ctx.emit(file.id, "upload", "running");
    // Before complete Slack discards an upload, so a fresh grant never duplicates a thread file.
    const discard = () => [{ fileId: file.id, upload: "failed" as const, uploaded: undefined }];
    const allocation = await guarded(ctx, [file.id], "upload", async () => {
      const r = await sendBg<{ fileId: string; uploadUrl: string }>({ type: "slack.requestFileUpload", fileId: file.id, filename: file.filename, length: base64ByteLength(dataUrl) });
      if (!r?.fileId || !r.uploadUrl) throw new Error("Invalid Slack upload allocation");
      return r;
    }, discard);
    if (!allocation) continue;
    await ctx.save({ fileId: file.id, upload: "pending", link: "pending", uploaded: { platform: "slack", id: allocation.fileId } });
    const sent = await guarded(ctx, [file.id], "upload", () => sendBg({ type: "slack.sendFileUpload", fileId: file.id, uploadUrl: allocation.uploadUrl, filename: file.filename, dataUrl }).then(() => true), discard);
    if (!sent) continue;
    await ctx.save({ fileId: file.id, upload: "done" });
    ctx.emit(file.id, "upload", "done");
    granted.push({ fileId: file.id, id: allocation.fileId, title: file.filename });
  }
  if (!granted.length) return;
  const ids = granted.map((g) => g.fileId);
  await ctx.save(...ids.map((fileId) => ({ fileId, link: "unknown" as const })));
  let complete: SlackCompleteResult;
  try {
    complete = await sendBg<SlackCompleteResult>({ type: "slack.completeFileUploads", channelId, threadTs: ts, files: granted.map(({ id, title }) => ({ id, title })) });
  } catch (error) {
    complete = { ok: false, outcome: "ambiguous", failure: safeAttachmentFailure(error, "link") };
  }
  const link = complete.ok ? "done" as const : complete.outcome === "failed" ? "failed" as const : "unknown" as const;
  await ctx.save(...ids.map((fileId) => ({ fileId, link })));
  for (const id of ids) { if (!complete.ok) ctx.failed(id, { ...complete.failure, stage: "link" }); ctx.emit(id, "link", link); }
  if (!complete.ok && complete.outcome === "failed" && (complete.failure.code === "authentication" || complete.failure.code === "permission")) throw new RetryStop(complete.failure.code);
};

export const RETRY_ADAPTERS: Record<RetryPlatform, Adapter> = { github, gitlab, clickup, asana, jira, linear, notion, slack };
