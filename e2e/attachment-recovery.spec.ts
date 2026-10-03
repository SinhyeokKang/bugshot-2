import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { enterDebug, expect, test } from "./fixtures/extension";
import { setup, openRecoveryPanel, installRpc, submitSaved, openRecovery, cleanup, state, creates, PDF, REMOTE, type Provider } from "./fixtures/recovery";

const pages: Page[] = [];
const ids: string[] = [];
async function start(ext: Parameters<typeof setup>[0], provider: Provider, options: Parameters<typeof setup>[3] = {}) {
  const id = `recovery-${ids.length}-${Date.now()}`;
  const result = await setup(ext, id, provider, options);
  pages.push(result.panel, result.fixture); ids.push(id);
  return result;
}
test.afterEach(async ({ ext }) => { await cleanup(ext, pages.splice(0), ids.splice(0)); });
async function acknowledge(panel: Page) {
  await panel.getByTestId("submit-success-partial").getByRole("button").last().click();
}

for (const kind of ["inline", "user", "logs", "capture"] as const) {
  test(`GitHub independent ${kind} failure retains only incomplete bytes`, async ({ ext }) => {
    const { panel, id } = await start(ext, "github", { kinds: ["inline", "user", "logs", "capture"] });
    const fileId = kind === "inline" ? "inline:recover-image" : kind === "capture" ? "capture:screenshot" : kind === "user" ? "user:pdf" : "logs";
    const calls = await installRpc(panel, "github", { failIds: [fileId] });
    await submitSaved(panel);
    await expect(panel.getByTestId("submit-success-partial")).toBeVisible();
    await expect(panel.locator('[data-testid="recovery-file-row"][data-state="failed"]')).toHaveCount(1);
    const failed = panel.locator(`[data-testid="recovery-file-row"][data-file-id="${fileId}"]`);
    await expect(failed.getByTestId("recovery-file-download")).toBeVisible();
    expect(creates(calls, "github")).toHaveLength(1);
    expect(creates(calls, "github")[0].payload?.body).not.toContain("inline:");
    const saved = await state(panel, id);
    expect(saved.journal?.phase).toBe("partial");
    expect(saved.sources.filter((f) => f.bytes !== null).map((f) => f.id)).toEqual([fileId]);
    expect(saved.issue.status).toBe("submitted");
    expect(saved.journal?.destination?.key).toBe("#42");
    await acknowledge(panel);
    await panel.getByTestId("filter-draft").click();
    await expect(panel.getByTestId("issue-row")).toHaveCount(0);
    await panel.getByTestId("filter-submitted").click();
    await openRecovery(panel);
    await expect(panel.getByTestId("recovery-retry")).toHaveCount(0);
    if (kind === "user") {
      await expect(failed).toContainText("customer.pdf");
      await expect(panel.getByTestId("draft-detail-dialog")).not.toContainText("size limit");
    }
    await panel.keyboard.press("Escape");
    expect(creates(calls, "github")).toHaveLength(1);
  });
}

for (const provider of ["clickup", "asana", "slack"] as const) {
  test(`${provider} post-create upload rejection survives acknowledgement and detail`, async ({ ext }) => {
    const { panel, id } = await start(ext, provider);
    const calls = await installRpc(panel, provider, { rejectUpload: true });
    await submitSaved(panel);
    await expect(panel.getByTestId("submit-success-partial")).toBeVisible();
    expect(creates(calls, provider)).toHaveLength(1);
    if (provider === "slack") {
      // Staged upload: the rejected allocation must stop bytes and complete for that file.
      expect(calls.filter((m) => m.type === "slack.requestFileUpload").length).toBeGreaterThan(0);
      expect(calls.filter((m) => /^slack\.(sendFileUpload|completeFileUploads)$/.test(m.type))).toEqual([]);
    }
    await acknowledge(panel);
    if (provider === "slack") {
      const promote = panel.getByTestId("promote-issue");
      await expect(promote).toHaveAttribute("aria-disabled", "true");
      await promote.click({ force: true });
      await expect(panel.getByTestId("submit-confirm")).toHaveCount(0);
      expect(creates(calls, provider)).toHaveLength(1);
    }
    await openRecovery(panel);
    await panel.keyboard.press("Escape");
    await panel.reload();
    await openRecovery(panel);
    expect(creates(calls, provider)).toHaveLength(1);
    expect((await state(panel, id)).journal?.destination?.platform).toBe(provider);
  });
}

test("native PDF download preserves bytes and state after panel reopen and disconnected account", async ({ ext }) => {
  const { panel, id, tabId } = await start(ext, "github");
  const calls = await installRpc(panel, "github", { failIds: ["user:"] });
  await submitSaved(panel);
  await expect(panel.getByTestId("submit-success-partial")).toBeVisible();
  const before = await state(panel, id);
  await panel.close();
  const reopened = await openRecoveryPanel(ext, tabId); pages.push(reopened);
  await installRpc(reopened, "github", {}, calls);
  await reopened.evaluate(async () => { const key = "bugshot-settings"; const raw = JSON.parse((await chrome.storage.local.get(key))[key]); raw.state.accounts = {}; await chrome.storage.local.set({ [key]: JSON.stringify(raw) }); });
  await reopened.reload();
  await openRecovery(reopened);
  const pending = reopened.waitForEvent("download");
  await reopened.getByTestId("recovery-file-download").click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("customer.pdf");
  const downloaded = await readFile((await download.path())!);
  expect(downloaded).toEqual(Buffer.from(PDF));
  expect(before.sources.find((s) => s.id === "user:pdf")?.type).toBe("application/pdf");
  expect((await state(reopened, id)).journal).toEqual(before.journal);
  expect(creates(calls, "github")).toHaveLength(1);
});

for (const kind of ["inline", "video", "capture", "user", "logs"] as const) {
  test(`missing ${kind} source blocks all external submission messages`, async ({ ext }) => {
    const { panel, id } = await start(ext, "github", { kinds: [kind], missing: kind });
    const calls = await installRpc(panel, "github");
    await submitSaved(panel);
    await expect(panel.locator('[data-sonner-toast][data-type="error"]')).toBeVisible();
    expect(calls.filter((m) => /\.(uploadFiles|submitIssue)$/.test(m.type))).toEqual([]);
    expect((await state(panel, id)).issue.status).toBe("draft");
    expect((await state(panel, id)).journal).toBeUndefined();
  });
}

test("logs OFF excludes missing logs and leaves only the failed image", async ({ ext }) => {
  const { panel, id } = await start(ext, "github", { kinds: ["capture", "logs"], missing: "logs", logsOff: true });
  const calls = await installRpc(panel, "github", { failIds: ["capture:"] });
  await submitSaved(panel);
  await expect(panel.getByTestId("submit-success-partial")).toBeVisible();
  await expect(panel.getByTestId("recovery-file-row")).toHaveCount(1);
  expect((await state(panel, id)).journal?.files.map((f) => f.kind)).toEqual(["capture"]);
  expect(creates(calls, "github")).toHaveLength(1);
});

test("pending create reload becomes unknown; cancellation preserves it and confirmation restores draft", async ({ ext }, testInfo) => {
  const { panel, id } = await start(ext, "github");
  const calls = await installRpc(panel, "github", { pending: "create" });
  await submitSaved(panel);
  await expect.poll(() => creates(calls, "github").length).toBe(1);
  await expect.poll(async () => (await state(panel, id)).journal?.phase).toBe("creating");
  await panel.reload();
  await openRecovery(panel);
  const before = await state(panel, id);
  expect(before.journal?.phase).toBe("unknown");
  const trigger = panel.getByTestId("recovery-confirm-not-registered");
  await trigger.focus(); await panel.keyboard.press("Enter");
  await expect(panel.getByRole("alertdialog")).toBeVisible();
  await expect(panel.getByRole("alertdialog").getByRole("button").first()).toBeFocused();
  await panel.keyboard.press("Escape");
  await expect(panel.getByRole("alertdialog")).toHaveCount(0);
  await expect(panel.getByTestId("draft-detail-dialog")).toBeVisible();
  await expect(trigger).toBeFocused();
  expect((await state(panel, id)).journal).toEqual(before.journal);
  expect(creates(calls, "github")).toHaveLength(1);
  await panel.keyboard.press("Enter");
  await expect(panel.getByRole("alertdialog").getByRole("button").first()).toBeFocused();
  await panel.keyboard.press("Enter");
  await expect(trigger).toBeFocused();
  expect((await state(panel, id)).journal).toEqual(before.journal);
  await trigger.click();
  await panel.getByRole("alertdialog").getByRole("button").last().click();
  await expect(panel.getByTestId("draft-detail-dialog")).toBeHidden();
  await testInfo.attach("unknown-confirm-focus", { contentType: "application/json", body: JSON.stringify(await panel.evaluate(() => ({ tag: document.activeElement?.tagName, testid: document.activeElement?.getAttribute("data-testid"), connected: document.activeElement?.isConnected }))) });
  await panel.getByTestId("filter-draft").click();
  await expect(panel.getByTestId("issue-row")).toBeVisible();
  expect((await state(panel, id)).journal).toBeUndefined();
  expect(creates(calls, "github")).toHaveLength(1);
});

test("crashed created checkpoint retains destination and forbids another create", async ({ ext }) => {
  const { panel, id } = await start(ext, "jira");
  const calls = await installRpc(panel, "jira", { pending: "upload" });
  await submitSaved(panel);
  await expect.poll(async () => (await state(panel, id)).journal?.phase).toBe("created");
  const before = await state(panel, id);
  await panel.reload();
  await openRecovery(panel);
  const after = await state(panel, id);
  expect(after.journal?.destination).toEqual(before.journal?.destination);
  expect(after.issue.key).toBe("BUG-42");
  expect(creates(calls, "jira")).toHaveLength(1);
  await expect(panel.getByTestId("recovery-confirm-not-registered")).toHaveCount(0);
});

for (const slackFailure of ["thread", "permalink"] as const) {
  test(`zero-file Slack ${slackFailure} failure retains real parent across restart`, async ({ ext }) => {
    const { panel, id } = await start(ext, "slack", { kinds: [], logsOff: true });
    const calls = await installRpc(panel, "slack", { slackFailure });
    await submitSaved(panel);
    await expect(panel.getByTestId("submit-success-partial")).toBeVisible();
    const before = await state(panel, id);
    expect(before.journal?.files).toEqual([]);
    expect(before.journal?.submissionFailure).toBeDefined();
    expect(before.journal?.destination?.locator).toEqual({ channelId: "channel", ts: "42.1" });
    await panel.reload();
    await openRecovery(panel);
    await expect(panel.getByTestId("recovery-file-row")).toHaveCount(0);
    await expect(panel.getByTestId("recovery-confirm-not-registered")).toHaveCount(0);
    expect((await state(panel, id)).journal?.destination).toEqual(before.journal?.destination);
    expect(creates(calls, "slack")).toHaveLength(1);
  });
}

test("successful submission keeps the normal success view and no warning", async ({ ext }) => {
  const { panel, id } = await start(ext, "github");
  const calls = await installRpc(panel, "github");
  await submitSaved(panel);
  await expect(panel.locator(`a[href="${REMOTE}"]`)).toBeVisible();
  await expect(panel.getByTestId("submit-success-partial")).toHaveCount(0);
  await expect.poll(async () => (await state(panel, id)).issue.submissionRecoveryId).toBeUndefined();
  expect((await state(panel, id)).journal).toBeUndefined();
  await panel.reload();
  await panel.getByTestId("tab-issue-list").click();
  await expect(panel.getByTestId("recovery-row-warning")).toHaveCount(0);
  expect(creates(calls, "github")).toHaveLength(1);
});

for (const mode of ["expiry", "missing"] as const) {
  test(`${mode} keeps a recovery warning and removes the download action`, async ({ ext }) => {
    const { panel, id } = await start(ext, "github");
    const calls = await installRpc(panel, "github", { failIds: ["user:"] });
    await submitSaved(panel);
    await expect(panel.getByTestId("submit-success-partial")).toBeVisible();
    await panel.evaluate(async ({ id, mode }) => {
      const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open("bugshot-video"); r.onsuccess = () => resolve(r.result); });
      const tx = db.transaction(["submissionRecovery", "attachments"], "readwrite");
      if (mode === "missing") tx.objectStore("attachments").delete(`${id}:pdf`);
      else {
        const store = tx.objectStore("submissionRecovery"); const r = store.get(`attempt:${id}`);
        r.onsuccess = () => store.put({ ...r.result, createdAt: Date.now() - 31 * 86400000, expiresAt: Date.now() - 86400000 }, `attempt:${id}`);
      }
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
    }, { id, mode });
    await panel.reload();
    await openRecovery(panel);
    await expect(panel.getByTestId("recovery-local-missing")).toBeVisible();
    await expect(panel.getByTestId("recovery-file-download")).toHaveCount(0);
    expect((await state(panel, id)).sources[0].bytes).toBeNull();
    expect(creates(calls, "github")).toHaveLength(1);
  });
}

test("native Chrome Web Lock held by another page prevents creation until released", async ({ ext }) => {
  const { panel, id, tabId } = await start(ext, "github");
  const second = await openRecoveryPanel(ext, tabId); pages.push(second);
  const calls = await installRpc(panel, "github");
  await second.evaluate((id) => new Promise<void>((resolve) => {
    void navigator.locks.request(`bugshot-submission:${id}`, async () => {
      await new Promise<void>((release) => { (window as any).__releaseRecoveryLock = release; resolve(); });
    });
  }), id);
  await submitSaved(panel);
  await expect(panel.locator('[data-sonner-toast][data-type="error"]')).toBeVisible();
  expect(creates(calls, "github")).toHaveLength(0);
  expect((await state(panel, id)).journal).toBeUndefined();
  await second.evaluate(() => (window as any).__releaseRecoveryLock());
  await expect.poll(async () => second.evaluate(async () => (await navigator.locks.query()).held?.some((l) => l.name?.startsWith("bugshot-submission:")))).toBe(false);
  await expect(panel.getByTestId("submit-issue-confirm")).not.toHaveAttribute("aria-disabled", "true");
  await panel.getByTestId("submit-issue-confirm").click();
  await expect.poll(() => creates(calls, "github").length).toBe(1);
  await expect.poll(async () => (await state(panel, id)).issue.status).toBe("submitted");
});

test("explicit local deletion leaves the remote issue and clears warning without external writes", async ({ ext }, testInfo) => {
  const { panel, id } = await start(ext, "github");
  const calls = await installRpc(panel, "github", { failIds: ["user:"] });
  await submitSaved(panel);
  await expect(panel.getByTestId("submit-success-partial")).toBeVisible();
  await acknowledge(panel); await openRecovery(panel);
  const before = calls.length;
  await panel.getByTestId("recovery-delete-local").click();
  await panel.getByRole("alertdialog").getByRole("button").last().click();
  await expect(panel.getByTestId("draft-detail-dialog")).toBeHidden();
  await expect(panel.getByTestId("recovery-row-warning")).toHaveCount(0);
  const after = await state(panel, id);
  expect(after.issue.status).toBe("submitted"); expect(after.issue.key).toBe("#42");
  expect(after.journal).toBeUndefined();
  expect(calls.slice(before).filter((m) => /\.(submitIssue|uploadFiles|update)/.test(m.type))).toEqual([]);
  await testInfo.attach("local-delete-focus", { contentType: "application/json", body: JSON.stringify(await panel.evaluate(() => ({ tag: document.activeElement?.tagName, testid: document.activeElement?.getAttribute("data-testid"), connected: document.activeElement?.isConnected }))) });
});

for (const locale of ["en", "ko", "fr"] as const) {
  test(`${locale} dark narrow recovery bounds and keyboard dialog focus`, async ({ ext }) => {
    const { panel } = await start(ext, "github", { locale, theme: "dark", title: "Long title 제목 titre ".repeat(12), filename: `${"customer_고객_日本語_échec_".repeat(16)}.pdf` });
    await panel.setViewportSize({ width: 400, height: 820 });
    await installRpc(panel, "github", { failIds: ["user:"] });
    await submitSaved(panel);
    await expect(panel.getByTestId("submit-success-partial")).toBeVisible();
    await acknowledge(panel);
    const trigger = panel.getByTestId("recovery-detail-open");
    await expect(trigger).toHaveAttribute("aria-label", /\S/);
    await trigger.focus(); await panel.keyboard.press("Enter");
    const dialog = panel.getByTestId("draft-detail-dialog");
    await expect(dialog).toBeVisible();
    await expect(panel.locator("html")).toHaveClass(/dark/);
    const bounds = await dialog.evaluate((el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: innerWidth, overflow: el.scrollWidth - el.clientWidth }; });
    expect(bounds.left).toBeGreaterThanOrEqual(0); expect(bounds.right).toBeLessThanOrEqual(bounds.width); expect(bounds.overflow).toBeLessThanOrEqual(1);
    await expect(panel.getByTestId("recovery-file-download")).toBeVisible();
    const deletion = panel.getByTestId("recovery-delete-local");
    await deletion.focus(); await panel.keyboard.press("Enter");
    await expect(panel.getByRole("alertdialog")).toBeVisible();
    await panel.getByRole("alertdialog").getByRole("button").first().focus();
    await panel.keyboard.press("Enter");
    await expect(deletion).toBeFocused();
    await panel.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}

for (const provider of ["asana", "notion"] as const) {
  test(`${provider} generated download matches uploaded MIME extension and frozen bytes`, async ({ ext }) => {
    const { panel, id } = await start(ext, provider, { kinds: provider === "asana" ? ["capture"] : ["logs"], webp: provider === "asana" });
    const calls = await installRpc(panel, provider, provider === "asana" ? { rejectUpload: true } : { failIds: ["logs"] });
    await submitSaved(panel);
    await expect(panel.getByTestId("submit-success-partial")).toBeVisible();
    const saved = await state(panel, id);
    const source = saved.sources[0]; const file = saved.journal!.files[0];
    expect(file.source.kind).toBe("generated");
    expect(file.contentType).toBe(provider === "asana" ? "image/jpeg" : "application/zip");
    expect(file.filename).toMatch(provider === "asana" ? /\.jpg$/ : /\.zip$/);
    const upload = calls.find((m) => m.type === (provider === "asana" ? "asana.uploadFiles" : "notion.uploadFile"))!;
    const dataUrl = provider === "asana" ? upload.files![0].dataUrl : upload.dataUrl;
    expect([...Buffer.from(dataUrl.split(",")[1], "base64")]).toEqual(source.bytes);
    const pending = panel.waitForEvent("download");
    await panel.getByTestId("recovery-file-download").click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(file.filename);
    expect([...await readFile((await download.path())!)]).toEqual(source.bytes);
    expect(source.bytes!.slice(0, 2)).toEqual(provider === "asana" ? [255, 216] : [80, 75]);
  });
}

test("Jira initial body remains safe after every upload is rejected", async ({ ext }) => {
  const { panel } = await start(ext, "jira", { kinds: ["inline", "capture", "logs"] });
  const calls = await installRpc(panel, "jira", { rejectUpload: true });
  await submitSaved(panel);
  await expect(panel.getByTestId("submit-success-partial")).toBeVisible();
  // The browser hands a private ADF template to the split background create route;
  // the real handler's external safe-body boundary is covered by jiraSubmitIssue.test.ts.
  expect(creates(calls, "jira")).toHaveLength(1);
  expect(calls.filter((m) => m.type === "jira.uploadAttachment")).toHaveLength(3);
  expect(calls.filter((m) => m.type === "jira.updateIssueDescription")[0].uploads).toEqual([]);
  await expect(panel.locator('[data-testid="recovery-file-row"][data-state="failed"]')).toHaveCount(3);
});

for (const missing of [false, true]) {
  test(`live editor submission ${missing ? "blocks missing PDF" : "shows independent PDF recovery"}`, async ({ ext }) => {
    const { panel } = await start(ext, "github", { kinds: [] });
    const calls = await installRpc(panel, "github", { failIds: ["user:"] });
    await enterDebug(panel);
    await panel.getByTestId("mode-freeform").click();
    await panel.getByTestId("draft-title").fill("Live recovery acceptance");
    await panel.getByTestId("attachment-input").setInputFiles({ name: "live.pdf", mimeType: "application/pdf", buffer: Buffer.from(PDF) });
    await expect(panel.getByTestId("attachment-item")).toHaveCount(1);
    await expect(panel.getByTestId("to-preview")).not.toHaveAttribute("aria-disabled", "true");
    await panel.getByTestId("to-preview").click();
    const live = await panel.evaluate(async () => JSON.parse((await chrome.storage.local.get("bugshot-issues"))["bugshot-issues"]).state.issues.find((i: any) => i.title === "Live recovery acceptance"));
    ids.push(live.id);
    if (missing) await panel.evaluate(async ({ id, fileId }) => {
      const db = await new Promise<IDBDatabase>((resolve) => { const req = indexedDB.open("bugshot-video"); req.onsuccess = () => resolve(req.result); });
      const tx = db.transaction("attachments", "readwrite"); tx.objectStore("attachments").delete(`${id}:${fileId}`);
      await new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); }); db.close();
    }, { id: live.id, fileId: live.attachments[0].id });
    await panel.getByTestId("issue-submit-open").click();
    await expect(panel.getByTestId("submit-issue-confirm")).not.toHaveAttribute("aria-disabled", "true");
    await panel.getByTestId("submit-issue-confirm").click();
    if (missing) {
      await expect(panel.locator('[data-sonner-toast][data-type="error"]')).toBeVisible();
      expect(calls.filter((m) => /\.(submitIssue|uploadFiles)$/.test(m.type))).toEqual([]);
      expect((await state(panel, live.id)).issue.status).toBe("draft");
    } else {
      await expect(panel.getByTestId("submit-success-partial")).toBeVisible();
      const failed = panel.locator('[data-testid="recovery-file-row"][data-state="failed"]');
      await expect(failed).toHaveCount(1); await expect(failed).toContainText("live.pdf");
      expect(creates(calls, "github")).toHaveLength(1);
    }
  });
}
