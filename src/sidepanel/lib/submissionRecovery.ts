import { safeAttachmentFailure } from "@/lib/attachment-failure";
import { ISSUES_PERSIST_KEY } from "@/lib/session-keys";
import { sendBg } from "@/lib/bg-client";
import { MissingSubmissionFilesError } from "@/types/attachment";
import type { AttachmentBodyPlan, AttachmentCheckpoint, AttachmentCheckpointPatch, AttachmentResult, CreatedDestination, RecoverySource, RetryPlatform, SubmissionFile, SubmissionRecoveryMeta } from "@/types/attachment";
import type { LocaleMode } from "@/i18n/locales";
import type { NormalizedSubmitResult, PlatformId } from "@/types/platform";
import {
  beginSubmissionRecovery, blobToDataUrl, dataUrlToBlob, checkpointSubmission, checkpointAttachmentRetry, cleanupSubmissionOriginals, initializeAttachmentRetry,
  removeSubmissionRecoveryFiles, deleteSubmissionRecovery, discardPreparedSubmission, discardRejectedSubmission, dismissUnknownSubmission, expireSubmissionRecovery,
  listSubmissionRecoveries, readOriginalRecoverySource, readSubmissionRecovery, getNetworkLog, getConsoleLog, getActionLog,
} from "@/store/blob-db";
import { mergeIssueLists, isIssueSubmitting, withIssueOperationLock, IssueAlreadySubmittedError, persistIssuesMutation, useIssuesStore, type IssueRecord } from "@/store/issues-store";

import { extractInlineRefs, type SectionFilter } from "./resolveInlineImages";
import { supportsConsoleNetworkLog, supportsActionLog } from "./captureLogSupport";
import { zipLogsHtml } from "./zipLogsHtml";
import { loadImage } from "@/sidepanel/capture";
import { resolveDraftStyleElements } from "./resolveDraftStyleElements";
import { initialAttachmentCheckpoints } from "./attachmentCheckpoints";

export interface SubmissionProgress {
  attemptId: string;
  beforeCreate(): Promise<void>;
  created(remote: CreatedDestination): Promise<void>;
  // Adapters await these right after a remote response, before their next remote write.
  fileCheckpoint(...files: AttachmentCheckpointPatch[]): Promise<void>;
  bodyWritten(lastWritten: string, ...files: AttachmentCheckpointPatch[]): Promise<void>;
}
export class SubmissionCreationRejectedError extends Error {
  constructor() {
    super("Destination rejected issue creation");
    this.name = "SubmissionCreationRejectedError";
  }
}

export interface RecoveryOutcome {
  state: "partial" | "unknown";
  storageFailed?: boolean;
  issueId: string;
  attemptId: string;
}
export type RecoverySubmitResult = NormalizedSubmitResult & { recovery?: RecoveryOutcome };
export { MissingSubmissionFilesError } from "@/types/attachment";
export interface SubmissionFileIntent extends Omit<SubmissionFile, "dataUrl"> {
  source?: Extract<RecoverySource, { kind: "original" }>;
  blob?: Blob;
}
export interface PreparedSubmission {
  meta: SubmissionRecoveryMeta;
  files: SubmissionFile[];
}

export async function prepareSubmissionRecovery(input: {
  issue: IssueRecord;
  platform: PlatformId;
  files: SubmissionFileIntent[];
}): Promise<PreparedSubmission> {
  const attemptId = crypto.randomUUID();
  const createdAt = Date.now();
  const intents = input.files.map((file) => ({ ...file }));
  if (new Set(intents.map((f) => f.id)).size !== intents.length) throw new Error("Duplicate submission file ID");
  const blobs = await Promise.all(intents.map((f) => f.source ? readOriginalRecoverySource(f.source) : f.blob ?? null));
  const missing = intents.filter((_, i) => !blobs[i]).map((f) => f.id);
  if (missing.length) throw new MissingSubmissionFilesError(missing);
  const generated = new Map<string, Blob>();
  const files: SubmissionFile[] = [];
  const meta: SubmissionRecoveryMeta = {
    issueId: input.issue.id, attemptId, title: input.issue.title, platform: input.platform,
    createdAt, expiresAt: createdAt + 30 * 24 * 60 * 60 * 1000, updatedAt: createdAt,
    phase: "prepared", files: [], results: [],
  };
  for (let i = 0; i < intents.length; i++) {
    const { id, kind } = intents[i];
    let source = intents[i].source;
    let blob = blobs[i]!;
    if (input.platform === "notion" && kind === "logs") {
      const zip = await zipLogsHtml(intents[i].filename, await blobToDataUrl(blob));
      blob = dataUrlToBlob(zip.dataUrl);
      intents[i].filename = zip.filename;
      source = undefined;
    }
    if (input.platform === "asana" && (kind === "capture" || kind === "inline") && blob.type === "image/webp") {
      const image = await loadImage(await blobToDataUrl(blob));
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context || !canvas.width || !canvas.height) throw new Error("Cannot prepare Asana image");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      blob = dataUrlToBlob(canvas.toDataURL("image/jpeg", 0.92));
      source = undefined;
    }
    const contentType = blob.type || intents[i].contentType;
    const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/webm": "webm" };
    const filename = kind !== "user" && extensions[contentType]
      ? intents[i].filename.replace(/\.[^.]+$/, `.${extensions[contentType]}`) : intents[i].filename;
    const recoverySource = source ?? { kind: "generated" as const, key: `file:${attemptId}:${id}` };
    if (!source) generated.set(recoverySource.key, blob);
    meta.files.push({ id, kind, filename, contentType, source: recoverySource, ...(!source && intents[i].source ? { originalSource: intents[i].source } : {}) });
    files.push({ id, kind, filename, contentType, dataUrl: await blobToDataUrl(blob) });
  }
  await beginSubmissionRecovery(meta, generated);
  return { meta, files };
}

const BODY_FORMAT: Record<RetryPlatform, AttachmentBodyPlan["format"]> = {
  github: "markdown", gitlab: "markdown", linear: "markdown", clickup: "markdown",
  jira: "adf", asana: "asana-html", notion: "notion-blocks", slack: "slack-thread",
};
const IDENTITY_TIMEOUT_MS = 10_000;
// withSubmissionProgress hands the submitted ctx.bodyLocale to the run that owns the progress.
const localeBinders = new WeakMap<SubmissionProgress, (locale: LocaleMode) => void>();

async function lookupAccountIdentity(destination: CreatedDestination): Promise<string | null> {
  if (destination.platform === "webhook") return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      sendBg<{ identity?: unknown }>({ type: `${destination.platform}.getAccountIdentity`, destination }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Identity lookup timed out")), IDENTITY_TIMEOUT_MS); }),
    ]);
    const identity = result?.identity;
    return typeof identity === "string" && JSON.parse(identity)[0] === destination.platform ? identity : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const unknownResults = (meta: SubmissionRecoveryMeta): AttachmentResult[] => meta.files.map((f) => ({
  fileId: f.id, delivery: "unknown", presentation: "failed", failure: { stage: "upload", code: "unknown" },
}));
const completed = (r: AttachmentResult) => r.delivery === "attached" && r.presentation !== "failed" && !r.failure;

async function restoreRecord(meta: SubmissionRecoveryMeta): Promise<void> {
  const current = useIssuesStore.getState().issues.find((i) => i.id === meta.issueId);
  const patch = { submissionRecoveryId: meta.attemptId, updatedAt: Math.max(Date.now(), (current?.updatedAt ?? 0) + 1) };
  if (current?.submissionRecoveryId === meta.attemptId) return;
  await persistIssuesMutation(() => useIssuesStore.setState((s) => ({ issues: current
    ? s.issues.map((i) => i.id === meta.issueId ? { ...i, ...patch } : i)
    : [...s.issues, { id: meta.issueId, title: meta.title, platform: meta.platform, createdAt: meta.createdAt,
        status: "draft", pageUrl: "", draft: { title: meta.title, sections: {} }, snapshot: { before: false, after: false }, ...patch }],
  })));
}

function destinationFields(destination: CreatedDestination): Partial<IssueRecord> {
  switch (destination.platform) {
    case "github": return { githubOwner: destination.locator.owner, githubRepo: destination.locator.repo };
    case "jira": return { jiraSiteId: destination.locator.siteId };
    case "gitlab": return { gitlabProjectId: Number(destination.locator.projectId), gitlabIssueIid: Number(destination.locator.iid) };
    case "linear": return { linearIdentifier: destination.key };
    case "notion": return { notionPageId: destination.locator.pageId };
    case "asana": return { asanaTaskGid: destination.locator.taskGid };
    case "clickup": return { clickupTaskId: destination.locator.taskId };
    default: return {};
  }
}

async function finish(meta: SubmissionRecoveryMeta, patch: Partial<IssueRecord> = {}, reconcile = false): Promise<void> {
  const destination = meta.destination;
  if (!destination) throw new Error("Missing created destination");
  if (!useIssuesStore.getState().issues.some((i) => i.id === meta.issueId)) await restoreRecord(meta);
  const preserveOriginals = destination.platform === "slack";
  const stored = reconcile ? await chrome.storage.local.get(ISSUES_PERSIST_KEY) : {};
  const serialized = stored[ISSUES_PERSIST_KEY];
  const persisted: IssueRecord | undefined = typeof serialized === "string"
    ? JSON.parse(serialized).state?.issues?.find((i: IssueRecord) => i.id === meta.issueId) : undefined;
  const pointer = meta.attemptId;
  const alreadyDurable = persisted?.status === "submitted" && persisted.key === destination.key
    && persisted.url === destination.url && persisted.platform === destination.platform
    && persisted.submissionRecoveryId === pointer;
  if (!alreadyDurable) await useIssuesStore.getState().markSubmittedDurably(meta.issueId, {
    ...destinationFields(destination), ...patch, platform: destination.platform, key: destination.key, url: destination.url,
    submissionRecoveryId: meta.attemptId,
    ...(preserveOriginals ? { slackPreserved: true } : {}),
  }, { preserveOriginals });
  await cleanupSubmissionOriginals(meta.issueId, meta.attemptId);
  if (meta.phase === "complete") {
    await deleteSubmissionRecovery(meta.issueId, meta.attemptId);
    await reconcileMissingJournal(meta.issueId);
  }
}

export async function runSubmissionRecovery(
  prepared: PreparedSubmission,
  submit: (progress: SubmissionProgress) => Promise<NormalizedSubmitResult>,
  patch: () => Partial<IssueRecord> = () => ({}),
): Promise<RecoverySubmitResult> {
  const { issueId, attemptId } = prepared.meta;
  let creationStarted = false;
  let knownDestination: CreatedDestination | undefined;
  const storageFailure = (): RecoverySubmitResult => ({
    key: knownDestination?.key ?? "", url: knownDestination?.url ?? "", attachments: unknownResults(prepared.meta),
    recovery: { state: knownDestination ? "partial" : "unknown", issueId, attemptId, storageFailed: true },
  });
  const platform = prepared.meta.platform;
  let bodyLocale: LocaleMode | undefined;
  let snapshotReady: boolean | undefined;
  let revision = 0;
  const checkpoints = new Map<string, AttachmentCheckpoint>();
  let writes: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const next = writes.then(task);
    writes = next.catch(() => {});
    return next;
  };
  // Retry metadata never blocks the submission itself: once a snapshot write fails, later writes
  // and the identity are skipped, so accountIdentity stays null and auto-retry fails closed.
  let retryDisabled = false;
  // Lazily created on the first hook, which always runs while the journal is still prepared.
  const ensureSnapshot = async (): Promise<boolean> => {
    if (snapshotReady !== undefined) return snapshotReady;
    if (platform === "webhook" || !bodyLocale) return (snapshotReady = false);
    const initial = initialAttachmentCheckpoints(platform, prepared.meta.files);
    try {
      await initializeAttachmentRetry(issueId, attemptId, {
        schemaVersion: 1, accountIdentity: null, bodyLocale, revision: 0, checkpoints: initial,
        bodyPlan: { format: BODY_FORMAT[platform], lastWritten: "", replacements: [] },
      });
    } catch { return (snapshotReady = false); }
    for (const cp of initial) checkpoints.set(cp.fileId, cp);
    return (snapshotReady = true);
  };
  const writeRetry = (patch: { files?: AttachmentCheckpointPatch[]; lastWritten?: string; accountIdentity?: string }) => serial(async () => {
    if (retryDisabled || !(await ensureSnapshot())) return;
    try {
      const merged = (patch.files ?? []).map((file) => {
        const current = checkpoints.get(file.fileId);
        if (!current) throw new Error("Unknown checkpoint file");
        return { ...current, ...file };
      });
      revision = await checkpointAttachmentRetry(issueId, attemptId, revision, {
        checkpoints: merged,
        ...(patch.lastWritten !== undefined ? { lastWritten: patch.lastWritten } : {}),
        ...(patch.accountIdentity !== undefined ? { accountIdentity: patch.accountIdentity } : {}),
      });
      for (const cp of merged) checkpoints.set(cp.fileId, cp);
    } catch { retryDisabled = true; }
  });
  const progress: SubmissionProgress = {
    attemptId,
    beforeCreate: async () => {
      await serial(ensureSnapshot);
      await checkpointSubmission(issueId, attemptId, { phase: "creating", results: [] });
      creationStarted = true;
    },
    created: async (destination) => {
      await checkpointSubmission(issueId, attemptId, { phase: "created", destination, results: [] });
      knownDestination = structuredClone(destination);
    },
    fileCheckpoint: (...files) => writeRetry({ files }),
    bodyWritten: (lastWritten, ...files) => writeRetry({ files, lastWritten }),
  };
  localeBinders.set(progress, (locale) => { bodyLocale ??= locale; });
  let result: NormalizedSubmitResult;
  try {
    result = await submit(progress);
  } catch (error) {
    let current: SubmissionRecoveryMeta | null;
    try { current = await readSubmissionRecovery(issueId); }
    catch (storageError) { if (creationStarted) return storageFailure(); throw storageError; }
    if (!current || current.attemptId !== attemptId) {
      if (creationStarted) return storageFailure();
      throw error;
    }
    if (current.phase === "prepared") {
      await deleteSubmissionRecovery(issueId, attemptId);
      throw error;
    }
    if (!current.destination && error instanceof SubmissionCreationRejectedError) {
      await discardRejectedSubmission(issueId, attemptId);
      throw error;
    }
    if (!current.destination) {
      try {
        if (current.phase === "creating") await checkpointSubmission(issueId, attemptId, { phase: "unknown", results: unknownResults(current) });
        await restoreRecord((await readSubmissionRecovery(issueId))!);
      } catch { return storageFailure(); }
      return { key: "", url: "", attachments: unknownResults(current), recovery: { state: "unknown", issueId, attemptId } };
    }
    result = { key: current.destination.key, url: current.destination.url ?? "", attachments: unknownResults(current), submissionFailure: safeAttachmentFailure(error, "body") };
  }
  let current: SubmissionRecoveryMeta | null;
  try { current = await readSubmissionRecovery(issueId); }
  catch (error) { if (creationStarted) return storageFailure(); throw error; }
  if (result.recorded === false && prepared.meta.platform === "webhook" && !prepared.meta.files.length && current?.attemptId === attemptId && !current.destination) {
    try { await deleteSubmissionRecovery(issueId, attemptId); }
    catch { return storageFailure(); }
    return result;
  }
  if (!current || current.attemptId !== attemptId || !current.destination) throw new Error("Submission adapter did not checkpoint creation");
  // Providers normalize locator evidence; still reject missing/duplicate IDs at this boundary.
  const results = current.files.map((f) => {
    const matches = (result.attachments ?? []).filter((r) => r.fileId === f.id);
    return matches.length === 1 ? { ...matches[0], ...(matches[0].failure ? { presentation: "failed" as const } : {}) } : { fileId: f.id, delivery: "unknown" as const, presentation: "failed" as const, failure: { stage: "upload" as const, code: "invalid-response" as const } };
  });
  const phase = !result.submissionFailure && results.every(completed) ? "complete" : "partial";
  const destination = current.destination;
  const canonical = { ...result, key: destination.key, url: destination.url ?? "", attachments: results };
  try {
    const enriched = !destination.url && result.key === destination.key && result.url ? { ...destination, url: result.url } : destination;
    await writes;
    if (phase === "partial" && snapshotReady && !retryDisabled) {
      const identity = await lookupAccountIdentity(enriched);
      // An unverified identity only blocks automatic retry; the partial result still completes.
      if (identity) await writeRetry({ accountIdentity: identity });
    }
    await checkpointSubmission(issueId, attemptId, { phase, results, destination: enriched, submissionFailure: result.submissionFailure });
    const finalized = (await readSubmissionRecovery(issueId))!;
    canonical.url = finalized.destination?.url ?? "";
    await finish(finalized, patch());
  } catch {
    return { ...canonical, recovery: { state: "partial", issueId, attemptId, storageFailed: true } };
  }
  return { ...canonical, ...(phase === "partial" ? { recovery: { state: "partial" as const, issueId, attemptId } } : {}) };
}

async function reconcileMissingJournal(issueId: string): Promise<void> {
  const current = useIssuesStore.getState().issues.find((issue) => issue.id === issueId);
  if (!current?.submissionRecoveryId) return;
  const stored = await chrome.storage.local.get(ISSUES_PERSIST_KEY);
  const raw = stored[ISSUES_PERSIST_KEY];
  const persisted: IssueRecord | undefined = typeof raw === "string"
    ? JSON.parse(raw).state?.issues?.find((issue: IssueRecord) => issue.id === issueId) : undefined;
  const winner = !persisted ? undefined : persisted.status !== current.status
    ? persisted.status === "submitted" ? persisted : current
    : current.updatedAt >= persisted.updatedAt ? current : persisted;
  await persistIssuesMutation(() => useIssuesStore.setState((s) => ({ issues: winner
    ? s.issues.map((issue) => issue.id === issueId ? { ...winner, submissionRecoveryId: undefined, updatedAt: Math.max(Date.now(), current.updatedAt + 1, winner.updatedAt + 1) } : issue)
    : s.issues.filter((issue) => issue.id !== issueId),
  })));
}

async function notifyRecoveryChange(issueId: string, attemptId: string): Promise<void> {
  const stored = await chrome.storage.local.get(ISSUES_PERSIST_KEY);
  const raw = stored[ISSUES_PERSIST_KEY];
  const persisted: IssueRecord | undefined = typeof raw === "string"
    ? JSON.parse(raw).state?.issues?.find((issue: IssueRecord) => issue.id === issueId) : undefined;
  const current = useIssuesStore.getState().issues.find((issue) => issue.id === issueId);
  if (!persisted || persisted.submissionRecoveryId !== attemptId || current?.submissionRecoveryId !== attemptId) return;
  await persistIssuesMutation(() => useIssuesStore.setState((s) => ({ issues: s.issues.map((issue) => {
    if (issue.id !== issueId || issue.submissionRecoveryId !== attemptId) return issue;
    const winner = mergeIssueLists([persisted], [issue])[0];
    return { ...winner, updatedAt: Math.max(Date.now(), winner.updatedAt + 1) };
  }) })));
}

export async function reconcileSubmissionRecovery(now = Date.now()): Promise<void> {
  const ids = new Set([
    ...(await listSubmissionRecoveries()).map((meta) => meta.issueId),
    ...useIssuesStore.getState().issues.filter((issue) => issue.submissionRecoveryId).map((issue) => issue.id),
  ]);
  for (const issueId of ids) {
    if (isIssueSubmitting(issueId)) continue;
    try {
      await withIssueOperationLock(issueId, async () => {
        let meta = await readSubmissionRecovery(issueId);
        if (!meta) {
          await reconcileMissingJournal(issueId);
          return;
        }
        if (meta.phase === "prepared") {
          await discardPreparedSubmission(meta.issueId, meta.attemptId);
          await reconcileMissingJournal(issueId);
          return;
        }
        if (meta.phase === "creating") {
          await checkpointSubmission(meta.issueId, meta.attemptId, { phase: "unknown", results: unknownResults(meta) });
          meta = (await readSubmissionRecovery(meta.issueId))!;
        }
        if (meta.phase === "created") {
          await checkpointSubmission(meta.issueId, meta.attemptId, { phase: "partial", results: unknownResults(meta) });
          meta = (await readSubmissionRecovery(meta.issueId))!;
        }
        if (meta.phase === "complete" || meta.phase === "partial") await finish(meta, {}, true);
        else await restoreRecord(meta);
        if (meta.phase !== "complete" && !meta.localFilesRemoved && meta.expiresAt <= now) {
          await expireSubmissionRecovery(meta.issueId, meta.attemptId, now);
          await notifyRecoveryChange(meta.issueId, meta.attemptId);
        }
      });
    } catch (error) {
      if (!(error instanceof IssueAlreadySubmittedError)) throw error;
    }
  }
}

export async function deleteSubmissionLocalFiles(issueId: string, attemptId: string): Promise<void> {
  await withIssueOperationLock(issueId, async () => {
    const meta = await readSubmissionRecovery(issueId);
    if (!meta || meta.attemptId !== attemptId) throw new Error("Recovery attempt changed");
    const releaseKnown = meta.phase === "partial" && !!meta.destination;
    if (releaseKnown) await finish(meta, {}, true);
    await removeSubmissionRecoveryFiles(issueId, attemptId);
    if (!releaseKnown) {
      if (!meta.localFilesRemoved) await notifyRecoveryChange(issueId, attemptId);
      return;
    }
    await deleteSubmissionRecovery(issueId, attemptId);
    try {
      await reconcileMissingJournal(issueId);
    } catch (error) {
      // Keep this panel blocked too when the durable pointer clear fails; restart repairs the orphan.
      useIssuesStore.setState((s) => ({ issues: s.issues.map((i) => i.id === issueId
        ? { ...i, submissionRecoveryId: attemptId, updatedAt: Math.max(Date.now(), i.updatedAt + 1) } : i) }));
      throw error;
    }
  });
}

export async function confirmSubmissionNotRegistered(issueId: string, attemptId: string): Promise<void> {
  if (isIssueSubmitting(issueId)) throw new Error("Submission is in flight");
  await withIssueOperationLock(issueId, async () => {
    const meta = await readSubmissionRecovery(issueId);
    if (!meta || meta.attemptId !== attemptId || meta.phase !== "unknown" || meta.destination) throw new Error("Submission is not unknown");
    await dismissUnknownSubmission(issueId, attemptId);
    await persistIssuesMutation(() => useIssuesStore.setState((s) => ({ issues: s.issues.map((i) => i.id === issueId
      ? { ...i, status: "draft", submissionRecoveryId: undefined, updatedAt: Math.max(Date.now(), i.updatedAt + 1) } : i) })));
  });
}

export async function loadSubmissionLogs(issue: IssueRecord, transmitFiles = true) {
  const enabled = transmitFiles && issue.logsAttached !== false;
  const networkKey = enabled && supportsConsoleNetworkLog(issue.captureMode) ? issue.networkLogBlobKey : undefined;
  const consoleKey = enabled && supportsConsoleNetworkLog(issue.captureMode) ? issue.consoleLogBlobKey : undefined;
  const actionKey = enabled && supportsActionLog(issue.captureMode) ? issue.actionLogBlobKey : undefined;
  const [networkLog, consoleLog, actionLog] = await Promise.all([
    networkKey ? getNetworkLog(networkKey) : null,
    consoleKey ? getConsoleLog(consoleKey) : null,
    actionKey ? getActionLog(actionKey) : null,
  ]);
  if ((networkKey && !networkLog) || (consoleKey && !consoleLog) || (actionKey && !actionLog)) throw new MissingSubmissionFilesError(["logs"]);
  return { networkLog, consoleLog, actionLog };
}

export function expectedSubmissionSources(issue: IssueRecord, options: {
  sectionConfig: SectionFilter[];
  attachmentsEnabled?: boolean;
  transmitFiles?: boolean;
}): SubmissionFileIntent[] {
  if (options.transmitFiles === false) return [];
  const files: SubmissionFileIntent[] = [];
  const image = (id: string, filename: string, key: string) => files.push({ id, kind: "capture", filename, contentType: "image/webp", source: { kind: "original", store: "images", key } });
  if (issue.captureMode === "video") files.push({ id: "video", kind: "video", filename: "recording.mp4", contentType: "video/mp4", source: { kind: "original", store: "blobs", key: issue.id } });
  else if (issue.captureMode === "screenshot") image("capture:screenshot", "screenshot.webp", `${issue.id}:before`);
  else if (issue.captureMode !== "freeform") {
    const elements = resolveDraftStyleElements(issue, {
      before: issue.snapshot.before ? `${issue.id}:before` : null,
      after: issue.snapshot.after ? `${issue.id}:after` : null,
      buffered: (issue.bufferedElements ?? []).map((b, i) => ({ before: b.hasBefore ? `${issue.id}:b${i}-before` : null, after: b.hasAfter ? `${issue.id}:b${i}-after` : null })),
    });
    elements.forEach((element, i) => {
      if (element.beforeImage) image(`capture:before-${i}`, `before-${i}.webp`, element.beforeImage);
      if (element.afterImage) image(`capture:after-${i}`, `after-${i}.webp`, element.afterImage);
    });
    if (!elements.length && issue.snapshot.before) image("capture:screenshot", "screenshot.webp", `${issue.id}:before`);
  }
  const markdown = options.sectionConfig.filter((s) => s.enabled && s.renderAs === "paragraph").map((s) => issue.draft.sections[s.id] ?? "").join("\n");
  for (const ref of extractInlineRefs(markdown)) files.push({ id: `inline:${ref}`, kind: "inline", filename: `inline-${ref}.webp`, contentType: "image/webp", source: { kind: "original", store: "inlineImages", key: ref } });
  if (options.attachmentsEnabled !== false) for (const meta of issue.attachments ?? []) files.push({ id: `user:${meta.id}`, kind: "user", filename: meta.filename, contentType: meta.contentType, source: { kind: "original", store: "attachments", key: `${issue.id}:${meta.id}` } });
  return files;
}

export async function assertSubmissionSources(files: SubmissionFileIntent[]): Promise<void> {
  const missing: string[] = [];
  for (const file of files) if (file.source && !await readOriginalRecoverySource(file.source)) missing.push(file.id);
  if (missing.length) throw new MissingSubmissionFilesError(missing);
}

export function withSubmissionProgress<T extends { ctx: { bodyLocale: LocaleMode } }>(input: T, progress: SubmissionProgress, files: SubmissionFile[]): T & { progress: SubmissionProgress; submissionFiles: SubmissionFile[] } {
  localeBinders.get(progress)?.(input.ctx.bodyLocale);
  return { ...input, progress, submissionFiles: files };
}
