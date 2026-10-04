import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/extension";
import { cleanup, installRemote, openRecoveryPanel, PDF, REMOTE, remoteBody, setRemote, setRemoteBody, setup, state, submitSaved, type Extension, type Provider, type Rpc, type RemoteConfig } from "./fixtures/recovery";

// Phase two: retry on the existing remote issue, judged by the sendMessage spy (counts + payloads),
// testids and the persisted journal. Every flow first reaches a real partial result through the
// visible submit, so the retry runs against the checkpoints the submission itself wrote.
const pages: Page[] = [];
const ids: string[] = [];
type Setup = Parameters<typeof setup>[3];

async function start(ext: Extension, provider: Provider, options: Setup = {}) {
  const id = `retry-${ids.length}-${Date.now()}`;
  const result = await setup(ext, id, provider, options);
  pages.push(result.panel, result.fixture); ids.push(id);
  return result;
}
const spies: Rpc[][] = [];
// The spy log of a failing flow is the first thing to read; attach it instead of re-running blind.
async function remote(panel: Page, provider: Provider, config: RemoteConfig = {}): Promise<Rpc[]> {
  const calls = await installRemote(panel, provider, config);
  spies.push(calls);
  return calls;
}
test.afterEach(async ({ ext }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus && pages[0] && !pages[0].isClosed()) {
    const toasts = await pages[0].locator("[data-sonner-toast]").evaluateAll((els) => els.map((el) => `${el.getAttribute("data-type")}: ${el.textContent}`)).catch(() => []);
    const journal = await state(pages[0], ids[0]).then((s) => s.journal).catch(() => undefined);
    console.log(`state ${testInfo.title}\n${toasts.join("\n")}\n${JSON.stringify(journal)?.slice(0, 1500)}`);
  }
  if (testInfo.status !== testInfo.expectedStatus) console.log(`spy-calls ${testInfo.title}\n${spies.flatMap((calls) => calls.map((m) => JSON.stringify({ ...m, files: m.files?.map((f: any) => ({ ...f, dataUrl: "…" })), dataUrl: m.dataUrl && "…" }).slice(0, 400))).join("\n")}`);
  spies.length = 0;
  await cleanup(ext, pages.splice(0), ids.splice(0));
});

const CREATE = /^(github\.submitIssue|jira\.createIssue|clickup\.submitIssue|asana\.submitIssue|notion\.submitPage|webhook\.submit|linear\.submitIssue|gitlab\.submitIssue)$/;
const isCreate = (m: Rpc) => CREATE.test(m.type) || (m.type === "slack.postMessage" && !m.payload?.threadTs);
const ofType = (calls: Rpc[], type: string) => calls.filter((m) => m.type === type);
const bytesOf = (dataUrl: string) => [...Buffer.from(dataUrl.split(",")[1], "base64")];

// Submit through the saved-draft entrance and land on the issue list with the warning row.
async function submitPartial(panel: Page) {
  await submitSaved(panel);
  await expect(panel.getByTestId("submit-success-partial")).toBeVisible();
  await panel.getByTestId("submit-success-partial").getByRole("button").last().click();
  await panel.getByTestId("tab-issue-list").click();
  await expect(panel.getByTestId("recovery-row-warning")).toBeVisible();
}
async function pressRowRetry(panel: Page) {
  const button = panel.getByTestId("recovery-row-retry");
  await expect(button).toBeVisible();
  await expect(button).not.toHaveAttribute("aria-disabled", "true");
  await button.click();
}
async function openDetail(panel: Page) {
  await panel.getByTestId("recovery-detail-open").click();
  await expect(panel.getByTestId("draft-detail-dialog")).toBeVisible();
  await expect(panel.getByTestId("recovery-file-row").first()).toBeVisible();
}
const successToast = (panel: Page) => panel.locator('[data-sonner-toast][data-type="success"]');
const warningToast = (panel: Page) => panel.locator('[data-sonner-toast][data-type="warning"]');
// What a retry may send per platform. Anything else (a new write type the permissive stub would
// silently accept) fails the flow; list refreshes and analytics ride along.
const RETRY_TYPES: Record<string, RegExp> = {
  github: /^github\.(getAccountIdentity|getIssueBody|uploadFiles|updateIssueBody|getIssueStatus)$/,
  clickup: /^clickup\.(getAccountIdentity|getTaskAttachments|uploadFile|updateTaskMarkdown|getTaskStatus)$/,
  notion: /^notion\.(getAccountIdentity|getBlockChildren|getFileUpload|uploadFile|appendBlockChildren|getPageStatus)$/,
  slack: /^slack\.(getAccountIdentity|requestFileUpload|sendFileUpload|completeFileUploads)$/,
};
function sent(calls: Rpc[], from: number, provider?: Provider) {
  const slice = calls.slice(from).filter((m) => !m.type.startsWith("analytics."));
  if (provider) expect(slice.filter((m) => !RETRY_TYPES[provider].test(m.type)).map((m) => m.type)).toEqual([]);
  return calls.slice(from);
}
// A retry must never create: across the whole flow the spy sees exactly the first creation.
const expectOneCreation = (calls: Rpc[]) => expect(calls.filter(isCreate)).toHaveLength(1);
const blobPresent = (panel: Page, store: string, key: string) => panel.evaluate(async ({ store, key }) => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("bugshot-video"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  const value = await new Promise<unknown>((resolve, reject) => { const r = db.transaction(store).objectStore(store).get(key); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  db.close();
  return value instanceof Blob && value.size > 0;
}, { store, key });
const flush = (panel: Page) => panel.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

test("11: retry uploads one file per message for every failed file and patches the body once", async ({ ext }) => {
  const { panel, id } = await start(ext, "github", { kinds: ["inline", "capture", "user", "logs"] });
  const calls = await remote(panel, "github", { rejectUpload: true });
  await submitPartial(panel);
  const before = await state(panel, id);
  expect(before.journal?.phase).toBe("partial");
  expect(before.journal?.retry?.accountIdentity).toEqual(expect.any(String));
  const failed = before.journal!.files.map((f) => f.id).sort();
  expect(failed).toEqual(["capture:screenshot", "inline:recover-image", "logs", "user:pdf"]);
  const logsBytes = before.sources.find((s) => s.id === "logs")!.bytes;
  expect(logsBytes).not.toBeNull();

  // The originals stay while anything is unfinished and go only after the completed record is durable.
  expect(await blobPresent(panel, "attachments", `${id}:pdf`)).toBe(true);
  await setRemote(panel, { rejectUpload: false });
  const mark = calls.length;
  await pressRowRetry(panel);
  await expect(successToast(panel)).toBeVisible();
  await expect(panel.getByTestId("recovery-row-warning")).toHaveCount(0);
  await expect.poll(() => blobPresent(panel, "attachments", `${id}:pdf`)).toBe(false);

  const retry = sent(calls, mark, "github");
  const uploads = ofType(retry, "github.uploadFiles");
  expect(uploads).toHaveLength(failed.length);
  expect(uploads.every((m) => m.files!.length === 1)).toBe(true);
  expect(uploads.map((m) => m.files![0].fileId).sort()).toEqual(failed);
  expect(bytesOf(uploads.find((m) => m.files![0].fileId === "user:pdf")!.files![0].dataUrl)).toEqual([...Buffer.from(PDF)]);
  // The generated logs are the bytes frozen at submission, not a fresh render.
  expect(bytesOf(uploads.find((m) => m.files![0].fileId === "logs")!.files![0].dataUrl)).toEqual(logsBytes);
  const updates = ofType(retry, "github.updateIssueBody");
  expect(updates).toHaveLength(1);
  expect(updates[0].body).not.toContain("inline:");
  for (const file of failed) expect(updates[0].body).toContain(`https://example.com/files/${encodeURIComponent(file)}`);
  expect(retry.filter(isCreate)).toEqual([]);
  expectOneCreation(calls);

  const after = await state(panel, id);
  expect(after.journal).toBeUndefined();
  expect(after.issue.status).toBe("submitted");
  expect(after.issue.submissionRecoveryId).toBeUndefined();
  expect(await remoteBody(panel)).toBe(updates[0].body);
});

test("12: an upload that succeeded while the body write failed retries as a body write only", async ({ ext }) => {
  const { panel, id } = await start(ext, "clickup", { kinds: ["capture"] });
  const calls = await remote(panel, "clickup", { bodyWrite: "reject" });
  await submitPartial(panel);
  const before = await state(panel, id);
  expect(before.journal?.retry?.checkpoints).toMatchObject([{ fileId: "capture:screenshot", upload: "done", body: "failed" }]);
  await openDetail(panel);
  // Uploaded, but nothing links it from the body.
  await expect(panel.getByTestId("recovery-file-row")).toHaveAttribute("data-state", "attached");
  await panel.keyboard.press("Escape");
  await expect(panel.getByTestId("draft-detail-dialog")).toBeHidden();

  await setRemote(panel, { bodyWrite: "ok" });
  const mark = calls.length;
  await pressRowRetry(panel);
  await expect(successToast(panel)).toBeVisible();
  const retry = sent(calls, mark, "clickup");
  expect(ofType(retry, "clickup.uploadFile")).toHaveLength(0);
  const updates = ofType(retry, "clickup.updateTaskMarkdown");
  expect(updates).toHaveLength(1);
  expect(updates[0].markdownContent).toContain("https://example.com/files/capture%3Ascreenshot");
  expect(updates[0].markdownContent).not.toContain("inline:");
  expect(retry.filter(isCreate)).toEqual([]);
  expectOneCreation(calls);
  await expect(panel.getByTestId("recovery-row-warning")).toHaveCount(0);
  expect((await state(panel, id)).journal).toBeUndefined();
});

test("a partial re-success leaves the next retry only the files that failed again", async ({ ext }) => {
  const { panel, id } = await start(ext, "github", { kinds: ["inline", "capture"] });
  const calls = await remote(panel, "github", { rejectUpload: true });
  await submitPartial(panel);
  await setRemote(panel, { rejectUpload: false, failIds: ["inline:"] });
  let mark = calls.length;
  await pressRowRetry(panel);
  await expect.poll(() => ofType(sent(calls, mark), "github.updateIssueBody").length).toBe(1);
  await expect(panel.getByTestId("recovery-row-warning")).toBeVisible();
  expect(ofType(sent(calls, mark), "github.uploadFiles").map((m) => m.files![0].fileId).sort()).toEqual(["capture:screenshot", "inline:recover-image"]);
  await openDetail(panel);
  await expect(panel.locator('[data-testid="recovery-file-row"][data-state="failed"]')).toHaveCount(1);
  await expect(panel.getByTestId("recovery-file-row").filter({ has: panel.getByTestId("recovery-file-download") })).toHaveAttribute("data-file-id", "inline:recover-image");
  await panel.keyboard.press("Escape");

  await setRemote(panel, { failIds: [] });
  mark = calls.length;
  await pressRowRetry(panel);
  await expect(successToast(panel)).toBeVisible();
  expect(ofType(sent(calls, mark), "github.uploadFiles").map((m) => m.files![0].fileId)).toEqual(["inline:recover-image"]);
  expect(ofType(sent(calls, mark, "github"), "github.updateIssueBody")).toHaveLength(1);
  expectOneCreation(calls);
  expect((await state(panel, id)).journal).toBeUndefined();
});

test("13: remote prose written meanwhile survives the body patch", async ({ ext }) => {
  const { panel } = await start(ext, "github", { kinds: ["capture"] });
  const calls = await remote(panel, "github", { rejectUpload: true });
  await submitPartial(panel);
  const base = (await remoteBody(panel))!;
  await setRemoteBody(panel, `${base}\n\n외부 편집\n`);
  await setRemote(panel, { rejectUpload: false });
  const mark = calls.length;
  await pressRowRetry(panel);
  await expect(successToast(panel)).toBeVisible();
  const updates = ofType(sent(calls, mark, "github"), "github.updateIssueBody");
  expect(updates).toHaveLength(1);
  expect(updates[0].body).toContain("외부 편집");
  expect(updates[0].body).toContain("https://example.com/files/capture%3Ascreenshot");
  expect(updates[0].body).not.toContain("inline:");
  expectOneCreation(calls);
});

test("13: a deleted attachment place is a conflict: no body write, no second upload", async ({ ext }) => {
  const { panel, id } = await start(ext, "github", { kinds: ["capture"] });
  const calls = await remote(panel, "github", { rejectUpload: true });
  await submitPartial(panel);
  const journal = (await state(panel, id)).journal!;
  const slot = journal.retry!.bodyPlan.replacements.filter((r) => r.fileId === "capture:screenshot");
  expect(slot.length).toBeGreaterThan(0);
  // The units the first submission wrote for this file are the attachment place.
  const units = new Set(slot.flatMap((r) => JSON.parse(r.before) as string[]).filter((u) => u.trim()));
  const base = (await remoteBody(panel))!;
  const erased = base.split("\n").filter((line) => !units.has(line.replace(/\r$/, ""))).join("\n");
  expect(erased).not.toBe(base);
  await setRemoteBody(panel, erased);

  await setRemote(panel, { rejectUpload: false });
  let mark = calls.length;
  await pressRowRetry(panel);
  // The run is over once the conflict is durable and its result was announced (warning toast).
  await expect.poll(async () => (await state(panel, id)).journal?.retry?.checkpoints[0]?.body).toBe("conflict");
  await expect(warningToast(panel)).toBeVisible();
  await expect(panel.getByTestId("recovery-row-retry")).not.toHaveAttribute("aria-busy", "true");
  expect(ofType(sent(calls, mark, "github"), "github.updateIssueBody")).toEqual([]);
  expect(await remoteBody(panel)).toBe(erased);
  await openDetail(panel);
  // The product shows the file as attached (its upload stands) with the conflict explanation.
  const row = panel.getByTestId("recovery-file-row");
  await expect(row).toHaveAttribute("data-state", "attached");
  await expect(row).toContainText("The issue body was edited");
  await expect(panel.getByTestId("recovery-retry-notice")).toHaveAttribute("data-reason", "body-conflict");
  await panel.keyboard.press("Escape");
  await expect(panel.getByTestId("draft-detail-dialog")).toBeHidden();

  // Pressing again resends nothing: the upload is checkpointed and the place is still gone.
  // Dismiss the first run's toast so the second run's own announcement marks its end.
  await panel.locator("[data-sonner-toast]").first().click();
  await expect(panel.locator("[data-sonner-toast]")).toHaveCount(0);
  mark = calls.length;
  await pressRowRetry(panel);
  await expect(warningToast(panel)).toBeVisible();
  expect(ofType(sent(calls, mark, "github"), "github.getIssueBody").length).toBeGreaterThan(0);
  expect(ofType(sent(calls, mark), "github.uploadFiles")).toEqual([]);
  expect(ofType(sent(calls, mark), "github.updateIssueBody")).toEqual([]);
  expectOneCreation(calls);
  expect((await state(panel, id)).journal?.phase).toBe("partial");
});

test("15: a Notion file cut by the 100-block page limit is appended to the original page", async ({ ext }) => {
  const description = Array.from({ length: 101 }, (_, n) => `Paragraph ${n + 1}`).join("\n\n");
  const { panel, id } = await start(ext, "notion", { kinds: ["user"], description });
  const calls = await remote(panel, "notion");
  await submitPartial(panel);
  const create = ofType(calls, "notion.submitPage");
  expect(create).toHaveLength(1);
  // Premise: the body alone fills the page, so the file block falls past block 100.
  expect(create[0].payload?.blocks.length).toBeGreaterThanOrEqual(101);
  const before = await state(panel, id);
  expect(before.journal?.destination).toMatchObject({ platform: "notion", locator: { pageId: "page-42" } });
  expect(before.journal?.retry?.checkpoints).toMatchObject([{ fileId: "user:pdf", upload: "done", link: "pending" }]);

  const mark = calls.length;
  await pressRowRetry(panel);
  await expect(successToast(panel)).toBeVisible();
  const retry = sent(calls, mark, "notion");
  const appends = ofType(retry, "notion.appendBlockChildren");
  expect(appends).toHaveLength(1);
  expect(appends[0].blockId).toBe("page-42");
  expect(appends[0].children).toHaveLength(1);
  expect(appends[0].children[0]).toMatchObject({ type: "file", file: { name: "customer.pdf", file_upload: { id: "upload-42" } } });
  expect(ofType(retry, "notion.submitPage")).toEqual([]);
  expect(ofType(retry, "notion.uploadFile")).toEqual([]);
  expectOneCreation(calls);
  await expect(panel.getByTestId("recovery-row-warning")).toHaveCount(0);
});

test("15: a failed Slack file is reattached in the original thread without a new message", async ({ ext }) => {
  const { panel, id } = await start(ext, "slack", { kinds: ["user"] });
  const calls = await remote(panel, "slack", { rejectUpload: true });
  await submitPartial(panel);
  const before = await state(panel, id);
  expect(before.journal?.destination?.locator).toEqual({ channelId: "channel", ts: "42.1" });

  await setRemote(panel, { rejectUpload: false });
  const mark = calls.length;
  await pressRowRetry(panel);
  await expect(successToast(panel)).toBeVisible();
  const retry = sent(calls, mark, "slack");
  expect(ofType(retry, "slack.requestFileUpload")).toHaveLength(1);
  const bytes = ofType(retry, "slack.sendFileUpload");
  expect(bytes).toHaveLength(1);
  expect(bytesOf(bytes[0].dataUrl)).toEqual([...Buffer.from(PDF)]);
  const complete = ofType(retry, "slack.completeFileUploads");
  expect(complete).toHaveLength(1);
  expect(complete[0]).toMatchObject({ channelId: "channel", threadTs: "42.1" });
  expect(complete[0].files).toHaveLength(1);
  expect(ofType(retry, "slack.postMessage")).toEqual([]);
  expect(retry.filter(isCreate)).toEqual([]);
  expectOneCreation(calls);
});

test("a Slack complete whose result is unknown is never completed again", async ({ ext }) => {
  const { panel, id } = await start(ext, "slack", { kinds: ["user"] });
  const calls = await remote(panel, "slack", { rejectUpload: true });
  await submitPartial(panel);
  await setRemote(panel, { rejectUpload: false, slackComplete: "ambiguous" });
  let mark = calls.length;
  await pressRowRetry(panel);
  await expect(panel.locator('[data-sonner-toast][data-type="warning"]')).toBeVisible();
  expect(ofType(sent(calls, mark), "slack.completeFileUploads")).toHaveLength(1);
  // The upload may already be in the thread: the retry is withdrawn and nothing can repeat it.
  await expect(panel.getByTestId("recovery-row-retry")).toHaveCount(0);
  await expect.poll(async () => (await state(panel, id)).journal?.retry?.checkpoints[0]?.link).toBe("unknown");
  mark = calls.length;
  await openDetail(panel);
  await expect(panel.getByTestId("recovery-retry")).toHaveCount(0);
  await expect(panel.getByTestId("recovery-retry-notice")).toHaveAttribute("data-reason", "ambiguous");
  await expect(panel.getByTestId("recovery-file-download")).toBeVisible();
  expect(sent(calls, mark)).toEqual([]);
  expectOneCreation(calls);
});

// Reasons a retry cannot go on: nothing is sent, nothing is created, the download stays.
const STOPS: Array<{ name: string; config: RemoteConfig; reason: string; issueLink: boolean }> = [
  { name: "403 on the existing issue", config: { readStatus: 403 }, reason: "permission", issueLink: true },
  { name: "404 on the existing issue", config: { readStatus: 404 }, reason: "remote-missing", issueLink: false },
  { name: "401 on the existing issue", config: { readStatus: 401 }, reason: "authentication", issueLink: true },
  { name: "another account answering", config: { identity: "other" }, reason: "account-changed", issueLink: true },
];
for (const stop of STOPS) {
  test(`${stop.name} stops the retry with its own guidance, a download and no write`, async ({ ext }) => {
    const { panel, id } = await start(ext, "github", { kinds: ["user"] });
    const calls = await remote(panel, "github", { rejectUpload: true });
    await submitPartial(panel);
    await setRemote(panel, { ...stop.config, rejectUpload: false });
    const mark = calls.length;
    await pressRowRetry(panel);
    await expect(panel.getByTestId("recovery-row-retry")).toHaveCount(0);
    await openDetail(panel);
    await expect(panel.getByTestId("recovery-retry")).toHaveCount(0);
    await expect(panel.getByTestId("recovery-retry-notice")).toHaveAttribute("data-reason", stop.reason);
    await expect(panel.getByTestId("recovery-file-download")).toBeVisible();
    await expect(panel.getByTestId("draft-detail-dialog").locator(`a[href="${REMOTE}"]`)).toHaveCount(stop.issueLink ? 1 : 0);
    const retry = sent(calls, mark, "github");
    expect(retry.filter((m) => /\.(uploadFiles|updateIssueBody)$/.test(m.type))).toEqual([]);
    expect(retry.filter(isCreate)).toEqual([]);
    expectOneCreation(calls);
    expect((await state(panel, id)).journal?.phase).toBe("partial");
  });
}

test("a disconnected account stops the retry as authentication without any write", async ({ ext }) => {
  const { panel, id } = await start(ext, "github", { kinds: ["user"] });
  const calls = await remote(panel, "github", { rejectUpload: true });
  await submitPartial(panel);
  await panel.evaluate(async () => { const key = "bugshot-settings"; const raw = JSON.parse((await chrome.storage.local.get(key))[key]); raw.state.accounts = {}; await chrome.storage.local.set({ [key]: JSON.stringify(raw) }); });
  await panel.reload();
  await panel.getByTestId("tab-issue-list").click();
  const mark = calls.length;
  await pressRowRetry(panel);
  await expect(panel.getByTestId("recovery-row-retry")).toHaveCount(0);
  await openDetail(panel);
  await expect(panel.getByTestId("recovery-retry-notice")).toHaveAttribute("data-reason", "authentication");
  await expect(panel.getByTestId("recovery-file-download")).toBeVisible();
  expect(sent(calls, mark).filter((m) => /\.(uploadFiles|updateIssueBody|getIssueBody)$/.test(m.type))).toEqual([]);
  expectOneCreation(calls);
  expect((await state(panel, id)).journal?.phase).toBe("partial");
});

test("a lookup that cannot be answered shows a static check-needed note and keeps retry available", async ({ ext }) => {
  const { panel } = await start(ext, "github", { kinds: ["user"] });
  const calls = await remote(panel, "github", { rejectUpload: true });
  await submitPartial(panel);
  await setRemote(panel, { rejectUpload: false, identity: "network" });
  const mark = calls.length;
  await pressRowRetry(panel);
  await expect(panel.locator('[data-sonner-toast][data-type="warning"]')).toBeVisible();
  await expect(panel.getByTestId("recovery-row-retry")).toBeVisible();
  await expect(panel.getByTestId("recovery-row-retry").locator("svg.animate-spin")).toHaveCount(0);
  expect(sent(calls, mark).filter((m) => !/\.getAccountIdentity$/.test(m.type))).toEqual([]);
  expectOneCreation(calls);
});

test("a record whose account was never verified offers no retry from the start, only the download", async ({ ext }) => {
  const { panel, id } = await start(ext, "github", { kinds: ["user"] });
  // The identity lookup fails while the issue is submitted, so the journal keeps accountIdentity null.
  const calls = await remote(panel, "github", { rejectUpload: true, identity: "network" });
  await submitPartial(panel);
  expect((await state(panel, id)).journal?.retry?.accountIdentity).toBeNull();
  await expect(panel.getByTestId("recovery-row-retry")).toHaveCount(0);
  await openDetail(panel);
  await expect(panel.getByTestId("recovery-retry")).toHaveCount(0);
  await expect(panel.getByTestId("recovery-retry-notice")).toHaveAttribute("data-reason", "account-unverified");
  const pending = panel.waitForEvent("download");
  await panel.getByTestId("recovery-file-download").click();
  expect((await pending).suggestedFilename()).toBe("customer.pdf");
  expect(calls.filter((m) => /\.(updateIssueBody|getIssueBody)$/.test(m.type))).toEqual([]);
  expectOneCreation(calls);
});

test("a phase-one record without a retry snapshot offers only the download", async ({ ext }) => {
  const { panel, id } = await start(ext, "github", { kinds: ["user"] });
  const calls = await remote(panel, "github", { rejectUpload: true });
  await submitPartial(panel);
  // What a record written before this feature looks like: the same journal without the snapshot.
  await panel.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("bugshot-video"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const tx = db.transaction("submissionRecovery", "readwrite");
    const store = tx.objectStore("submissionRecovery");
    const read = store.get(`attempt:${id}`);
    read.onsuccess = () => { const { retry: _drop, ...phaseOne } = read.result; store.put(phaseOne, `attempt:${id}`); };
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
  }, id);
  expect((await state(panel, id)).journal?.retry).toBeUndefined();
  const mark = calls.length;
  await panel.reload();
  await panel.getByTestId("tab-issue-list").click();
  await expect(panel.getByTestId("recovery-row-warning")).toBeVisible();
  await expect(panel.getByTestId("recovery-row-retry")).toHaveCount(0);
  await openDetail(panel);
  await expect(panel.getByTestId("recovery-retry")).toHaveCount(0);
  await expect(panel.getByTestId("recovery-retry-notice")).toHaveAttribute("data-reason", "legacy");
  const pending = panel.waitForEvent("download");
  await panel.getByTestId("recovery-file-download").click();
  expect((await pending).suggestedFilename()).toBe("customer.pdf");
  expect(sent(calls, mark).filter((m) => !/\.(getIssue|getTask|getIssueStatus|getTaskStatus)$/.test(m.type))).toEqual([]);
  expectOneCreation(calls);
});

test("a preserved file that is gone locally is skipped without an upload while the others finish", async ({ ext }) => {
  const { panel, id } = await start(ext, "github", { kinds: ["inline", "user"] });
  const calls = await remote(panel, "github", { rejectUpload: true });
  await submitPartial(panel);
  await panel.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("bugshot-video"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const tx = db.transaction("attachments", "readwrite");
    tx.objectStore("attachments").delete(`${id}:pdf`);
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
  }, id);
  const mark = calls.length;
  await panel.reload();
  // The reload reinstalls the remote from its initial config.
  await setRemote(panel, { rejectUpload: false });
  await panel.getByTestId("tab-issue-list").click();
  await pressRowRetry(panel);
  await expect.poll(async () => (await state(panel, id)).journal?.results.find((r) => r.fileId === "user:pdf")?.failure).toEqual({ stage: "source", code: "local-storage" });
  const retry = sent(calls, mark, "github");
  expect(ofType(retry, "github.uploadFiles").map((m) => m.files![0].fileId)).toEqual(["inline:recover-image"]);
  await expect(panel.getByTestId("recovery-row-warning")).toBeVisible();
  await openDetail(panel);
  await expect(panel.locator('[data-testid="recovery-file-row"][data-file-id="user:pdf"]').getByTestId("recovery-local-missing")).toBeVisible();
  expect(retry.filter(isCreate)).toEqual([]);
  expectOneCreation(calls);
});

test("two presses start one run, show it as busy and lock local deletion", async ({ ext }) => {
  const { panel } = await start(ext, "github", { kinds: ["user"] });
  const calls = await remote(panel, "github", { rejectUpload: true });
  await submitPartial(panel);
  await setRemote(panel, { rejectUpload: false, hangUpload: true });
  const mark = calls.length;
  await openDetail(panel);
  const retry = panel.getByTestId("recovery-retry");
  await expect(retry).not.toHaveAttribute("aria-disabled", "true");
  await retry.dblclick();
  await expect(retry).toHaveAttribute("aria-busy", "true");
  await expect(retry).toHaveAttribute("aria-disabled", "true");
  await expect(retry.locator("svg.animate-spin")).toHaveCount(1);
  await expect(panel.getByTestId("recovery-file-progress")).toBeVisible();
  await expect(panel.getByTestId("recovery-delete-local")).toHaveAttribute("aria-disabled", "true");
  await expect.poll(() => ofType(sent(calls, mark), "github.uploadFiles").length).toBe(1);
  await flush(panel);
  expect(ofType(sent(calls, mark), "github.uploadFiles")).toHaveLength(1);
  expectOneCreation(calls);
});

test("a native Web Lock held by another panel makes the retry a silent no-op until it is released", async ({ ext }) => {
  const { panel, id, tabId } = await start(ext, "github", { kinds: ["user"] });
  const calls = await remote(panel, "github", { rejectUpload: true });
  await submitPartial(panel);
  const second = await openRecoveryPanel(ext, tabId); pages.push(second);
  await second.evaluate((id) => new Promise<void>((resolve) => {
    void navigator.locks.request(`bugshot-submission:${id}`, async () => {
      await new Promise<void>((release) => { (window as any).__releaseRecoveryLock = release; resolve(); });
    });
  }), id);
  await setRemote(panel, { rejectUpload: false });
  await panel.bringToFront();
  let mark = calls.length;
  await pressRowRetry(panel);
  await expect(panel.getByTestId("recovery-row-retry").locator("svg.animate-spin")).toHaveCount(0);
  await flush(panel);
  // The product asks for the lock with ifAvailable: nothing may be waiting for it, and the holder still has it.
  const locks = await panel.evaluate(async () => { const q = await navigator.locks.query(); return { held: (q.held ?? []).filter((l) => l.name?.startsWith("bugshot-submission:")).length, pending: (q.pending ?? []).filter((l) => l.name?.startsWith("bugshot-submission:")).length }; });
  expect(locks).toEqual({ held: 1, pending: 0 });
  expect(sent(calls, mark)).toEqual([]);
  expect((await state(panel, id)).journal?.phase).toBe("partial");
  await second.evaluate(() => (window as any).__releaseRecoveryLock());
  await expect.poll(async () => second.evaluate(async () => (await navigator.locks.query()).held?.some((l) => l.name?.startsWith("bugshot-submission:")))).toBe(false);
  mark = calls.length;
  await pressRowRetry(panel);
  await expect(successToast(panel)).toBeVisible();
  expect(ofType(sent(calls, mark), "github.uploadFiles")).toHaveLength(1);
  expectOneCreation(calls);
});

test("Webhook with an unconfirmed creation never offers a retry and keeps the download", async ({ ext }) => {
  const { panel } = await start(ext, "webhook", { kinds: ["user"] });
  const calls = await remote(panel, "webhook", { createStatus: 500 });
  await submitSaved(panel);
  await expect(panel.getByTestId("submit-success-unknown")).toBeVisible();
  await panel.getByTestId("submit-success-unknown").getByRole("button").last().click();
  await panel.getByTestId("tab-issue-list").click();
  await expect(panel.getByTestId("recovery-row-warning")).toBeVisible();
  await expect(panel.getByTestId("recovery-row-retry")).toHaveCount(0);
  await openDetail(panel);
  await expect(panel.getByTestId("recovery-retry")).toHaveCount(0);
  const pending = panel.waitForEvent("download");
  await panel.getByTestId("recovery-file-download").click();
  expect((await pending).suggestedFilename()).toBe("customer.pdf");
  expect(ofType(calls, "webhook.submit")).toHaveLength(1);
  expect(calls.filter((m) => m.type.startsWith("webhook.") && m.type !== "webhook.submit")).toEqual([]);
});

test("Webhook with a rejected creation (HTTP 400) stays a draft that can be submitted again", async ({ ext }) => {
  const { panel, id } = await start(ext, "webhook", { kinds: ["user"] });
  const calls = await remote(panel, "webhook", { createStatus: 400 });
  await submitSaved(panel);
  await expect(panel.locator('[data-sonner-toast][data-type="error"]')).toBeVisible();
  expect(ofType(calls, "webhook.submit")).toHaveLength(1);
  expect((await state(panel, id)).issue.status).toBe("draft");
  expect((await state(panel, id)).journal).toBeUndefined();
  await expect(panel.getByTestId("submit-issue-confirm")).not.toHaveAttribute("aria-disabled", "true");
});
