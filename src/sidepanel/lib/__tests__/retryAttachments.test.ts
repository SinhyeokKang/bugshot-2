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

let runner: typeof import("../retryAttachments");
let patch: typeof import("../attachmentBodyPatch");
let db: typeof import("@/store/blob-db");
let store: typeof import("@/store/issues-store");
let persisted: Record<string, unknown>;

beforeEach(async () => {
  vi.resetModules();
  mockWebLocks();
  sendBg.mockReset();
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
  await db.checkpointSubmission("i", "a", { phase: "partial", destination, results: checkpoints.map(result) });
  const record: IssueRecord = { id: "i", title: "Report", platform, status: "submitted", key: destination.key, url: destination.url, createdAt: 1, updatedAt: 2, pageUrl: "", draft: { title: "", sections: {} }, snapshot: { before: false, after: false }, submissionRecoveryId: "a" };
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
    expect(outcome).toMatchObject({ status: "partial", reason: "body-conflict" });
    expect(sent("github.uploadFiles")).toHaveLength(0);
    expect(sent("github.updateIssueBody")).toHaveLength(0);
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
    await db.deleteAttachmentBlob("i", "pdf");
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

  it("Notion never re-appends a block whose earlier append is unconfirmed", async () => {
    await seed({ destination: NOTION, identity: '["notion","w","b"]', files: [userPdf], checkpoints: [{ fileId: userPdf.id, upload: "done", link: "unknown", body: "not-applicable", uploaded: { platform: "notion", id: "up-1", expiresAt: null } }] });
    rpc({ "notion.getAccountIdentity": () => ({ identity: '["notion","w","b"]' }), "notion.getBlockChildren": () => ({ blocks: [] }) });
    const outcome = await runner.retryAttachments("i");
    expect(outcome).toMatchObject({ status: "partial", reason: "ambiguous" });
    expect(sent("notion.appendBlockChildren")).toHaveLength(0);
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
    expect(outcome).toMatchObject({ status: "partial", reason: "ambiguous" });
    expect(types().filter((t) => t.startsWith("slack.") && t !== "slack.getAccountIdentity")).toEqual([]);
  });
});

describe("planAttachmentRetry", () => {
  const meta = (checkpoints: AttachmentCheckpoint[], platform: SubmissionRecoveryMeta["platform"] = "github"): SubmissionRecoveryMeta => ({
    attemptId: "a", issueId: "i", title: "t", platform, createdAt: 1, expiresAt: 2, updatedAt: 1, phase: "partial",
    files: checkpoints.map((c) => ({ id: c.fileId, kind: "capture", filename: `${c.fileId}.webp`, contentType: "image/webp", source: { kind: "generated", key: `file:a:${c.fileId}` } })),
    results: [], destination: GITHUB,
    retry: { schemaVersion: 1, accountIdentity: IDENTITY, bodyLocale: "en", revision: 1, checkpoints, bodyPlan: { format: "markdown", lastWritten: "", replacements: [] } },
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
});
