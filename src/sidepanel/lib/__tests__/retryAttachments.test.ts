import { mockWebLocks } from "@/test/web-locks";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttachmentBodyPlan, AttachmentCheckpoint, AttachmentResult, CreatedDestination, RecoverySource, SubmissionRecoveryMeta } from "@/types/attachment";
import type { IssueRecord } from "@/store/issues-store";
import type { LocaleMode } from "@/i18n/locales";
import { ISSUES_PERSIST_KEY } from "@/lib/session-keys";

// Retry acts on an existing remote issue. Every assertion is on the outgoing messages and the final
// journal/result — never on an intermediate state inside a callback the runner may catch.
const sendBg = vi.hoisted(() => vi.fn());
vi.mock("@/lib/bg-client", () => ({ sendBg }));
// Browser image decoding stand-in: undefined = no dims (the real node behaviour).
const decoded = vi.hoisted(() => ({ dims: undefined as undefined | { width: number; height: number } }));
vi.mock("../attachmentDimensions", () => ({
  annotateAttachmentDimensions: async (atts: Array<Record<string, unknown>>) => atts.map((a) => decoded.dims ? { ...a, ...decoded.dims } : a),
}));

let runner: typeof import("../retryAttachments");
let patch: typeof import("../attachmentBodyPatch");
let db: typeof import("@/store/blob-db");
let store: typeof import("@/store/issues-store");
let persisted: Record<string, unknown>;

beforeEach(async () => {
  vi.resetModules();
  mockWebLocks();
  sendBg.mockReset();
  decoded.dims = undefined;
  vi.stubGlobal("FileReader", class {
    result = ""; onload = () => {};
    readAsDataURL(blob: Blob) { void blob.arrayBuffer().then((bytes) => { this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString("base64")}`; this.onload(); }); }
  });
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  persisted = {};
  vi.stubGlobal("chrome", {
    storage: {
      local: { get: vi.fn(async () => ({ ...persisted })), set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(persisted, values); }) },
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
    },
    runtime: { sendMessage: vi.fn(), getManifest: () => ({ version: "1" }) },
  });
  db = await import("@/store/blob-db");
  store = await import("@/store/issues-store");
  patch = await import("../attachmentBodyPatch");
  runner = await import("../retryAttachments");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

type SeedFile = { id: string; kind: SubmissionRecoveryMeta["files"][number]["kind"]; filename: string; contentType: string; bytes?: string; original?: Extract<RecoverySource, { kind: "original" }> };
const GITHUB: CreatedDestination = { platform: "github", key: "#7", url: "https://github.com/o/r/issues/7", locator: { owner: "o", repo: "r", number: "7" } };
const IDENTITY = '["github","42"]';
const capture: SeedFile = { id: "capture:screenshot", kind: "capture", filename: "screenshot.webp", contentType: "image/webp", bytes: "capture-bytes" };
const logs: SeedFile = { id: "logs", kind: "logs", filename: "logs.html", contentType: "text/html", bytes: "<html>logs</html>" };
const video: SeedFile = { id: "video", kind: "video", filename: "recording.mp4", contentType: "video/mp4", bytes: "mp4-bytes" };
const userPdf: SeedFile = { id: "user:pdf", kind: "user", filename: "spec.pdf", contentType: "application/pdf", bytes: "pdf-bytes" };

const cp = (fileId: string, value: Partial<AttachmentCheckpoint> = {}): AttachmentCheckpoint => ({ fileId, upload: "failed", link: "not-applicable", body: "pending", ...value });
const done = (fileId: string, href: string, value: Partial<AttachmentCheckpoint> = {}): AttachmentCheckpoint => cp(fileId, { upload: "done", body: "done", uploaded: { platform: "github", href }, ...value });
const result = (c: AttachmentCheckpoint): AttachmentResult => c.upload === "done" && c.body !== "pending" && c.body !== "failed" && c.link !== "failed" && c.link !== "pending"
  ? { fileId: c.fileId, delivery: "attached", presentation: "complete" }
  : { fileId: c.fileId, delivery: "failed", presentation: "failed", failure: { stage: "upload", code: "unknown" } };

// Markdown body of a GitHub-like issue: one line per file, a successful file links its URL.
const HREF: Record<string, string> = {
  "capture:screenshot": "https://github.com/user-attachments/files/1/screenshot.webp",
  logs: "https://github.com/user-attachments/files/2/logs.html",
  video: "https://github.com/user-attachments/files/3/recording.mp4",
  "user:pdf": "https://github.com/user-attachments/files/4/spec.pdf",
};
function ghBody(urls: Record<string, string | undefined>): string {
  return [
    "## Environment", "- Page: https://example.com", "",
    "## Media", urls["capture:screenshot"] ? `![screenshot.webp](${urls["capture:screenshot"]})` : "(capture dropped)", "",
    "## Video", urls.video ?? "(video dropped)", "",
    "## Logs", urls.logs ? `[logs.html](${urls.logs})` : "(logs dropped)", "",
    "## Attachments", urls["user:pdf"] ? `[spec.pdf](${urls["user:pdf"]})` : "(spec.pdf dropped)", "",
    "---", "Reported via BugShot",
  ].join("\n");
}
function ghPlan(initial: Record<string, string | undefined>, pending: string[]): AttachmentBodyPlan {
  const lastWritten = ghBody(initial);
  const replacements = patch.buildBodyReplacements({
    format: "markdown", base: lastWritten, pending,
    render: (success) => ghBody({ ...initial, ...Object.fromEntries([...success].map((id) => [id, patch.bodySlotToken(id)])) }),
  });
  return { format: "markdown", lastWritten, replacements };
}

async function seed(o: {
  destination?: CreatedDestination;
  files: SeedFile[];
  checkpoints?: AttachmentCheckpoint[];
  bodyPlan?: AttachmentBodyPlan;
  identity?: string | null;
  bodyLocale?: LocaleMode;
  noSnapshot?: boolean;
  submittedAt?: number;
  results?: AttachmentResult[];
}): Promise<void> {
  const destination = o.destination ?? GITHUB;
  const platform = destination.platform;
  const generated = new Map<string, Blob>();
  const files = o.files.map((f) => {
    if (f.original) return { id: f.id, kind: f.kind, filename: f.filename, contentType: f.contentType, source: f.original };
    const key = `file:a:${f.id}`;
    generated.set(key, new Blob([f.bytes ?? f.id], { type: f.contentType }));
    return { id: f.id, kind: f.kind, filename: f.filename, contentType: f.contentType, source: { kind: "generated" as const, key } };
  });
  const meta: SubmissionRecoveryMeta = { attemptId: "a", issueId: "i", title: "Report", platform, createdAt: 1, expiresAt: Date.now() + 86_400_000, updatedAt: 1, phase: "prepared", files, results: [] };
  await db.beginSubmissionRecovery(meta, generated);
  const checkpoints = o.checkpoints ?? o.files.map((f) => cp(f.id));
  if (!o.noSnapshot) {
    await db.initializeAttachmentRetry("i", "a", {
      schemaVersion: 1, accountIdentity: null, bodyLocale: o.bodyLocale ?? "en", revision: 0, checkpoints,
      bodyPlan: o.bodyPlan ?? { format: "markdown", lastWritten: "", replacements: [] },
    });
  }
  await db.checkpointSubmission("i", "a", { phase: "creating", results: [] });
  await db.checkpointSubmission("i", "a", { phase: "created", destination, results: [] });
  if (!o.noSnapshot && o.identity !== null) await db.checkpointAttachmentRetry("i", "a", 0, { accountIdentity: o.identity ?? IDENTITY });
  await db.checkpointSubmission("i", "a", { phase: "partial", destination, results: o.results ?? checkpoints.map(result) });
  const record: IssueRecord = { id: "i", title: "Report", platform, status: "submitted", key: destination.key, url: destination.url, createdAt: 1, updatedAt: 2, pageUrl: "", draft: { title: "", sections: {} }, snapshot: { before: false, after: false }, submissionRecoveryId: "a", ...(o.submittedAt ? { submittedAt: o.submittedAt } : {}) };
  store.useIssuesStore.setState({ issues: [record] });
  persisted[ISSUES_PERSIST_KEY] = JSON.stringify({ state: { issues: [record] }, version: 0 });
}

type Handler = (msg: any) => unknown;
function rpc(handlers: Record<string, Handler>) {
  sendBg.mockImplementation(async (msg) => {
    const handler = handlers[msg.type];
    if (!handler) throw new Error(`unexpected ${msg.type}`);
    return handler(msg);
  });
}
const sent = (type: string) => sendBg.mock.calls.map(([m]) => m).filter((m) => m.type === type);
const types = () => sendBg.mock.calls.map(([m]) => m.type as string);
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status, body: {} });

function github(remote: { body: string }, extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "github.getAccountIdentity": () => ({ identity: IDENTITY }),
    "github.getIssueBody": () => ({ body: remote.body }),
    "github.updateIssueBody": (msg) => { remote.body = msg.body; return { ok: true }; },
    "github.uploadFiles": (msg) => msg.files.map((f: any) => ({ fileId: f.fileId, filename: f.filename, ok: true, href: HREF[f.fileId] })),
    ...extra,
  };
}
const CREATE_TYPES = /\.(submitIssue|submitPage|createIssue|postMessage)$/;

describe("retryAttachments — GitHub stage resume", () => {
  it("uploads only the failed file, patches the body once, never creates and finalizes durably", async () => {
    const plan = ghPlan({ logs: HREF.logs }, [capture.id]);
    await seed({ files: [capture, logs], checkpoints: [cp(capture.id), done(logs.id, HREF.logs)], bodyPlan: plan });
    const remote = { body: plan.lastWritten };
    rpc(github(remote));
    const events: string[] = [];
    const outcome = await runner.retryAttachments("i", { onProgress: (e) => events.push(`${e.fileId}:${e.stage}:${e.state}`) });

    expect(outcome.status).toBe("complete");
    expect(sent("github.uploadFiles")).toHaveLength(1);
    expect(sent("github.uploadFiles")[0].files.map((f: any) => f.fileId)).toEqual([capture.id]);
    expect(sent("github.uploadFiles")[0].files[0].dataUrl).toBe(`data:image/webp;base64,${Buffer.from("capture-bytes").toString("base64")}`);
    expect(sent("github.updateIssueBody")).toHaveLength(1);
    expect(remote.body).toBe(ghBody({ "capture:screenshot": HREF["capture:screenshot"], logs: HREF.logs }));
    expect(types().filter((t) => CREATE_TYPES.test(t))).toEqual([]);
    expect(await db.readSubmissionRecovery("i")).toBeNull();
    expect(store.useIssuesStore.getState().issues[0]).toMatchObject({ status: "submitted", key: "#7" });
    expect(store.useIssuesStore.getState().issues[0].submissionRecoveryId).toBeUndefined();
    expect(events).toContain(`${capture.id}:upload:done`);
    expect(events).toContain(`${capture.id}:body:done`);
  });

  it("never leaves a file waiting on its slot group reported as running", async () => {
    const grouped = (success: ReadonlySet<string>) => ["intro", ...(success.size ? ["## Attachments", ...[...success].sort().map((id) => `- ${patch.bodySlotToken(id)}`)] : ["(none)"]), "outro"].join("\n");
    const lastWritten = grouped(new Set());
    const bodyPlan: AttachmentBodyPlan = { format: "markdown", lastWritten, replacements: patch.buildBodyReplacements({ format: "markdown", base: lastWritten, pending: [logs.id, userPdf.id], render: grouped }) };
    await seed({ files: [logs, userPdf], checkpoints: [cp(logs.id, { upload: "done", body: "failed", uploaded: { platform: "github", href: HREF.logs } }), cp(userPdf.id)], bodyPlan });
    const rejectPdf: Handler = (msg) => msg.files.map((f: any) => ({ fileId: f.fileId, filename: f.filename, ok: false, failure: { stage: "upload", code: "size-limit", httpStatus: 413 } }));
    rpc(github({ body: lastWritten }, { "github.uploadFiles": rejectPdf }));
    const events: string[] = [];
    await runner.retryAttachments("i", { onProgress: (e) => events.push(`${e.fileId}:${e.stage}:${e.state}`) });
    expect(sent("github.updateIssueBody")).toHaveLength(0);
    expect(events.filter((e) => e.startsWith(`${logs.id}:body:`))).toEqual([]);
  });

  it("an uploaded file whose body write failed is not uploaded again — one body update only", async () => {
    const plan = ghPlan({}, [capture.id]);
    await seed({ files: [capture], checkpoints: [cp(capture.id, { upload: "done", body: "failed", uploaded: { platform: "github", href: HREF[capture.id] } })], bodyPlan: plan });
    rpc(github({ body: plan.lastWritten }));
    const outcome = await runner.retryAttachments("i");
    expect(outcome.status).toBe("complete");
    expect(sent("github.uploadFiles")).toHaveLength(0);
    expect(sent("github.updateIssueBody")).toHaveLength(1);
  });

  it("after a partial re-success the next retry handles only the remaining file", async () => {
    const plan = ghPlan({}, [capture.id, userPdf.id]);
    await seed({ files: [capture, userPdf], bodyPlan: plan });
    const remote = { body: plan.lastWritten };
    const rejectPdf: Handler = (msg) => msg.files.map((f: any) => f.fileId === userPdf.id
      ? { fileId: f.fileId, filename: f.filename, ok: false, failure: { stage: "upload", code: "size-limit", httpStatus: 413 } }
      : { fileId: f.fileId, filename: f.filename, ok: true, href: HREF[f.fileId] });
    rpc(github(remote, { "github.uploadFiles": rejectPdf }));
    const first = await runner.retryAttachments("i");
    expect(first).toMatchObject({ status: "partial", remaining: 1 });
    expect(remote.body).toBe(ghBody({ "capture:screenshot": HREF["capture:screenshot"] }));
    const journal = (await db.readSubmissionRecovery("i"))!;
    expect(journal.retry!.checkpoints.find((c) => c.fileId === capture.id)).toMatchObject({ upload: "done", body: "done" });
    expect(journal.results.find((r) => r.fileId === capture.id)).toMatchObject({ delivery: "attached", presentation: "complete" });
    expect(journal.results.find((r) => r.fileId === userPdf.id)).toMatchObject({ delivery: "failed", failure: { stage: "upload", code: "size-limit" } });

    sendBg.mockReset();
    rpc(github(remote));
    const second = await runner.retryAttachments("i");
    expect(second.status).toBe("complete");
    expect(sent("github.uploadFiles").flatMap((m) => m.files.map((f: any) => f.fileId))).toEqual([userPdf.id]);
    expect(remote.body).toBe(ghBody({ "capture:screenshot": HREF["capture:screenshot"], "user:pdf": HREF["user:pdf"] }));
  });

  it("keeps remote prose and sends no field other than the body", async () => {
    const plan = ghPlan({}, [logs.id]);
    await seed({ files: [logs], bodyPlan: plan });
    const remote = { body: `Triaged: P1, assigned to @dev\n\n${plan.lastWritten}\n\nFollow-up from QA` };
    rpc(github(remote));
    expect((await runner.retryAttachments("i")).status).toBe("complete");
    const update = sent("github.updateIssueBody")[0];
    expect(Object.keys(update).sort()).toEqual(["body", "number", "owner", "repo", "type"]);
    expect(update).toMatchObject({ owner: "o", repo: "r", number: 7 });
    expect(remote.body).toBe(`Triaged: P1, assigned to @dev\n\n${ghBody({ logs: HREF.logs })}\n\nFollow-up from QA`);
  });

  it("an edited attachment slot is a body conflict: zero body writes and the upload is kept", async () => {
    const plan = ghPlan({}, [logs.id]);
    await seed({ files: [logs], bodyPlan: plan });
    rpc(github({ body: plan.lastWritten.replace("(logs dropped)", "logs are in the Slack thread") }));
    const outcome = await runner.retryAttachments("i");
    expect(outcome).toMatchObject({ status: "partial", reason: "body-conflict", remaining: 1 });
    expect(sent("github.uploadFiles")).toHaveLength(1);
    expect(sent("github.updateIssueBody")).toHaveLength(0);
    const journal = (await db.readSubmissionRecovery("i"))!;
    expect(journal.retry!.checkpoints[0]).toMatchObject({ upload: "done", body: "conflict", uploaded: { platform: "github", href: HREF.logs } });
    expect(journal.results[0]).toMatchObject({ delivery: "attached", presentation: "failed", failure: { stage: "body" } });
  });

  it("a record without a recorded slot is never guessed: no upload, no body write", async () => {
    await seed({ files: [logs], bodyPlan: { format: "markdown", lastWritten: ghBody({}), replacements: [] } });
    rpc(github({ body: ghBody({}) }));
    const outcome = await runner.retryAttachments("i");
    expect(outcome).toMatchObject({ status: "blocked", reason: "legacy" });
    expect(sendBg).not.toHaveBeenCalled();
  });

  it("a remote edit made while the retry runs is preserved by the write", async () => {
    const plan = ghPlan({}, [logs.id]);
    await seed({ files: [logs], bodyPlan: plan });
    const remote = { body: plan.lastWritten };
    let reads = 0;
    rpc(github(remote, { "github.getIssueBody": () => ({ body: ++reads === 2 ? `Edited meanwhile\n${remote.body}` : reads > 2 ? `Edited meanwhile\n${remote.body}` : remote.body }) }));
    expect((await runner.retryAttachments("i")).status).toBe("complete");
    expect(sent("github.updateIssueBody")[0].body).toBe(`Edited meanwhile\n${ghBody({ logs: HREF.logs })}`);
  });

  it("a body that keeps changing between reads is a conflict, not a blind write", async () => {
    const plan = ghPlan({}, [logs.id]);
    await seed({ files: [logs], bodyPlan: plan });
    let reads = 0;
    rpc(github({ body: plan.lastWritten }, { "github.getIssueBody": () => ({ body: `${plan.lastWritten}\nedit ${++reads}` }) }));
    expect(await runner.retryAttachments("i")).toMatchObject({ status: "partial", reason: "body-conflict" });
    expect(sent("github.updateIssueBody")).toHaveLength(0);
  });

  it("a lost body response is reconciled by reading, not replayed", async () => {
    const plan = ghPlan({}, [logs.id]);
    await seed({ files: [logs], checkpoints: [cp(logs.id, { upload: "done", body: "unknown", uploaded: { platform: "github", href: HREF.logs } })], bodyPlan: plan });
    rpc(github({ body: ghBody({ logs: HREF.logs }) }));
    expect((await runner.retryAttachments("i")).status).toBe("complete");
    expect(sent("github.updateIssueBody")).toHaveLength(0);
    expect(sent("github.uploadFiles")).toHaveLength(0);
  });

  it("a 120s video and logs.html each go in their own upload message", async () => {
    const plan = ghPlan({}, [video.id, logs.id]);
    await seed({ files: [video, logs], bodyPlan: plan });
    rpc(github({ body: plan.lastWritten }));
    expect((await runner.retryAttachments("i")).status).toBe("complete");
    const uploads = sent("github.uploadFiles");
    expect(uploads).toHaveLength(2);
    expect(uploads.every((m) => m.files.length === 1)).toBe(true);
  });

  it("a preserved blob that went missing is local-missing with zero upload requests", async () => {
    await db.saveAttachmentBlob("i", "pdf", new Blob(["pdf"], { type: "application/pdf" }));
    const pdf = { ...userPdf, original: { kind: "original" as const, store: "attachments" as const, key: "i:pdf" } };
    const plan = ghPlan({}, [userPdf.id]);
    await seed({ files: [pdf], bodyPlan: plan });
    // Browser storage cleared under us; the normal delete API would protect the journal's key.
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("bugshot-video");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction("attachments", "readwrite");
        tx.objectStore("attachments").delete("i:pdf");
        tx.oncomplete = () => { open.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
    rpc(github({ body: plan.lastWritten }));
    const outcome = await runner.retryAttachments("i");
    expect(outcome).toMatchObject({ status: "partial", reason: "local-missing" });
    expect(sent("github.uploadFiles")).toHaveLength(0);
    expect((await db.readSubmissionRecovery("i"))!.results[0]).toMatchObject({ delivery: "failed", failure: { stage: "source", code: "local-storage" } });
  });

  it("deletes preserved originals only after the durable submitted write succeeds", async () => {
    await db.saveAttachmentBlob("i", "pdf", new Blob(["pdf"], { type: "application/pdf" }));
    const pdf = { ...userPdf, original: { kind: "original" as const, store: "attachments" as const, key: "i:pdf" } };
    const plan = ghPlan({}, [userPdf.id]);
    await seed({ files: [pdf], bodyPlan: plan });
    rpc(github({ body: plan.lastWritten }));
    vi.mocked(chrome.storage.local.set).mockRejectedValue(new Error("quota"));
    const failed = await runner.retryAttachments("i");
    expect(failed.storageFailed).toBe(true);
    expect(await db.getAttachmentBlob("i", "pdf")).not.toBeNull();
    expect(await db.readSubmissionRecovery("i")).not.toBeNull();
  });
});

describe("retryAttachments — exclusivity and stops", () => {
  it("two concurrent retries run once: the second is busy and writes nothing", async () => {
    const plan = ghPlan({}, [logs.id]);
    await seed({ files: [logs], bodyPlan: plan });
    rpc(github({ body: plan.lastWritten }));
    const [a, b] = await Promise.all([runner.retryAttachments("i"), runner.retryAttachments("i")]);
    expect([a.status, b.status].sort()).toEqual(["busy", "complete"]);
    expect(sent("github.uploadFiles")).toHaveLength(1);
    expect(sent("github.updateIssueBody")).toHaveLength(1);
  });

  it("reports running only while it holds the issue", async () => {
    const plan = ghPlan({}, [logs.id]);
    await seed({ files: [logs], bodyPlan: plan });
    const seen: boolean[] = [];
    rpc(github({ body: plan.lastWritten }, { "github.getAccountIdentity": () => { seen.push(runner.isAttachmentRetryRunning("i")); return { identity: IDENTITY }; } }));
    await runner.retryAttachments("i");
    expect(seen).toEqual([true]);
    expect(runner.isAttachmentRetryRunning("i")).toBe(false);
  });

  it("a different connected account stops before any remote read or write", async () => {
    const plan = ghPlan({}, [logs.id]);
    await seed({ files: [logs], bodyPlan: plan });
    rpc(github({ body: plan.lastWritten }, { "github.getAccountIdentity": () => ({ identity: '["github","99"]' }) }));
    const outcome = await runner.retryAttachments("i");
    expect(outcome).toMatchObject({ status: "blocked", reason: "account-changed" });
    expect(types()).toEqual(["github.getAccountIdentity"]);
    expect((await db.readSubmissionRecovery("i"))!.retry!.checkpoints[0].upload).toBe("failed");
  });

  it.each([[404, "remote-missing"], [403, "permission"], [401, "authentication"]] as const)("a %i on the existing issue stops as %s without creating or uploading", async (status, reason) => {
    const plan = ghPlan({}, [logs.id]);
    await seed({ files: [logs], bodyPlan: plan });
    rpc(github({ body: "" }, { "github.getIssueBody": () => { throw httpError(status); } }));
    const outcome = await runner.retryAttachments("i");
    expect(outcome).toMatchObject({ status: "blocked", reason });
    expect(sent("github.uploadFiles")).toHaveLength(0);
    expect(types().filter((t) => CREATE_TYPES.test(t))).toEqual([]);
    expect(await db.readRecoveryFile((await db.readSubmissionRecovery("i"))!, logs.id)).not.toBeNull();
  });

  it.each([
    ["legacy", { noSnapshot: true }],
    ["account-unverified", { identity: null }],
  ] as const)("a %s record is blocked without any message", async (reason, extra) => {
    await seed({ files: [logs], ...extra });
    rpc({});
    expect(await runner.retryAttachments("i")).toMatchObject({ status: "blocked", reason });
    expect(sendBg).not.toHaveBeenCalled();
  });
});

describe("retryAttachments — whole-submission failure", () => {
  it("finishes the files but never completes a record with a submission failure, then hides retry", async () => {
    const plan = ghPlan({}, [logs.id]);
    await seed({ files: [logs], bodyPlan: plan });
    const journal = (await db.readSubmissionRecovery("i"))!;
    await db.checkpointSubmission("i", "a", { phase: "partial", destination: journal.destination, results: journal.results, submissionFailure: { stage: "body", code: "unknown" } });
    rpc(github({ body: plan.lastWritten }));
    expect(await runner.retryAttachments("i")).toMatchObject({ status: "partial", reason: "ambiguous", remaining: 0 });
    const after = (await db.readSubmissionRecovery("i"))!;
    expect(after.submissionFailure).toEqual({ stage: "body", code: "unknown" });
    expect(after.results[0]).toMatchObject({ delivery: "attached", presentation: "complete" });
    expect(runner.attachmentRetryBlocker(after)).toBe("ambiguous");
  });
});

describe("retryAttachments — create-first and staged providers", () => {
  const JIRA: CreatedDestination = { platform: "jira", key: "BUG-1", url: "https://acme.atlassian.net/browse/BUG-1", locator: { issueKey: "BUG-1", siteId: "cloud" } };
  const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

  it("Jira sends the snapshot body language, not the current setting, and only our slot's upload", async () => {
    const { useSettingsUiStore } = await import("@/store/settings-ui-store");
    useSettingsUiStore.getState().setBodyLocale("en");
    const template = { version: 1, type: "doc", content: [para("Environment"), para("__BUGSHOT_IMAGE__"), para("Footer")] };
    const written = { version: 1, type: "doc", content: [para("Environment"), para("첨부 누락"), para("Footer")] };
    const bodyPlan: AttachmentBodyPlan = { format: "adf", lastWritten: JSON.stringify(written), replacements: patch.buildAdfBodyReplacements({ written, template, slots: [{ index: 1, fileIds: [capture.id] }] }) };
    await seed({ destination: JIRA, bodyLocale: "ko", identity: '["jira","cloud","acc"]', files: [capture],
      checkpoints: [cp(capture.id, { upload: "done", body: "failed", uploaded: { platform: "jira", id: "10", href: "https://acme.atlassian.net/secure/attachment/10/screenshot.webp", mediaId: "m-1" } })], bodyPlan });
    rpc({
      "jira.getAccountIdentity": () => ({ identity: '["jira","cloud","acc"]' }),
      "jira.getIssueAttachments": () => ({ description: written, attachments: [{ id: "10", filename: "screenshot.webp" }] }),
      "jira.updateIssueDescription": (msg) => ({ ok: true, description: msg.description }),
    });
    expect((await runner.retryAttachments("i")).status).toBe("complete");
    expect(sent("jira.uploadAttachment")).toHaveLength(0);
    const update = sent("jira.updateIssueDescription")[0];
    expect(update.bodyLocale).toBe("ko");
    expect(update.issueKey).toBe("BUG-1");
    expect(update.uploads).toEqual([{ filename: "screenshot.webp", file: { kind: "media", mediaId: "m-1" } }]);
    expect(update.description.content[1]).toEqual(para("__BUGSHOT_IMAGE__"));
    expect(update.relates).toBeUndefined();
  });

  it.each([
    ["an added table", (t: (l: string) => unknown) => [para("Notes"), t("user table")], [] as unknown[]],
    ["a replaced table", (t: (l: string) => unknown) => [para("Notes"), t("edited elsewhere")], ["second"]],
  ])("Jira refuses a snapshot-row slot once the style tables no longer line up (%s)", async (_, tail, writtenTail) => {
    const table = (label: string) => ({ type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [para(label)] }] }] });
    const template = { version: 1, type: "doc", content: [para("Environment"), table("styles"), para("Footer"), ...(writtenTail.length ? [para("Notes"), table("second")] : [])] };
    const written = template;
    const bodyPlan: AttachmentBodyPlan = { format: "adf", lastWritten: JSON.stringify(written), replacements: patch.buildAdfBodyReplacements({ written, template, slots: [{ index: 1, fileIds: ["capture:before-0", "capture:after-0"] }] }) };
    const shot = (side: string): SeedFile => ({ id: `capture:${side}-0`, kind: "capture", filename: `${side}-0.webp`, contentType: "image/webp" });
    const uploaded = (side: string) => cp(`capture:${side}-0`, { upload: "done", body: "failed", uploaded: { platform: "jira", id: side, href: `https://acme.atlassian.net/secure/attachment/1/${side}`, mediaId: `m-${side}` } });
    await seed({ destination: JIRA, identity: '["jira","cloud","acc"]', files: [shot("before"), shot("after")], checkpoints: [uploaded("before"), uploaded("after")], bodyPlan });
    const remote = { ...written, content: [...written.content.slice(0, 3), ...tail(table)] };
    rpc({
      "jira.getAccountIdentity": () => ({ identity: '["jira","cloud","acc"]' }),
      "jira.getIssueAttachments": () => ({ description: remote, attachments: [] }),
      "jira.updateIssueDescription": (msg) => ({ ok: true, description: msg.description }),
    });
    expect(await runner.retryAttachments("i")).toMatchObject({ status: "partial", reason: "body-conflict" });
    expect(sent("jira.updateIssueDescription")).toHaveLength(0);
  });

  it.each([
    ["present", [{ id: "11", filename: "spec.pdf" }], 0, "ambiguous"],
    ["absent", [], 1, undefined],
  ] as const)("a lost Jira upload is reconciled against the attachment list first (%s)", async (_, attachments, uploads, reason) => {
    await seed({ destination: JIRA, identity: '["jira","cloud","acc"]', files: [userPdf], checkpoints: [cp(userPdf.id, { upload: "unknown", body: "not-applicable" })] });
    rpc({
      "jira.getAccountIdentity": () => ({ identity: '["jira","cloud","acc"]' }),
      "jira.getIssueAttachments": () => ({ description: null, attachments }),
      "jira.uploadAttachment": (msg) => ({ fileId: msg.attachment.fileId, filename: msg.attachment.filename, ok: true, attachmentId: "12", href: "https://acme.atlassian.net/secure/attachment/12/spec.pdf", file: { kind: "external", url: "u" } }),
    });
    const outcome = await runner.retryAttachments("i");
    expect(sent("jira.uploadAttachment")).toHaveLength(uploads);
    if (uploads) {
      expect(sent("jira.uploadAttachment")[0].attachment).toMatchObject({ fileId: userPdf.id, filename: "spec.pdf", userAttachment: true });
      expect(outcome.status).toBe("complete");
    } else expect(outcome).toMatchObject({ status: "partial", reason });
  });

  it("Linear links the stored asset URL once without uploading again", async () => {
    const LINEAR: CreatedDestination = { platform: "linear", key: "L-1", url: "https://linear.app/issue/L-1", locator: { issueId: "issue" } };
    await seed({ destination: LINEAR, identity: '["linear","o","u"]', files: [userPdf], checkpoints: [{ fileId: userPdf.id, upload: "done", link: "failed", body: "not-applicable", uploaded: { platform: "linear", href: "https://uploads.linear.app/spec.pdf" } }] });
    rpc({
      "linear.getAccountIdentity": () => ({ identity: '["linear","o","u"]' }),
      "linear.getIssueAttachments": () => ({ description: "", attachments: [] }),
      "linear.createAttachment": () => ({ ok: true }),
    });
    expect((await runner.retryAttachments("i")).status).toBe("complete");
    expect(sent("linear.uploadFile")).toHaveLength(0);
    expect(sent("linear.createAttachment")).toEqual([{ type: "linear.createAttachment", issueId: "issue", title: "spec.pdf", url: "https://uploads.linear.app/spec.pdf" }]);
  });

  const NOTION: CreatedDestination = { platform: "notion", key: "abcd1234", url: "https://notion.so/page-1", locator: { pageId: "page-1" } };
  it("Notion appends the cut-off file to the original page and stores the block id", async () => {
    await seed({ destination: NOTION, identity: '["notion","w","b"]', files: [userPdf], checkpoints: [{ fileId: userPdf.id, upload: "done", link: "pending", body: "not-applicable", uploaded: { platform: "notion", id: "up-1", expiresAt: null } }] });
    rpc({
      "notion.getAccountIdentity": () => ({ identity: '["notion","w","b"]' }),
      "notion.getBlockChildren": () => ({ blocks: [] }),
      "notion.getFileUpload": () => ({ status: "uploaded", expiresAt: null }),
      "notion.appendBlockChildren": (msg) => ({ blockIds: msg.children.map((_: unknown, i: number) => `blk-${i}`) }),
    });
    expect((await runner.retryAttachments("i")).status).toBe("complete");
    expect(sent("notion.uploadFile")).toHaveLength(0);
    const append = sent("notion.appendBlockChildren");
    expect(append).toHaveLength(1);
    expect(append[0].blockId).toBe("page-1");
    expect(append[0].children).toEqual([{ object: "block", type: "file", file: { type: "file_upload", file_upload: { id: "up-1" }, name: "spec.pdf" } }]);
    expect(types().filter((t) => CREATE_TYPES.test(t) || t === "notion.deleteBlock")).toEqual([]);
  });

  it("Notion keeps the recorded outcome of a file this run did not touch", async () => {
    const other = { ...userPdf, id: "user:other", filename: "other.pdf" };
    await seed({ destination: NOTION, identity: '["notion","w","b"]', files: [userPdf, other],
      checkpoints: [
        { fileId: userPdf.id, upload: "done", link: "pending", body: "not-applicable", uploaded: { platform: "notion", id: "up-1", expiresAt: null } },
        { fileId: other.id, upload: "done", link: "unknown", body: "not-applicable", uploaded: { platform: "notion", id: "up-2", expiresAt: null } },
      ],
      results: [
        { fileId: userPdf.id, delivery: "failed", presentation: "failed", failure: { stage: "body", code: "body-limit" } },
        { fileId: other.id, delivery: "failed", presentation: "failed", failure: { stage: "body", code: "body-limit" } },
      ] });
    rpc({
      "notion.getAccountIdentity": () => ({ identity: '["notion","w","b"]' }),
      "notion.getBlockChildren": () => ({ blocks: [] }),
      "notion.getFileUpload": () => ({ status: "uploaded", expiresAt: null }),
      "notion.appendBlockChildren": (msg) => ({ blockIds: msg.children.map((_: unknown, i: number) => `blk-${i}`) }),
    });
    expect(await runner.retryAttachments("i")).toMatchObject({ status: "partial", remaining: 1 });
    const results = (await db.readSubmissionRecovery("i"))!.results;
    expect(results.find((r) => r.fileId === other.id)).toEqual({ fileId: other.id, delivery: "failed", presentation: "failed", failure: { stage: "body", code: "body-limit" } });
    expect(results.find((r) => r.fileId === userPdf.id)).toMatchObject({ delivery: "attached", presentation: "not-applicable" });
  });

  it("Notion does not append an expired upload whose bytes are gone", async () => {
    await db.saveAttachmentBlob("i", "pdf", new Blob(["pdf"], { type: "application/pdf" }));
    const pdf = { ...userPdf, original: { kind: "original" as const, store: "attachments" as const, key: "i:pdf" } };
    await seed({ destination: NOTION, identity: '["notion","w","b"]', files: [pdf], checkpoints: [{ fileId: userPdf.id, upload: "done", link: "pending", body: "not-applicable", uploaded: { platform: "notion", id: "up-old", expiresAt: 1 } }] });
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("bugshot-video");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction("attachments", "readwrite");
        tx.objectStore("attachments").delete("i:pdf");
        tx.oncomplete = () => { open.result.close(); resolve(); };
      };
    });
    rpc({ "notion.getAccountIdentity": () => ({ identity: '["notion","w","b"]' }), "notion.getBlockChildren": () => ({ blocks: [] }) });
    expect(await runner.retryAttachments("i")).toMatchObject({ status: "partial", reason: "local-missing" });
    expect(sent("notion.uploadFile")).toHaveLength(0);
    expect(sent("notion.appendBlockChildren")).toHaveLength(0);
  });

  it("Notion never re-appends a block whose earlier append is unconfirmed", async () => {
    await seed({ destination: NOTION, identity: '["notion","w","b"]', files: [userPdf], checkpoints: [{ fileId: userPdf.id, upload: "done", link: "unknown", body: "not-applicable", uploaded: { platform: "notion", id: "up-1", expiresAt: null } }] });
    rpc({ "notion.getAccountIdentity": () => ({ identity: '["notion","w","b"]' }), "notion.getBlockChildren": () => ({ blocks: [] }) });
    const outcome = await runner.retryAttachments("i");
    expect(outcome).toMatchObject({ status: "blocked", reason: "ambiguous" });
    expect(sendBg).not.toHaveBeenCalled();
  });

  const SLACK: CreatedDestination = { platform: "slack", key: "1.2", url: "https://slack.com/archives/C/p12", locator: { channelId: "C", ts: "1.2" } };
  it("Slack reattaches a failed file in the original thread without posting a message", async () => {
    await seed({ destination: SLACK, identity: '["slack","T","U"]', files: [userPdf], checkpoints: [{ fileId: userPdf.id, upload: "failed", link: "pending", body: "not-applicable" }] });
    rpc({
      "slack.getAccountIdentity": () => ({ identity: '["slack","T","U"]' }),
      "slack.requestFileUpload": () => ({ fileId: "F9", uploadUrl: "https://files.slack.com/upload/v1/x" }),
      "slack.sendFileUpload": () => ({ ok: true }),
      "slack.completeFileUploads": () => ({ ok: true }),
    });
    expect((await runner.retryAttachments("i")).status).toBe("complete");
    expect(sent("slack.sendFileUpload")).toHaveLength(1);
    expect(sent("slack.completeFileUploads")).toEqual([{ type: "slack.completeFileUploads", channelId: "C", threadTs: "1.2", files: [{ id: "F9", title: "spec.pdf" }] }]);
    expect(types().filter((t) => CREATE_TYPES.test(t))).toEqual([]);
  });

  it("Slack never repeats an ambiguous complete", async () => {
    await seed({ destination: SLACK, identity: '["slack","T","U"]', files: [userPdf], checkpoints: [{ fileId: userPdf.id, upload: "done", link: "unknown", body: "not-applicable", uploaded: { platform: "slack", id: "F1" } }] });
    rpc({ "slack.getAccountIdentity": () => ({ identity: '["slack","T","U"]' }) });
    const outcome = await runner.retryAttachments("i");
    expect(outcome).toMatchObject({ status: "blocked", reason: "ambiguous" });
    expect(sendBg).not.toHaveBeenCalled();
  });
});


describe("retryAttachments — fix round 1", () => {
  const JIRA: CreatedDestination = { platform: "jira", key: "BUG-1", url: "https://acme.atlassian.net/browse/BUG-1", locator: { issueKey: "BUG-1", siteId: "cloud" } };
  const ASANA: CreatedDestination = { platform: "asana", key: "task", url: "https://app.asana.com/0/0/task", locator: { taskGid: "task" } };
  const GITLAB: CreatedDestination = { platform: "gitlab", key: "#3", url: "https://gitlab.com/o/r/-/issues/3", locator: { projectId: "4", iid: "3" } };
  const CLICKUP: CreatedDestination = { platform: "clickup", key: "task", url: "https://app.clickup.com/t/task", locator: { taskId: "task" } };
  const LINEAR: CreatedDestination = { platform: "linear", key: "L-1", url: "https://linear.app/issue/L-1", locator: { issueId: "issue" } };
  const NOTION: CreatedDestination = { platform: "notion", key: "abcd1234", url: "https://notion.so/page-1", locator: { pageId: "page-1" } };
  const SLACK: CreatedDestination = { platform: "slack", key: "1.2", url: "https://slack.com/archives/C/p12", locator: { channelId: "C", ts: "1.2" } };
  const id = (p: string) => `["${p}","x"]`;
  const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
  const rawDelete = (store: string, key: string) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("bugshot-video");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => { open.result.close(); resolve(); };
    };
  });

  it.each([
    ["jira", "jira.getIssueAttachments", "jira.uploadAttachment"],
    ["asana", "asana.getTaskAttachments", "asana.uploadFiles"],
  ] as const)("%s name reconciliation ignores attachments this submission already owns", async (platform, list, upload) => {
    const shot: SeedFile = { id: "capture:screenshot", kind: "capture", filename: "screenshot.webp", contentType: "image/webp" };
    const own: SeedFile = { id: "user:dup", kind: "user", filename: "screenshot.webp", contentType: "image/webp" };
    const uploaded = platform === "jira" ? { platform: "jira" as const, id: "10", href: "https://acme.atlassian.net/secure/attachment/10/screenshot.webp" } : { platform: "asana" as const, id: "10" };
    await seed({ destination: platform === "jira" ? JIRA : ASANA, identity: id(platform), files: [shot, own], checkpoints: [
      cp(shot.id, { upload: "unknown", body: "not-applicable" }),
      cp(own.id, { upload: "done", body: "not-applicable", uploaded }),
    ] });
    rpc({
      [`${platform}.getAccountIdentity`]: () => ({ identity: id(platform) }),
      [list]: () => platform === "jira" ? { description: null, attachments: [{ id: "10", filename: "screenshot.webp" }] } : { htmlNotes: "", workspaceGid: "w", attachments: [{ gid: "10", name: "screenshot.webp" }] },
      "jira.uploadAttachment": (msg) => ({ fileId: msg.attachment.fileId, filename: msg.attachment.filename, ok: true, attachmentId: "11", href: "https://acme.atlassian.net/secure/attachment/11/screenshot.webp", file: { kind: "external", url: "u" } }),
      "asana.uploadFiles": (msg) => msg.files.map((f: any) => ({ fileId: f.fileId, filename: f.filename, ok: true, gid: "11" })),
    });
    expect((await runner.retryAttachments("i")).status).toBe("complete");
    expect(sent(upload)).toHaveLength(1);
  });

  it("Asana leaves an unknown upload alone when another attachment carries its name", async () => {
    const shot: SeedFile = { id: "capture:screenshot", kind: "capture", filename: "screenshot.jpg", contentType: "image/jpeg" };
    await seed({ destination: ASANA, identity: id("asana"), files: [shot], checkpoints: [cp(shot.id, { upload: "unknown", body: "not-applicable" })] });
    rpc({ "asana.getAccountIdentity": () => ({ identity: id("asana") }), "asana.getTaskAttachments": () => ({ htmlNotes: "", workspaceGid: "w", attachments: [{ gid: "77", name: "screenshot.jpg" }] }) });
    expect(await runner.retryAttachments("i")).toMatchObject({ status: "partial", reason: "ambiguous" });
    expect(sent("asana.uploadFiles")).toHaveLength(0);
  });

  it.each([
    ["gitlab", GITLAB],
    ["jira", JIRA],
  ] as const)("%s: a body that has no recorded slot is legacy — no button, zero messages", async (platform, destination) => {
    const uploaded = platform === "jira" ? { platform: "jira" as const, id: "10", href: "https://acme.atlassian.net/secure/attachment/10/x", mediaId: "m" } : { platform: "gitlab" as const, href: "/uploads/a/screenshot.webp" };
    await seed({ destination, identity: id(platform), files: [capture], checkpoints: [cp(capture.id, { upload: "done", body: "failed", uploaded })], bodyPlan: { format: platform === "jira" ? "adf" : "markdown", lastWritten: "", replacements: [] } });
    rpc({});
    const meta = (await db.readSubmissionRecovery("i"))!;
    expect(runner.attachmentRetryBlocker(meta)).toBe("legacy");
    expect(await runner.retryAttachments("i")).toMatchObject({ status: "blocked", reason: "legacy" });
    expect(sendBg).not.toHaveBeenCalled();
  });

  it("a disconnected platform is an authentication stop with reconnect guidance and no writes", async () => {
    const plan = ghPlan({}, [logs.id]);
    await seed({ files: [logs], bodyPlan: plan });
    rpc({ "github.getAccountIdentity": () => { throw Object.assign(new Error("Platform is not connected"), { status: 401, body: { code: "not_connected" } }); } });
    expect(await runner.retryAttachments("i")).toMatchObject({ status: "blocked", reason: "authentication" });
    expect(types()).toEqual(["github.getAccountIdentity"]);
  });

  it("a record mixing an unconfirmed upload with a slot-less file reports the unconfirmed one, not legacy", async () => {
    const plan = ghPlan({}, [logs.id]);
    await seed({ files: [logs, userPdf], bodyPlan: plan, checkpoints: [cp(logs.id, { upload: "unknown" }), cp(userPdf.id)] });
    rpc({});
    expect(runner.attachmentRetryBlocker((await db.readSubmissionRecovery("i"))!)).toBe("ambiguous");
    expect(await runner.retryAttachments("i")).toMatchObject({ status: "blocked", reason: "ambiguous" });
    expect(sendBg).not.toHaveBeenCalled();
  });

  it.each([
    ["a network failure", () => { throw new TypeError("Failed to fetch"); }],
    ["a provider 503", () => { throw httpError(503); }],
  ])("an identity lookup that fails with %s is ambiguous, not a different account, and writes nothing", async (_, lookup) => {
    const plan = ghPlan({}, [logs.id]);
    await seed({ files: [logs], bodyPlan: plan });
    rpc({ "github.getAccountIdentity": lookup });
    expect(await runner.retryAttachments("i")).toMatchObject({ status: "blocked", reason: "ambiguous" });
    expect(types()).toEqual(["github.getAccountIdentity"]);
    expect(runner.attachmentRetryBlocker((await db.readSubmissionRecovery("i"))!)).toBeNull();
  });

  it("keeps the original submit time when a retry completes the record", async () => {
    const plan = ghPlan({}, [logs.id]);
    await seed({ files: [logs], bodyPlan: plan, submittedAt: 12345 });
    rpc(github({ body: plan.lastWritten }));
    expect((await runner.retryAttachments("i")).status).toBe("complete");
    expect(store.useIssuesStore.getState().issues[0].submittedAt).toBe(12345);
  });

  it.each([
    ["github", GITHUB],
    ["gitlab", GITLAB],
    ["linear", LINEAR],
    ["clickup", CLICKUP],
  ] as const)("%s never re-sends an upload whose result is unknown", async (platform, destination) => {
    await seed({ destination, identity: id(platform), files: [userPdf], checkpoints: [cp(userPdf.id, { upload: "unknown", body: "not-applicable", link: platform === "linear" ? "pending" : "not-applicable" })] });
    rpc({});
    expect(await runner.retryAttachments("i")).toMatchObject({ status: "blocked", reason: "ambiguous" });
    expect(sendBg).not.toHaveBeenCalled();
  });

  it("Notion re-sends an unattached upload whose result is unknown once", async () => {
    await seed({ destination: NOTION, identity: id("notion"), files: [userPdf], checkpoints: [{ fileId: userPdf.id, upload: "unknown", link: "pending", body: "not-applicable" }] });
    rpc({
      "notion.getAccountIdentity": () => ({ identity: id("notion") }),
      "notion.getBlockChildren": () => ({ blocks: [] }),
      "notion.uploadFile": (msg) => ({ fileId: msg.fileId, fileUploadId: "up-9", expiresAt: null }),
      "notion.appendBlockChildren": (msg) => ({ blockIds: msg.children.map((_: unknown, i: number) => `b${i}`) }),
    });
    expect((await runner.retryAttachments("i")).status).toBe("complete");
    expect(sent("notion.uploadFile")).toHaveLength(1);
    expect(sent("notion.appendBlockChildren")[0].children[0].file.file_upload.id).toBe("up-9");
  });

  it("Slack re-sends a pre-complete upload whose result is unknown once", async () => {
    await seed({ destination: SLACK, identity: id("slack"), files: [userPdf], checkpoints: [{ fileId: userPdf.id, upload: "unknown", link: "pending", body: "not-applicable" }] });
    rpc({
      "slack.getAccountIdentity": () => ({ identity: id("slack") }),
      "slack.requestFileUpload": () => ({ fileId: "F2", uploadUrl: "https://files.slack.com/upload/v1/y" }),
      "slack.sendFileUpload": () => ({ ok: true }),
      "slack.completeFileUploads": () => ({ ok: true }),
    });
    expect((await runner.retryAttachments("i")).status).toBe("complete");
    expect(sent("slack.requestFileUpload")).toHaveLength(1);
    expect(sent("slack.completeFileUploads")).toHaveLength(1);
  });

  it.each([
    ["present", ["https://uploads.linear.app/spec.pdf"], 0],
    ["absent", [], 1],
  ] as const)("Linear reconciles an unconfirmed link against the attachment URLs (%s)", async (_, urls, creates) => {
    await seed({ destination: LINEAR, identity: id("linear"), files: [userPdf], checkpoints: [{ fileId: userPdf.id, upload: "done", link: "unknown", body: "not-applicable", uploaded: { platform: "linear", href: "https://uploads.linear.app/spec.pdf" } }] });
    rpc({
      "linear.getAccountIdentity": () => ({ identity: id("linear") }),
      "linear.getIssueAttachments": () => ({ description: "", attachments: urls.map((url, n) => ({ id: `a${n}`, url })) }),
      "linear.createAttachment": () => ({ ok: true }),
    });
    expect((await runner.retryAttachments("i")).status).toBe("complete");
    expect(sent("linear.createAttachment")).toHaveLength(creates);
  });

  it("a revision written by someone else rejects our next checkpoint and stops every later remote write", async () => {
    const plan = ghPlan({}, [logs.id]);
    await seed({ files: [logs], bodyPlan: plan });
    rpc(github({ body: plan.lastWritten }, {
      "github.uploadFiles": async (msg) => {
        const journal = (await db.readSubmissionRecovery("i"))!;
        await db.checkpointAttachmentRetry("i", "a", journal.retry!.revision, {});
        return msg.files.map((f: any) => ({ fileId: f.fileId, filename: f.filename, ok: true, href: HREF[f.fileId] }));
      },
    }));
    expect(await runner.retryAttachments("i")).toMatchObject({ status: "partial", storageFailed: true });
    expect(sent("github.updateIssueBody")).toHaveLength(0);
    expect(types().filter((t) => t === "github.getIssueBody")).toHaveLength(1);
  });

  it("is busy without a single message while another holder has the issue lock", async () => {
    const plan = ghPlan({}, [logs.id]);
    await seed({ files: [logs], bodyPlan: plan });
    rpc(github({ body: plan.lastWritten }));
    let release!: () => void;
    const held = navigator.locks.request("bugshot-submission:i", { ifAvailable: true }, () => new Promise<void>((resolve) => { release = resolve; }));
    const outcome = await runner.retryAttachments("i");
    release();
    await held;
    expect(outcome.status).toBe("busy");
    expect(sendBg).not.toHaveBeenCalled();
  });

  it("Notion splits more than 100 blocks and keeps the first batch's block ids when the next fails", async () => {
    const files: SeedFile[] = Array.from({ length: 101 }, (_, n) => ({ id: `user:f${n}`, kind: "user", filename: `f${n}.pdf`, contentType: "application/pdf" }));
    await seed({ destination: NOTION, identity: id("notion"), files, checkpoints: files.map((f) => ({ fileId: f.id, upload: "done", link: "pending", body: "not-applicable", uploaded: { platform: "notion", id: `up-${f.id}`, expiresAt: null } })) });
    let appends = 0;
    rpc({
      "notion.getAccountIdentity": () => ({ identity: id("notion") }),
      "notion.getBlockChildren": () => ({ blocks: [] }),
      "notion.getFileUpload": () => ({ status: "uploaded", expiresAt: null }),
      "notion.appendBlockChildren": (msg) => { if (++appends > 1) throw httpError(400); return { blockIds: msg.children.map((_: unknown, i: number) => `b${i}`) }; },
    });
    expect(await runner.retryAttachments("i")).toMatchObject({ status: "partial", remaining: 1 });
    expect(sent("notion.appendBlockChildren").map((m) => m.children.length)).toEqual([100, 1]);
    const checkpoints = (await db.readSubmissionRecovery("i"))!.retry!.checkpoints;
    expect(checkpoints.filter((c) => c.link === "done" && c.linkedId)).toHaveLength(100);
    expect(checkpoints.find((c) => c.fileId === "user:f100")).toMatchObject({ link: "failed" });
  });

  const markdownPlan = (initial: Record<string, string | undefined>, pending: string[]) => ghPlan(initial, pending);
  it("GitLab sends one-file uploads and reads/writes only the description of the fixed issue", async () => {
    const plan = markdownPlan({}, [capture.id]);
    await seed({ destination: GITLAB, identity: id("gitlab"), files: [capture], bodyPlan: plan });
    const remote = { body: plan.lastWritten };
    rpc({
      "gitlab.getAccountIdentity": () => ({ identity: id("gitlab") }),
      "gitlab.getIssueDescription": () => ({ description: remote.body }),
      "gitlab.uploadFiles": (msg) => msg.files.map((f: any) => ({ fileId: f.fileId, filename: f.filename, ok: true, href: HREF[f.fileId] })),
      "gitlab.updateIssueDescription": (msg) => { remote.body = msg.description; return {}; },
    });
    expect((await runner.retryAttachments("i")).status).toBe("complete");
    expect(sent("gitlab.uploadFiles")).toEqual([{ type: "gitlab.uploadFiles", projectId: 4, files: [expect.objectContaining({ fileId: capture.id })] }]);
    expect(sent("gitlab.getIssueDescription").every((m) => m.projectId === 4 && m.iid === 3)).toBe(true);
    expect(sent("gitlab.updateIssueDescription")).toEqual([{ type: "gitlab.updateIssueDescription", projectId: 4, iid: 3, description: ghBody({ [capture.id]: HREF[capture.id] }) }]);
  });

  it("ClickUp sends one-file uploads and writes only the task markdown", async () => {
    const plan = markdownPlan({}, [capture.id]);
    await seed({ destination: CLICKUP, identity: id("clickup"), files: [capture], bodyPlan: plan });
    const remote = { body: plan.lastWritten };
    rpc({
      "clickup.getAccountIdentity": () => ({ identity: id("clickup") }),
      "clickup.getTaskAttachments": () => ({ markdown: remote.body, attachments: [] }),
      "clickup.uploadFile": (msg) => msg.files.map((f: any) => ({ fileId: f.fileId, filename: f.filename, ok: true, href: HREF[f.fileId] })),
      "clickup.updateTaskMarkdown": (msg) => { remote.body = msg.markdownContent; return {}; },
    });
    expect((await runner.retryAttachments("i")).status).toBe("complete");
    expect(sent("clickup.uploadFile")).toEqual([{ type: "clickup.uploadFile", taskId: "task", files: [expect.objectContaining({ fileId: capture.id })] }]);
    expect(sent("clickup.getTaskAttachments").length).toBeGreaterThan(0);
    expect(sent("clickup.getTaskAttachments").every((m) => JSON.stringify(m) === JSON.stringify({ type: "clickup.getTaskAttachments", taskId: "task" }))).toBe(true);
    expect(sent("clickup.updateTaskMarkdown")).toEqual([{ type: "clickup.updateTaskMarkdown", taskId: "task", markdownContent: ghBody({ [capture.id]: HREF[capture.id] }) }]);
  });

  it("Asana sends one-file uploads and fills the task notes with the new gid", async () => {
    const notes = (gid?: string) => ["<h2>Media</h2>", gid ? `<img data-asana-gid="${gid}">` : "<p>(capture dropped)</p>", "<p>Reported via BugShot</p>"].join("\n");
    const lastWritten = notes();
    const bodyPlan: AttachmentBodyPlan = { format: "asana-html", lastWritten, replacements: patch.buildBodyReplacements({ format: "asana-html", base: lastWritten, pending: [capture.id], render: (s) => notes(s.has(capture.id) ? patch.bodySlotToken(capture.id) : undefined) }) };
    await seed({ destination: ASANA, identity: id("asana"), files: [capture], bodyPlan });
    const remote = { body: lastWritten };
    rpc({
      "asana.getAccountIdentity": () => ({ identity: id("asana") }),
      "asana.getTaskAttachments": () => ({ htmlNotes: remote.body, workspaceGid: "w", attachments: [] }),
      "asana.uploadFiles": (msg) => msg.files.map((f: any) => ({ fileId: f.fileId, filename: f.filename, ok: true, gid: "g-1" })),
      "asana.updateTaskNotes": (msg) => { remote.body = msg.htmlNotes; return {}; },
    });
    expect((await runner.retryAttachments("i")).status).toBe("complete");
    expect(sent("asana.uploadFiles")).toEqual([{ type: "asana.uploadFiles", parent: "task", files: [expect.objectContaining({ fileId: capture.id })] }]);
    expect(sent("asana.getTaskAttachments").length).toBeGreaterThan(0);
    expect(sent("asana.getTaskAttachments").every((m) => JSON.stringify(m) === JSON.stringify({ type: "asana.getTaskAttachments", taskGid: "task" }))).toBe(true);
    expect(sent("asana.updateTaskNotes")).toEqual([{ type: "asana.updateTaskNotes", taskGid: "task", htmlNotes: notes("g-1") }]);
  });

  it("Jira renders only our slot: one snapshot row with recovered dims, user prose untouched", async () => {
    const { buildJiraDescriptionContent } = await import("@/background/messages");
    const { t, withLocale } = await import("@/i18n");
    const [asIs, toBe] = withLocale("en", () => [t("styleTable.asIs"), t("styleTable.toBe")]);
    const cell = (text: string) => ({ type: "tableCell", attrs: {}, content: [para(text)] });
    const styleTable = { type: "table", content: [{ type: "tableRow", content: [cell("Property"), cell(asIs), cell(toBe)] }, { type: "tableRow", content: [cell("color"), cell("red"), cell("blue")] }] };
    const template = { version: 1, type: "doc", content: [para("Environment"), styleTable, para("Footer")] };
    const before = { kind: "media" as const, mediaId: "m-before", width: 800, height: 600 };
    const written = { version: 1, type: "doc", content: buildJiraDescriptionContent({ description: template as never, uploadMap: new Map([["before-0.webp", before]]), bodyLocale: "en" }) };
    const bodyPlan: AttachmentBodyPlan = { format: "adf", lastWritten: JSON.stringify(written), replacements: patch.buildAdfBodyReplacements({ written, template, slots: [{ index: 1, fileIds: ["capture:before-0", "capture:after-0"] }] }) };
    await db.saveAttachmentBlob("i", "b0", new Blob(["b"], { type: "image/webp" }));
    const shot = (side: string): SeedFile => ({ id: `capture:${side}-0`, kind: "capture", filename: `${side}-0.webp`, contentType: "image/webp", ...(side === "before" ? { original: { kind: "original" as const, store: "attachments" as const, key: "i:b0" } } : {}) });
    const logsFile: SeedFile = { id: "logs", kind: "logs", filename: "logs.html", contentType: "text/html" };
    await seed({ destination: JIRA, identity: id("jira"), files: [shot("before"), shot("after"), logsFile], bodyPlan, checkpoints: [
      cp("capture:before-0", { upload: "done", body: "done", uploaded: { platform: "jira", id: "1", href: "https://acme.atlassian.net/secure/attachment/1/before-0.webp", mediaId: "m-before" } }),
      cp("capture:after-0", { upload: "done", body: "failed", uploaded: { platform: "jira", id: "2", href: "https://acme.atlassian.net/secure/attachment/2/after-0.webp", mediaId: "m-after" } }),
      cp("logs", { upload: "done", body: "done", uploaded: { platform: "jira", id: "3", href: "https://acme.atlassian.net/secure/attachment/3/logs.html" } }),
    ] });
    await rawDelete("attachments", "i:b0");
    decoded.dims = { width: 640, height: 480 };
    const userProse = [para("logs.html"), para("__BUGSHOT_IMAGE__")];
    const remote = { ...written, content: [...written.content, ...userProse] };
    let final: { content: unknown[] } | undefined;
    rpc({
      "jira.getAccountIdentity": () => ({ identity: id("jira") }),
      "jira.getIssueAttachments": () => ({ description: remote, attachments: [] }),
      "jira.updateIssueDescription": (msg) => {
        final = { content: buildJiraDescriptionContent({ description: msg.description, uploadMap: new Map(msg.uploads.map((u: any) => [u.filename, u.file])), logsUrl: msg.logsUrl, bodyLocale: msg.bodyLocale, ...(msg.slots ? { only: new Set<number>(msg.slots) } : {}) }) };
        return { ok: true, description: { version: 1, type: "doc", ...final } };
      },
    });
    expect((await runner.retryAttachments("i")).status).toBe("complete");
    const content = final!.content as Array<{ type: string; content?: Array<{ content?: unknown[] }> }>;
    expect(content.slice(-2)).toEqual(userProse);
    const rows = (content[1].content ?? []).filter((row) => JSON.stringify(row).includes('"media"'));
    expect(rows).toHaveLength(1);
    const media = JSON.stringify(rows[0]);
    expect(media).toContain('"id":"m-before","collection":"","width":800,"height":600');
    expect(media).toContain('"id":"m-after","collection":"","width":640,"height":480');
  });
});

describe("planAttachmentRetry", () => {
  const meta = (checkpoints: AttachmentCheckpoint[], platform: SubmissionRecoveryMeta["platform"] = "github"): SubmissionRecoveryMeta => ({
    attemptId: "a", issueId: "i", title: "t", platform, createdAt: 1, expiresAt: 2, updatedAt: 1, phase: "partial",
    files: checkpoints.map((c) => ({ id: c.fileId, kind: "capture", filename: `${c.fileId}.webp`, contentType: "image/webp", source: { kind: "generated", key: `file:a:${c.fileId}` } })),
    results: [], destination: GITHUB,
    retry: { schemaVersion: 1, accountIdentity: IDENTITY, bodyLocale: "en", revision: 1, checkpoints, bodyPlan: { format: "markdown", lastWritten: "", replacements: checkpoints.map((c) => ({ fileId: c.fileId, anchor: "[]", before: "[]", after: "[]", renderTemplate: "[]" })) } },
  });

  it("resumes each file at its first unfinished stage and skips finished files", () => {
    expect(runner.planAttachmentRetry(meta([
      cp("a"), cp("b", { upload: "done", body: "failed", uploaded: { platform: "github", href: "https://x/b" } }), done("c", "https://x/c"),
    ]))).toEqual([{ fileId: "a", stage: "upload" }, { fileId: "b", stage: "body" }]);
  });

  it("does not plan an unconfirmed Slack complete", () => {
    expect(runner.planAttachmentRetry({ ...meta([{ fileId: "a", upload: "done", link: "unknown", body: "not-applicable", uploaded: { platform: "slack", id: "F" } }], "slack"), destination: { platform: "slack", key: "1", locator: { channelId: "C", ts: "1" } } })).toEqual([]);
  });

  it("hides retry when nothing is actionable", () => {
    expect(runner.attachmentRetryBlocker({ ...meta([{ fileId: "a", upload: "done", link: "unknown", body: "not-applicable", uploaded: { platform: "slack", id: "F" } }], "slack"), destination: { platform: "slack", key: "1", locator: { channelId: "C", ts: "1" } } })).toBe("ambiguous");
    expect(runner.attachmentRetryBlocker(meta([cp("a")]))).toBeNull();
  });

  it("keeps a body conflict retryable and reports it from durable state", () => {
    const conflicted = meta([cp("a", { upload: "done", body: "conflict", uploaded: { platform: "github", href: "https://x/a" } })]);
    expect(runner.attachmentRetryBlocker(conflicted)).toBeNull();
    expect(runner.attachmentRecoveryReason(conflicted)).toBe("body-conflict");
    expect(runner.attachmentRecoveryReason(meta([cp("a")]))).toBeNull();
  });

  it("offers only a download for a GitHub file without a recorded body slot", () => {
    const slotless = meta([cp("a")]);
    slotless.retry!.bodyPlan.replacements = [];
    expect(runner.planAttachmentRetry(slotless)).toEqual([]);
    expect(runner.attachmentRetryBlocker(slotless)).toBe("legacy");
  });
});
