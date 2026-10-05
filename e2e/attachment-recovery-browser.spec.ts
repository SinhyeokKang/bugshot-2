import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures/extension";
import type { SubmissionRecoveryMeta } from "../src/types/attachment";

type Extension = Parameters<Parameters<typeof test>[2]>[0]["ext"];
const KEYS = ["bugshot-settings", "bugshot-app-settings", "bugshot-issues"];
const BYTES = "%PDF-1.4\n브라우저 原本 résumé\n%%EOF";
const LONG_NAME = `${"고객보고서_日本語_échec_".repeat(24)}.pdf`;
const pages: Page[] = [];
let ownedId = "";

async function seed(ext: Extension, id: string, phase: "unknown" | "partial" | "draft", count = 1, theme = "light", title = "Browser recovery acceptance") {
  ownedId = id;
  const now = Date.now();
  const issue = {
    id, title, platform: "github", status: phase === "partial" ? "submitted" : "draft",
    createdAt: now, updatedAt: now, pageUrl: "", captureMode: "freeform",
    draft: { title, sections: { description: "Browser acceptance" } },
    snapshot: { before: false, after: false },
    ...(phase === "unknown" ? { attachments: Array.from({ length: count }, (_, n) => ({ id: `file-${n}`, filename: `${n}-${LONG_NAME}`, contentType: "application/pdf", size: Buffer.byteLength(BYTES) })) } : {}),
    ...(phase !== "draft" ? { submissionRecoveryId: `attempt-${id}` } : {}),
    ...(phase === "partial" ? { key: "#42", url: "https://example.com/issues/42" } : {}),
  };
  const meta: SubmissionRecoveryMeta = {
    issueId: id, attemptId: `attempt-${id}`, title: issue.title, platform: "github", phase: phase === "draft" ? "unknown" : phase,
    createdAt: now, updatedAt: now, expiresAt: now + 30 * 86400000,
    ...(phase === "partial" ? { destination: { platform: "github" as const, key: "#42", url: "https://example.com/issues/42", locator: { owner: "owner", repo: "repo", number: "42" } } } : {}),
    files: Array.from({ length: count }, (_, n) => ({ id: `file-${n}`, kind: "user", filename: `${n}-${LONG_NAME}`, contentType: "application/pdf", source: { kind: "original", store: "attachments", key: `${id}:file-${n}` } })),
    results: Array.from({ length: count }, (_, n) => ({ fileId: `file-${n}`, delivery: "failed", presentation: "not-applicable", failure: { stage: "upload", code: "permission", httpStatus: 403 } })),
  };
  await ext.evalInExt(async ({ issue, meta, phase, theme, bytes }) => {
    await chrome.storage.local.set({
      "bugshot-settings": JSON.stringify({ state: { accounts: phase === "draft" ? { github: { platform: "github", connectedAt: 1, defaults: {}, auth: { kind: "oauth", accessToken: "dummy", grantedAt: Date.now() } } } : {}, lastSubmitFields: { github: { owner: "owner", repo: "repo" } }, titlePrefix: "" }, version: 12 }),
      "bugshot-app-settings": JSON.stringify({ state: { locale: "en", theme, attachmentsEnabled: true, issueSections: [{ id: "description", enabled: true, renderAs: "paragraph", builtIn: true }] }, version: 11 }),
      "bugshot-issues": JSON.stringify({ state: { issues: [issue] }, version: 5 }),
    });
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("bugshot-video", 9);
      req.onupgradeneeded = () => { for (const name of ["blobs", "images", "networkLogs", "consoleLogs", "actionLogs", "inlineImages", "inlineImageOrigins", "attachments", "submissionRecovery"]) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name); };
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    if (phase !== "draft") {
      const tx = db.transaction(["submissionRecovery", "attachments"], "readwrite");
      tx.objectStore("submissionRecovery").put(meta, `attempt:${issue.id}`);
      for (const file of meta.files) tx.objectStore("attachments").put(new Blob([bytes], { type: file.contentType }), file.source.key);
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    }
    db.close();
  }, { issue, meta, phase, theme, bytes: BYTES });
  const fixture = await ext.context.newPage(); pages.push(fixture);
  await fixture.goto(ext.fixtureUrl("basic.html"));
  return ext.fixtureTabId("http://127.0.0.1/basic.html");
}

async function openPanel(ext: Extension, tabId: number) {
  const page = await ext.context.newPage(); pages.push(page);
  // Install before app boot: no fake account or badge request may reach a provider.
  await page.addInitScript(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    const state = window as unknown as { recoveryRpc: string[]; releaseCreate?: () => void };
    state.recoveryRpc = [];
    chrome.runtime.sendMessage = ((message: { type?: string }, callback?: (response: unknown) => void) => {
      if (!/^(github|jira|linear|notion|gitlab|asana|clickup|slack|webhook|analytics)\./.test(message.type ?? "")) return original(message, callback as never);
      state.recoveryRpc.push(message.type!);
      if (message.type === "github.submitIssue") {
        state.releaseCreate = () => callback?.({ ok: true, result: { number: 42, url: "https://example.com/issues/42" } });
        return;
      }
      callback?.({ ok: true, result: [] });
    }) as typeof chrome.runtime.sendMessage;
  });
  await page.goto(`chrome-extension://${ext.extensionId}/src/sidepanel/index.html?tabId=${tabId}`);
  await page.bringToFront();
  await page.getByTestId("tab-issue-list").click();
  await expect(page.getByTestId("issue-row")).toBeVisible();
  return page;
}

async function snapshot(page: Page) {
  return page.evaluate(async (id) => {
    const raw = (await chrome.storage.local.get("bugshot-issues"))["bugshot-issues"];
    const issue = JSON.parse(raw).state.issues.find((item: { id: string }) => item.id === id);
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open("bugshot-video"); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const read = (store: string, key: string) => new Promise<any>((resolve, reject) => { const req = db.transaction(store).objectStore(store).get(key); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const meta: SubmissionRecoveryMeta | undefined = await read("submissionRecovery", `attempt:${id}`);
    const blobs = await Promise.all((meta?.files ?? []).map(async (file) => { const blob = await read("attachments", file.source.key); return blob instanceof Blob ? { bytes: await blob.text(), type: blob.type } : null; }));
    db.close();
    return { issue, meta: meta ?? null, blobs };
  }, ownedId);
}

async function enterRecovery(page: Page, key = "Enter") {
  await page.bringToFront();
  const trigger = page.getByTestId("recovery-detail-open");
  await expect(trigger).toHaveAccessibleName(/.+/);
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await page.keyboard.press(key);
  const dialog = page.getByTestId("draft-detail-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("recovery-file-row").first()).toBeVisible();
  await expect(page.getByTestId("detail-submit-open")).toHaveCount(0);
  await expect(page.getByTestId("submit-issue-confirm")).toHaveCount(0);
  await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  return dialog;
}

async function alert(page: Page, testId: string) {
  const trigger = page.getByTestId(testId);
  await expect(trigger).not.toHaveAttribute("aria-disabled", "true");
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  // shadcn AlertDialog footer is cancel followed by confirm, independent of locale.
  await expect(dialog.getByRole("button").first()).toBeFocused();
  return dialog;
}

async function confirmAlert(page: Page, testId: string) {
  const dialog = await alert(page, testId);
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button").last()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
}

async function holdLock(page: Page) {
  await page.evaluate(async (id) => {
    await new Promise<void>((acquired) => {
      void navigator.locks.request(`bugshot-submission:${id}`, async () => {
        await new Promise<void>((release) => { (window as unknown as { releaseRecoveryLock: () => void }).releaseRecoveryLock = release; acquired(); });
      });
    });
  }, ownedId);
}

async function releaseLock(page: Page) {
  await page.evaluate(() => (window as unknown as { releaseRecoveryLock: () => void }).releaseRecoveryLock());
  await expect.poll(() => page.evaluate(async (id) => (await navigator.locks.query()).held?.filter((lock) => lock.name === `bugshot-submission:${id}`).length, ownedId)).toBe(0);
}

async function expectNoRemote(page: Page) {
  const calls = await page.evaluate(() => (window as unknown as { recoveryRpc: string[] }).recoveryRpc);
  // oauth.available only reads bundled configuration; it does not contact a provider.
  expect(calls.filter((type) => !type.endsWith(".oauth.available"))).toEqual([]);
}

async function inBounds(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeInViewport({ ratio: 1 });
  expect(await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const dialog = el.closest('[role="dialog"], [role="alertdialog"]')!.getBoundingClientRect();
    return r.left >= dialog.left && r.right <= dialog.right && r.top >= dialog.top && r.bottom <= dialog.bottom;
  })).toBe(true);
}

test.afterEach(async ({ ext }) => {
  const generatedKeys: string[] = [];
  for (const page of pages) if (!page.isClosed()) generatedKeys.push(...await page.evaluate(() => {
    const meta = (window as unknown as { quotaProbe?: { meta?: SubmissionRecoveryMeta } }).quotaProbe?.meta;
    return meta?.files.filter((file) => file.source.kind === "generated").map((file) => file.source.key) ?? [];
  }).catch(() => []));
  for (const page of pages.splice(0)) if (!page.isClosed()) await page.close();
  if (!ownedId) return;
  await ext.evalInExt(async ({ id, keys, generatedKeys }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open("bugshot-video"); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const tx = db.transaction([...db.objectStoreNames], "readwrite");
    for (const key of generatedKeys) tx.objectStore("submissionRecovery").delete(key);
    for (const name of db.objectStoreNames) {
      const store = tx.objectStore(name); const req = store.openCursor();
      req.onsuccess = () => { const cursor = req.result; if (!cursor) return;
        if (cursor.key === `attempt:${id}` || cursor.key === id || (typeof cursor.key === "string" && cursor.key.startsWith(`${id}:`))) cursor.delete();
        cursor.continue();
      };
    }
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
    await chrome.storage.local.remove(keys);
  }, { id: ownedId, keys: KEYS, generatedKeys });
  ownedId = "";
});

test("native Web Lock rejects recovery mutations across panels and unknown deletion still blocks create", async ({ ext }) => {
  const tabId = await seed(ext, "browser-lock-unknown", "unknown");
  const first = await openPanel(ext, tabId);
  await enterRecovery(first);
  const second = await openPanel(ext, tabId);
  await enterRecovery(second);
  const before = await snapshot(second);
  await holdLock(first);
  for (const action of ["recovery-delete-local", "recovery-confirm-not-registered"]) {
    await confirmAlert(second, action);
    await expect(second.getByTestId("draft-detail-dialog").getByRole("alert")).toBeVisible();
    expect(await snapshot(second)).toEqual(before);
    await expect(second.getByTestId("detail-submit-open")).toHaveCount(0);
  }
  await releaseLock(first);
  await confirmAlert(second, "recovery-delete-local");
  await expect(second.getByTestId("recovery-local-missing")).toHaveCount(1);
  const removed = await snapshot(second);
  expect(removed.meta).toMatchObject({ phase: "unknown", localFilesRemoved: true, attemptId: before.meta!.attemptId, results: before.meta!.results });
  expect(removed.blobs).toEqual([null]);
  expect(removed.issue.submissionRecoveryId).toBe(before.meta!.attemptId);
  await first.bringToFront();
  await expect(first.getByTestId("recovery-local-missing")).toHaveCount(1);
  await first.keyboard.press("Escape");
  await expect(first.getByTestId("recovery-row-warning")).toBeVisible();
  await enterRecovery(first, "Space");
  await expect(first.getByTestId("detail-submit-open")).toHaveCount(0);
  await expectNoRemote(first); await expectNoRemote(second);
});

test("native Web Lock blocks saved submission and real in-flight submission owns the same lock", async ({ ext }) => {
  const tabId = await seed(ext, "browser-lock-submit", "draft");
  const holder = await openPanel(ext, tabId);
  const submitter = await openPanel(ext, tabId);
  await submitter.getByTestId("issue-row").click();
  await submitter.getByTestId("detail-submit-open").click();
  await holdLock(holder);
  const before = await snapshot(submitter);
  const submit = submitter.getByTestId("submit-issue-confirm");
  await expect(submit).not.toHaveAttribute("aria-disabled", "true");
  await submit.click();
  await expect(submitter.locator("[data-sonner-toast]")).toBeVisible();
  expect((await submitter.evaluate(() => (window as unknown as { recoveryRpc: string[] }).recoveryRpc)).filter((type) => type === "github.submitIssue")).toHaveLength(0);
  expect(await snapshot(submitter)).toEqual(before);
  await releaseLock(holder);
  await expect(submit).not.toHaveAttribute("aria-disabled", "true");
  await submit.click();
  await expect.poll(() => submitter.evaluate(() => (window as unknown as { recoveryRpc: string[] }).recoveryRpc.filter((type) => type === "github.submitIssue").length)).toBe(1);
  expect(await holder.evaluate(async (id) => navigator.locks.request(`bugshot-submission:${id}`, { ifAvailable: true }, (lock) => lock === null), ownedId)).toBe(true);
  expect((await snapshot(submitter)).meta?.phase).toBe("creating");
  await submitter.evaluate(() => (window as unknown as { releaseCreate: () => void }).releaseCreate());
  await expect.poll(async () => (await snapshot(submitter)).issue.status).toBe("submitted");
  await expect.poll(() => holder.evaluate(async (id) => navigator.locks.request(`bugshot-submission:${id}`, { ifAvailable: true }, (lock) => !!lock), ownedId)).toBe(true);
  expect((await submitter.evaluate(() => (window as unknown as { recoveryRpc: string[] }).recoveryRpc)).filter((type) => type === "github.submitIssue")).toHaveLength(1);
});

test("keyboard recovery entry, alert focus trapping, cancel and explicit unknown confirmation", async ({ ext }, testInfo) => {
  const tabId = await seed(ext, "browser-keyboard", "unknown");
  const page = await openPanel(ext, tabId);
  const detail = await enterRecovery(page);
  const before = await snapshot(page);
  const dialog = await alert(page, "recovery-delete-local");
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button").last()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button").first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("recovery-delete-local")).toBeFocused();
  expect(await snapshot(page)).toEqual(before);
  await alert(page, "recovery-confirm-not-registered");
  // 새 레이어는 한 렌더 뒤에야 Escape를 받는다(GOTCHAS "DismissableLayer 등록 지연").
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.evaluate(() => {
    (window as unknown as { escapeEvents: unknown[] }).escapeEvents = [];
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") queueMicrotask(() => (window as unknown as { escapeEvents: unknown[] }).escapeEvents.push({ defaultPrevented: event.defaultPrevented, target: (event.target as HTMLElement)?.outerHTML }));
    }, { capture: true, once: true });
  });
  await page.keyboard.press("Escape");
  try {
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByTestId("recovery-confirm-not-registered")).toBeFocused();
  } finally {
    await testInfo.attach("after-alert-escape", { contentType: "application/json", body: JSON.stringify(await page.evaluate(() => ({
      focused: document.activeElement?.outerHTML,
      escapeEvents: (window as unknown as { escapeEvents: unknown[] }).escapeEvents,
      dialogs: [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].map((el) => ({ role: el.getAttribute("role"), state: el.getAttribute("data-state"), text: el.textContent })),
    })), null, 2) });
  }
  expect(await snapshot(page)).toEqual(before);
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);
  await expect(page.getByTestId("recovery-detail-open")).toBeFocused();
  await enterRecovery(page, "Space");
  await confirmAlert(page, "recovery-confirm-not-registered");
  await expect(detail).toHaveCount(0);
  await expect(page.getByTestId("recovery-row-warning")).toHaveCount(0);
  const after = await snapshot(page);
  expect(after.meta).toBeNull();
  expect(after.issue.status).toBe("draft");
  expect(after.issue.submissionRecoveryId).toBeUndefined();
  await expectNoRemote(page);
});

for (const theme of ["light", "dark"]) test(`400px ${theme} recovery keeps multilingual names and actions within scrollable bounds`, async ({ ext }, testInfo) => {
  const tabId = await seed(ext, `browser-layout-${theme}`, "partial", 10, theme);
  const page = await openPanel(ext, tabId);
  await page.setViewportSize({ width: 400, height: 720 });
  expect(await page.locator("html").evaluate((el) => el.classList.contains("dark"))).toBe(theme === "dark");
  await expect(page.getByTestId("recovery-detail-open")).toBeInViewport({ ratio: 1 });
  const detail = await enterRecovery(page);
  const before = await snapshot(page);
  const scroll = detail.locator(".overflow-y-auto");
  expect(await scroll.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect(page.getByTestId("recovery-file-row")).toHaveCount(10);
  for (let n = 0; n < 10; n++) {
    const row = page.getByTestId("recovery-file-row").nth(n);
    await expect(row).toHaveAttribute("data-state", "failed");
    const name = row.locator("[title]");
    await expect(name).toHaveAttribute("title", `${n}-${LONG_NAME}`);
    expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await inBounds(row.getByTestId("recovery-file-download"));
  }
  await inBounds(page.getByTestId("recovery-delete-local"));
  await inBounds(detail.locator('a[href="https://example.com/issues/42"]'));
  expect(await detail.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await scroll.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const warning = page.getByTestId("recovery-row-warning");
  await expect(warning.locator("svg")).toHaveCount(1);
  await expect(warning).toHaveText(/\S/);
  await page.screenshot({ path: testInfo.outputPath(`recovery-${theme}-detail.png`) });
  const dialog = await alert(page, "recovery-delete-local");
  for (const button of await dialog.getByRole("button").all()) await inBounds(button);
  await page.screenshot({ path: testInfo.outputPath(`recovery-${theme}.png`) });
  await page.keyboard.press("Escape");
  expect(await snapshot(page)).toEqual(before);
  await expectNoRemote(page);
});

// #250: a needs-attention count widened the status tabs until Draft scrolled out of view.
// #249: the recovery detail title ran under the dialog close button.
test("400px partial record keeps the Draft filter visible and a long recovery title clear of the close button", async ({ ext }) => {
  const title = `${"Very long recovery title for layout ".repeat(4)}end`;
  const tabId = await seed(ext, "browser-layout-title", "partial", 1, "light", title);
  const page = await openPanel(ext, tabId);
  await page.setViewportSize({ width: 400, height: 720 });
  await expect(page.getByTestId("filter-submitted")).toContainText("(1)");
  const draft = page.getByTestId("filter-draft");
  await expect(draft).toBeInViewport({ ratio: 1 });
  expect(await draft.evaluate((el) => {
    const box = el.getBoundingClientRect(); const row = el.closest(".overflow-x-auto")!.getBoundingClientRect();
    return box.left >= row.left && box.right <= row.right;
  })).toBe(true);
  const detail = await enterRecovery(page);
  const heading = detail.getByRole("heading", { name: title });
  const close = detail.locator("button").filter({ has: page.locator(".sr-only") });
  await expect(close).toHaveCount(1);
  const c = (await close.boundingBox())!;
  // Measure the rendered text, not the element box: the fix is padding, which the box includes.
  const lines = await heading.evaluate((el) => { const range = document.createRange(); range.selectNodeContents(el); return [...range.getClientRects()].map((r) => ({ top: r.top, bottom: r.bottom, right: r.right })); });
  // Premise: the title wraps, so its first line really reaches the dialog's right edge.
  expect(new Set(lines.map((l) => Math.round(l.top))).size).toBeGreaterThan(1);
  for (const line of lines) expect(line.bottom <= c.y || line.top >= c.y + c.height || line.right <= c.x).toBe(true);
});

async function originalDraftSources(page: Page) {
  return page.evaluate(async (id) => {
    const issue = JSON.parse((await chrome.storage.local.get("bugshot-issues"))["bugshot-issues"]).state.issues.find((item: { id: string }) => item.id === id);
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open("bugshot-video"); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const read = (store: string, key: string) => new Promise<any>((resolve, reject) => { const req = db.transaction(store).objectStore(store).get(key); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const attachments = await Promise.all(issue.attachments.map(async (file: { id: string }) => {
      const blob: Blob = await read("attachments", `${id}:${file.id}`);
      return { id: file.id, bytes: await blob.text(), type: blob.type };
    }));
    const consoleLog = await read("consoleLogs", issue.consoleLogBlobKey);
    const recoveryKeys = await new Promise<IDBValidKey[]>((resolve, reject) => { const req = db.transaction("submissionRecovery").objectStore("submissionRecovery").getAllKeys(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    db.close();
    return { issue, attachments, consoleLog, recoveryKeys };
  }, ownedId);
}

for (const entrance of ["live", "saved"] as const) test(`${entrance} submission rolls back generated-blob quota failure before external calls`, async ({ ext }) => {
  const tabId = await seed(ext, `browser-quota-seed-${entrance}`, "draft");
  const page = await openPanel(ext, tabId);
  const fixture = pages[0];
  await page.getByTestId("tab-debug").click();
  await page.getByTestId("subtab-console").click();
  await expect(async () => {
    await fixture.evaluate(() => console.error("browser-quota-console-marker"));
    await expect(page.locator("[data-entry-id]").filter({ hasText: "browser-quota-console-marker" }).first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  await page.getByTestId("subtab-issue").click();
  await page.getByTestId("mode-freeform").click();
  const title = `Quota rollback ${entrance}`;
  await page.getByTestId("draft-title").fill(title);
  await page.getByTestId("attachment-input").setInputFiles({ name: "quota-source.pdf", mimeType: "application/pdf", buffer: Buffer.from(BYTES) });
  await expect(page.getByTestId("attachment-item")).toHaveCount(1);
  await expect(page.getByTestId("logs-attach-switch")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("to-preview")).not.toHaveAttribute("aria-disabled", "true");
  await page.getByTestId("to-preview").click();
  await expect.poll(async () => page.evaluate(async (title) => JSON.parse((await chrome.storage.local.get("bugshot-issues"))["bugshot-issues"]).state.issues.find((item: { title: string }) => item.title === title)?.id, title)).toBeTruthy();
  ownedId = await page.evaluate(async (title) => JSON.parse((await chrome.storage.local.get("bugshot-issues"))["bugshot-issues"]).state.issues.find((item: { title: string }) => item.title === title).id, title);
  if (entrance === "saved") {
    await page.reload();
    await page.getByTestId("tab-issue-list").click();
    await page.getByTestId("issue-row").filter({ hasText: title }).click();
    await page.getByTestId("detail-submit-open").click();
  } else {
    await page.getByTestId("issue-submit-open").click();
  }
  const before = await originalDraftSources(page);
  expect(before.attachments).toHaveLength(1);
  expect(before.attachments[0]).toMatchObject({ bytes: BYTES, type: "application/pdf" });
  expect(before.consoleLog.entries.some((entry: { args: unknown[] }) => JSON.stringify(entry.args).includes("browser-quota-console-marker"))).toBe(true);
  expect(before.recoveryKeys).toEqual([]);
  await page.evaluate(() => {
    const nativePut = IDBObjectStore.prototype.put;
    const probe = { meta: null as SubmissionRecoveryMeta | null, rejected: [] as { key: string; type: string; size: number }[] };
    (window as unknown as { quotaProbe: typeof probe }).quotaProbe = probe;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (this.name === "submissionRecovery") {
        if (value instanceof Blob) {
          probe.rejected.push({ key: String(key), type: value.type, size: value.size });
          throw new DOMException("Deterministic recovery quota exhaustion", "QuotaExceededError");
        }
        probe.meta = structuredClone(value) as SubmissionRecoveryMeta;
      }
      return nativePut.call(this, value, key);
    };
  });
  const submit = page.getByTestId("submit-issue-confirm");
  await expect(submit).not.toHaveAttribute("aria-disabled", "true");
  await submit.click();
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toBeVisible();
  const probe = await page.evaluate(() => (window as unknown as { quotaProbe: { meta: SubmissionRecoveryMeta; rejected: { key: string; type: string; size: number }[] } }).quotaProbe);
  expect(probe.meta).toMatchObject({ issueId: ownedId, phase: "prepared" });
  expect(probe.rejected).toHaveLength(1);
  expect(probe.rejected[0]).toMatchObject({ key: `file:${probe.meta.attemptId}:logs`, type: "text/html" });
  expect(probe.rejected[0].size).toBeGreaterThan(0);
  const after = await originalDraftSources(page);
  expect(after.recoveryKeys).toEqual([]);
  expect(after.issue).toMatchObject({ status: "draft", title, attachments: before.issue.attachments, draft: before.issue.draft });
  expect(after.issue.submissionRecoveryId).toBeUndefined();
  expect(after.attachments).toEqual(before.attachments);
  expect(after.consoleLog).toEqual(before.consoleLog);
  expect((await page.evaluate(() => (window as unknown as { recoveryRpc: string[] }).recoveryRpc)).filter((type) => /\.(upload|submit|create|update)/.test(type))).toEqual([]);
  await expect(page.getByTestId("submit-success-partial")).toHaveCount(0);
  await expect(page.getByTestId("submit-success-unknown")).toHaveCount(0);
  await expect(submit).not.toHaveAttribute("aria-disabled", "true");
});
