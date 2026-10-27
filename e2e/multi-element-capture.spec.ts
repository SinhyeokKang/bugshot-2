import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import type { Locator, Page } from "@playwright/test";
import { enterDebug, expect, pickElement, test, waitForPanelFront } from "./fixtures/extension";

async function downloadBytes(panel: Page, button: Locator) {
  await expect(button).toBeVisible();
  await expect(button).not.toHaveAttribute("aria-disabled", "true");
  const [download] = await Promise.all([panel.waitForEvent("download"), button.click()]);
  expect(await download.failure()).toBeNull();
  return { filename: download.suggestedFilename(), bytes: await readFile((await download.path())!) };
}

function decodeLogs(html: string) {
  const encoded = html.match(/<script id="__BUGSHOT_DATA__"[^>]*>([^<]+)<\/script>/)?.[1];
  expect(encoded).toBeTruthy();
  return JSON.parse(gunzipSync(Buffer.from(encoded!, "base64")).toString("utf8"));
}

test.describe.serial("ordered element captures", () => {
  let fixture: Page;
  let panel: Page;
  let tabId: number;
  let ids: string[];
  const items = () => panel.getByTestId("element-shot-item");
  const readIds = () => items().evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.shotId!));

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    tabId = await ext.fixtureTabId(fixture.url());
    panel = await ext.openPanel(tabId);
    await enterDebug(panel);
    await expect(async () => {
      if (!(await panel.getByTestId("drafting-panel").isVisible())) {
        await panel.getByTestId("mode-element-shot").click();
        await pickElement(fixture, panel, "#title", { expectSelection: false });
      }
      await expect(items()).toHaveCount(1, { timeout: 2500 });
    }).toPass({ intervals: [1000, 1500, 2000], timeout: 25000 });
    await panel.getByTestId("draft-title").fill("Ordered captures remain intact");
    await panel.locator('[contenteditable="true"]').first().fill("Stored report body survives downloads.");
  });
  test.afterAll(async ({ ext }) => {
    await panel?.close();
    await fixture?.close();
    await ext.evalInExt(async () => {
      await chrome.storage.local.remove("bugshot-settings");
      const raw = (await chrome.storage.local.get("bugshot-issues"))["bugshot-issues"];
      if (raw) {
        const value = JSON.parse(raw);
        value.state.issues = value.state.issues.filter((issue: { title: string }) => issue.title !== "Ordered captures remain intact");
        await chrome.storage.local.set({ "bugshot-issues": JSON.stringify(value) });
      }
    });
  });

  test("A → B → A appends new IDs and preserves the title", async () => {
    ids = await readIds();
    const addControl = panel.getByTestId("element-shot-add");
    await expect(addControl).toHaveText("");
    await expect(addControl).toHaveAttribute("aria-label", /.+/);
    await expect(addControl.locator("svg.lucide-crosshair")).toHaveCount(1);
    await expect.poll(() => items().first().getByTestId("media-preview-img").evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
    const geometry = await items().first().evaluate(node => {
      const frame = node.getBoundingClientRect();
      return [...node.querySelectorAll("button")].map(button => {
        const box = button.getBoundingClientRect();
        return { width: box.width, height: box.height, bottom: box.bottom, frameBottom: frame.bottom, top: box.top, frameTop: frame.top };
      });
    });
    for (const box of geometry) {
      expect(box.width).toBeGreaterThanOrEqual(32);
      expect(box.height).toBeGreaterThanOrEqual(32);
      expect(box.bottom).toBeLessThanOrEqual(box.frameBottom);
      expect(box.top).toBeGreaterThanOrEqual(box.frameTop);
    }
    await expect(items().getByTestId("element-shot-delete")).toHaveCount(0);
    for (const selector of ["#card", "#title"]) {
      const previous = [...ids];
      const add = panel.getByTestId("element-shot-add");
      await expect(add).not.toHaveAttribute("aria-disabled", "true");
      await add.click();
      await pickElement(fixture, panel, selector, { expectSelection: false });
      await expect(items()).toHaveCount(previous.length + 1);
      ids = await readIds();
      expect(ids.slice(0, -1)).toEqual(previous);
      expect(previous).not.toContain(ids.at(-1));
      await expect(items().last().getByRole("button").first()).toBeFocused();
      await expect(panel.getByTestId("draft-title")).toHaveValue("Ordered captures remain intact");
      await expect(panel.locator('[contenteditable="true"]').first()).toContainText("Stored report body survives downloads.");
    }
    const snapshot = await panel.evaluate(async (id) => (await chrome.storage.session.get(`editor:${id}`))[`editor:${id}`], tabId);
    expect(snapshot.elementShots.map((shot: { id: string }) => shot.id)).toEqual(ids);
    expect(snapshot.elementShots[0].selector).toBe(snapshot.elementShots[2].selector);
    expect(snapshot.elementShots[1].selector).not.toBe(snapshot.elementShots[0].selector);
    expect(snapshot.screenshotRaw).toBeNull();
  });

  test("cancel restores scroll and add-button focus without changing captures", async () => {
    const add = panel.getByTestId("element-shot-add");
    await add.scrollIntoViewIfNeeded();
    const scroll = panel.getByTestId("drafting-panel").locator(".overflow-y-auto").first();
    await add.evaluate(node => node.addEventListener("click", () => {
      (window as unknown as { __returnScroll: number }).__returnScroll = node.closest('[data-testid="drafting-panel"]')!.querySelector(".overflow-y-auto")!.scrollTop;
    }, { once: true, capture: true }));
    await add.click();
    const before = await panel.evaluate(() => (window as unknown as { __returnScroll: number }).__returnScroll);
    await panel.bringToFront();
    await panel.getByTestId("picking-cancel").click();
    await expect(items()).toHaveCount(3);
    await expect(add).toBeFocused();
    expect(await readIds()).toEqual(ids);
    await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBe(before);
  });


  test("injection failure returns focus and preserves captures; closing during append restores drafting", async ({ ext }) => {
    await panel.evaluate(() => {
      const send = chrome.tabs.sendMessage.bind(chrome.tabs);
      const execute = chrome.scripting.executeScript.bind(chrome.scripting);
      (window as unknown as { __restoreInjection: () => void }).__restoreInjection = () => {
        chrome.tabs.sendMessage = send;
        chrome.scripting.executeScript = execute;
      };
      chrome.tabs.sendMessage = ((...args: unknown[]) => {
        if ((args[1] as { type: string }).type === "ping") return Promise.reject(new Error("injected missing content"));
        return (send as (...values: unknown[]) => unknown)(...args);
      }) as typeof chrome.tabs.sendMessage;
      chrome.scripting.executeScript = (() => Promise.reject(new Error("injected policy block"))) as typeof chrome.scripting.executeScript;
    });
    await panel.getByTestId("element-shot-add").click();
    await expect(panel.getByTestId("picker-unavailable-dialog")).toBeVisible();
    await panel.getByTestId("picker-unavailable-ok").click();
    await expect(panel.getByTestId("picker-unavailable-dialog")).toBeHidden();
    await expect(panel.getByTestId("element-shot-add")).toBeFocused();
    expect(await readIds()).toEqual(ids);
    await panel.evaluate(() => (window as unknown as { __restoreInjection: () => void }).__restoreInjection());
    await panel.getByTestId("element-shot-add").click();
    await expect(panel.getByTestId("picking-cancel")).toBeVisible();
    await expect.poll(async () => panel.evaluate(async id => (await chrome.storage.session.get(`editor:${id}`))[`editor:${id}`]?.elementShotPick?.kind, tabId)).toBe("append");
    await panel.close();
    panel = await ext.openPanel(tabId);
    await panel.bringToFront();
    await enterDebug(panel);
    await expect(panel.getByTestId("drafting-panel")).toBeVisible();
    expect(await readIds()).toEqual(ids);
    await expect(panel.getByTestId("draft-title")).toHaveValue("Ordered captures remain intact");
    await expect(panel.locator('[contenteditable="true"]').first()).toContainText("Stored report body survives downloads.");
  });

  test("ESC and navigation while the append panel closes preserve the original draft", async ({ ext }) => {
    await panel.getByTestId("element-shot-add").click();
    await expect(panel.getByTestId("picking-cancel")).toBeVisible();
    await fixture.keyboard.press("Escape");
    await waitForPanelFront(panel);
    await expect(panel.getByTestId("drafting-panel")).toBeVisible();
    expect(await readIds()).toEqual(ids);
    await expect(panel.getByTestId("element-shot-add")).toBeFocused();
    const before = await panel.evaluate(async id => (await chrome.storage.session.get(`editor:${id}`))[`editor:${id}`], tabId);
    await panel.getByTestId("element-shot-add").click();
    await expect.poll(() => panel.evaluate(async id => (await chrome.storage.session.get(`editor:${id}`))[`editor:${id}`]?.elementShotPick?.kind, tabId)).toBe("append");
    await Promise.all([panel.close(), fixture.goto(ext.fixtureUrl("second.html"))]);
    panel = await ext.openPanel(tabId);
    await panel.bringToFront();
    await enterDebug(panel);
    await expect(items()).toHaveCount(3);
    expect(await readIds()).toEqual(ids);
    await expect(panel.getByTestId("draft-title")).toHaveValue("Ordered captures remain intact");
    await expect(panel.locator('[contenteditable="true"]').first()).toContainText("Stored report body survives downloads.");
    const restored = await panel.evaluate(async id => (await chrome.storage.session.get(`editor:${id}`))[`editor:${id}`], tabId);
    expect(restored.elementShots).toEqual(before.elementShots);
    expect(restored.target.url).toBe(before.target.url);
    await fixture.goto(ext.fixtureUrl("basic.html"));
    await panel.bringToFront();
  });

  test("a candidate write rejected after admission preserves image bytes across reopen", async () => {
    const before = await items().getByTestId("media-preview-img").evaluateAll(nodes => nodes.map(node => (node as HTMLImageElement).src));
    await panel.evaluate((id) => {
      const set = chrome.storage.session.set.bind(chrome.storage.session);
      (window as unknown as { __candidateRefused: boolean }).__candidateRefused = false;
      chrome.storage.session.set = (async (values: Record<string, { elementShots?: unknown[] }>) => {
        if (values[`editor:${id}`]?.elementShots?.length === 4) {
          (window as unknown as { __candidateRefused: boolean }).__candidateRefused = true;
          throw new Error("injected quota race after admission");
        }
        return set(values);
      }) as typeof chrome.storage.session.set;
    }, tabId);
    await panel.getByTestId("element-shot-add").click();
    await pickElement(fixture, panel, "#card", { expectSelection: false });
    await expect.poll(() => panel.evaluate(() => (window as unknown as { __candidateRefused: boolean }).__candidateRefused)).toBe(true);
    await expect(panel.getByTestId("drafting-panel")).toBeVisible();
    await expect(panel.getByRole("alertdialog")).toBeVisible();
    await panel.getByRole("alertdialog").getByRole("button").click();
    expect(await readIds()).toEqual(ids);
    await panel.reload();
    await panel.bringToFront();
    await enterDebug(panel);
    await expect(items()).toHaveCount(3);
    expect(await readIds()).toEqual(ids);
    expect(await items().getByTestId("media-preview-img").evaluateAll(nodes => nodes.map(node => (node as HTMLImageElement).src))).toEqual(before);
    await expect(panel.getByTestId("draft-title")).toHaveValue("Ordered captures remain intact");
    await expect(panel.locator('[contenteditable="true"]').first()).toContainText("Stored report body survives downloads.");
  });

  test("annotation changes only its ID; deleting B retains A and A, then forbids final deletion", async () => {
    const original = await items().getByTestId("media-preview-img").evaluateAll(nodes => nodes.map(node => (node as HTMLImageElement).src));
    await items().nth(2).getByTestId("annotation-edit").click();
    const overlay = panel.getByTestId("annotation-overlay");
    await expect(overlay).toBeVisible();
    await panel.getByTestId("annotation-tool-rect").click();
    const canvas = await overlay.locator("canvas").first().boundingBox();
    if (!canvas) throw new Error("Missing annotation canvas");
    await panel.mouse.move(canvas.x + canvas.width * .2, canvas.y + canvas.height * .2);
    await panel.mouse.down();
    await panel.mouse.move(canvas.x + canvas.width * .8, canvas.y + canvas.height * .8, { steps: 10 });
    await panel.mouse.up();
    await expect(panel.getByTestId("annotation-done")).toBeEnabled();
    await panel.getByTestId("annotation-done").click();
    await expect(overlay).toBeHidden();
    await expect(items().nth(2).getByTestId("media-preview-img")).not.toHaveAttribute("src", original[2]);
    for (const i of [0, 1]) await expect(items().nth(i).getByTestId("media-preview-img")).toHaveAttribute("src", original[i]);
    await items().nth(1).getByTestId("element-shot-delete").click();
    await expect(items()).toHaveCount(2);
    expect(await readIds()).toEqual([ids[0], ids[2]]);
    await expect(items().last().getByRole("button").first()).toBeFocused();
    ids = [ids[0], ids[2]];
    // Save/reopen keeps the ordered immutable media, including the annotation.
    const before = await items().getByTestId("media-preview-img").evaluateAll(nodes => nodes.map(node => (node as HTMLImageElement).src));
    await expect.poll(async () => panel.evaluate(async (id) => (await chrome.storage.session.get(`editor:${id}`))[`editor:${id}`]?.elementShots?.length, tabId)).toBe(2);
    await panel.reload();
    await panel.bringToFront();
    await enterDebug(panel);
    await expect(items()).toHaveCount(2);
    expect(await readIds()).toEqual(ids);
    expect(await items().getByTestId("media-preview-img").evaluateAll(nodes => nodes.map(node => (node as HTMLImageElement).src))).toEqual(before);
    await items().first().getByTestId("element-shot-delete").click();
    await expect(items()).toHaveCount(1);
    expect(await readIds()).toEqual([ids[1]]);
    await expect(items().getByTestId("element-shot-delete")).toHaveCount(0);
  });

  test("navigation rejects append and returning to the original page keeps the draft", async ({ ext }) => {
    await fixture.goto(ext.fixtureUrl("second.html"));
    await panel.bringToFront();
    await panel.getByTestId("element-shot-add").click();
    await expect(panel.getByTestId("drafting-panel")).toBeVisible();
    await expect(items()).toHaveCount(1);
    await expect(panel.getByTestId("draft-title")).toHaveValue("Ordered captures remain intact");
    await expect(panel.locator('[contenteditable="true"]').first()).toContainText("Stored report body survives downloads.");
    await fixture.goto(ext.fixtureUrl("basic.html"));
    await panel.bringToFront();
    await panel.getByTestId("element-shot-add").click();
    await pickElement(fixture, panel, "#card", { expectSelection: false });
    await expect(items()).toHaveCount(2);
    await waitForPanelFront(panel);
    await expect.poll(async () => panel.evaluate(async id => (await chrome.storage.session.get(`editor:${id}`))[`editor:${id}`]?.elementShots?.length, tabId)).toBe(2);
    await panel.close();
    // Navigation intentionally replaces recorder state. Seed deterministic persisted logs
    // after that scenario; hydration, confirmation, HTML generation and downloads stay real.
    await ext.evalInExt(async ({ id, url }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("bugshot-video");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = db.transaction("consoleLogs", "readwrite");
      tx.objectStore("consoleLogs").put({ id: "download-log", startedAt: 1000, endedAt: 2000, captured: 1, totalSeen: 1,
        entries: [{ id: "download-entry", level: "log", timestamp: 1500, args: "ordered-capture-download-log", pageUrl: url }] }, `pending:${id}`);
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
      db.close();
    }, { id: tabId, url: fixture.url() });
    panel = await ext.openPanel(tabId);
    await enterDebug(panel);
    await expect(panel.getByTestId("download-logs")).toBeVisible();
    await expect(panel.getByTestId("to-preview")).not.toHaveAttribute("aria-disabled", "true");
    await panel.getByTestId("to-preview").click();
    await expect(panel.getByTestId("back-to-draft")).toBeVisible();
    await expect(items()).toHaveCount(2);
    const dom = panel.locator('[data-testid="env-row"][data-env-label="DOM"]');
    await expect(dom).toContainText("title");
    await expect(dom).toContainText("card");
  });

  test("an open saved detail reloads an annotation saved with the same issue and shot IDs", async ({ ext }) => {
    const observer = await ext.openPanel(tabId);
    try {
      await observer.bringToFront();
      await observer.getByTestId("tab-issue-list").click();
      await observer.getByTestId("issue-row").filter({ hasText: "Ordered captures remain intact" }).click();
      const detail = observer.getByTestId("draft-detail-dialog");
      const saved = detail.getByTestId("element-shot-item");
      await expect(saved).toHaveCount(2);
      const oldIds = await saved.evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.shotId));
      const oldSrc = await saved.nth(1).getByTestId("media-preview-img").getAttribute("src");
      await expect(saved.nth(1).getByTestId("media-preview-img")).toHaveAttribute("src", /^blob:/);
      await panel.bringToFront();
      await panel.getByTestId("back-to-draft").click();
      await items().nth(1).getByTestId("annotation-edit").click();
      const overlay = panel.getByTestId("annotation-overlay");
      await expect(overlay).toBeVisible();
      await panel.getByTestId("annotation-tool-rect").click();
      const box = await overlay.locator("canvas").first().boundingBox();
      if (!box) throw new Error("Missing annotation canvas");
      await panel.mouse.move(box.x + box.width * .2, box.y + box.height * .2);
      await panel.mouse.down();
      await panel.mouse.move(box.x + box.width * .6, box.y + box.height * .6, { steps: 5 });
      await panel.mouse.up();
      await panel.getByTestId("annotation-done").click();
      await expect(overlay).toBeHidden();
      const annotated = await items().nth(1).getByTestId("media-preview-img").getAttribute("src");
      await expect(panel.getByTestId("to-preview")).not.toHaveAttribute("aria-disabled", "true");
      await panel.getByTestId("to-preview").click();
      await expect(panel.getByTestId("back-to-draft")).toBeVisible();
      await observer.bringToFront();
      await expect(saved.nth(1).getByTestId("media-preview-img")).not.toHaveAttribute("src", oldSrc!);
      expect(await saved.evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.shotId))).toEqual(oldIds);
      const downloaded = await downloadBytes(observer, saved.nth(1).getByTestId("download-media"));
      expect(downloaded.bytes).toEqual(Buffer.from(annotated!.split(",")[1], "base64"));
    } finally {
      await observer.close();
      await panel.bringToFront();
    }
  });

  test("live preview and saved draft resubmit transmit identical ordered capture bytes", async () => {
    await panel.evaluate(async () => {
      await chrome.storage.local.set({ "bugshot-settings": JSON.stringify({ version: 12, state: {
        accounts: { webhook: { platform: "webhook", connectedAt: 1, auth: { url: "https://example.com/hook", headers: [], format: "multipart" } } },
        lastSubmitFields: {}, titlePrefix: "",
      } }) });
    });
    const calls: Array<{ type: string; payload: { body: string; environment: unknown[] }; files: Array<{ filename: string; dataUrl: string }> }> = [];
    await panel.exposeFunction("__recordElementSubmission", (request: typeof calls[number]) => { calls.push(request); });
    await panel.addInitScript(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = ((request: { type: string }, callback?: (response: unknown) => void) => {
        if (request.type === "webhook.submit") {
          void (window as unknown as { __recordElementSubmission: (request: unknown) => Promise<void> }).__recordElementSubmission(request).then(() => callback?.({ ok: false, error: "deterministic pre-create rejection", status: 400 }));
          return;
        }
        if (request.type.startsWith("analytics.")) { callback?.({ ok: true }); return; }
        return send(request as never, callback as never);
      }) as typeof chrome.runtime.sendMessage;
    });
    await panel.reload();
    await panel.bringToFront();
    await enterDebug(panel);
    await expect(panel.getByTestId("back-to-draft")).toBeVisible();
    await expect(items()).toHaveCount(2);
    const previewBytes = await items().getByTestId("media-preview-img").evaluateAll(async nodes => Promise.all(nodes.map(async node => {
      const blob = await (await fetch((node as HTMLImageElement).src)).blob();
      return new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(blob); });
    })));
    const liveDownload = await downloadBytes(panel, panel.getByTestId("download-logs"));
    expect(liveDownload.filename).toBe("logs.html");
    const liveLogs = decodeLogs(liveDownload.bytes.toString("utf8"));
    expect(liveLogs.screenshots.map((shot: { dataUrl: string }) => shot.dataUrl)).toEqual(previewBytes);
    expect(liveLogs.screenshot).toBeNull();
    expect(JSON.stringify(liveLogs.report.sections)).toContain("Stored report body survives downloads.");
    expect(JSON.stringify(liveLogs.consoleLog)).toContain("ordered-capture-download-log");
    await panel.getByTestId("issue-submit-open").click();
    await expect(panel.getByTestId("submit-issue-confirm")).toBeEnabled();
    await panel.getByTestId("submit-issue-confirm").click();
    await expect.poll(() => calls.length).toBe(1);
    await expect(panel.getByTestId("submit-issue-confirm")).toBeEnabled();
    expect(calls[0].files.filter(file => file.filename.startsWith("screenshot-")).map(file => file.dataUrl)).toEqual(previewBytes);
    await panel.keyboard.press("Escape");
    await panel.getByTestId("tab-issue-list").click();
    await panel.getByTestId("issue-row").filter({ hasText: "Ordered captures remain intact" }).click();
    const detail = panel.getByTestId("draft-detail-dialog");
    await expect(detail).toBeVisible();
    await expect(detail.getByTestId("element-shot-item")).toHaveCount(2);
    const savedImages = detail.getByTestId("element-shot-item");
    for (let index = 0; index < 2; index++) {
      const image = savedImages.nth(index).getByTestId("media-preview-img");
      await expect(image).toHaveAttribute("src", /^blob:/);
      const source = await image.evaluate(async (node: HTMLImageElement) => {
        const blob = await (await fetch(node.src)).blob();
        return { type: blob.type, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) };
      });
      const downloaded = await downloadBytes(panel, savedImages.nth(index).getByTestId("download-media"));
      const mime = previewBytes[index].split(";")[0].slice(5);
      expect(source.type).toBe(mime);
      expect(downloaded.filename).toBe(`screenshot-${index + 1}.${mime === "image/jpeg" ? "jpg" : mime.split("/")[1]}`);
      expect(downloaded.bytes).toEqual(Buffer.from(source.bytes));
      expect(downloaded.bytes).toEqual(Buffer.from(previewBytes[index].split(",")[1], "base64"));
    }
    const savedDownload = await downloadBytes(panel, detail.getByTestId("download-logs"));
    expect(savedDownload.filename).toBe("logs.html");
    const savedLogs = decodeLogs(savedDownload.bytes.toString("utf8"));
    expect(savedLogs.screenshots).toEqual(liveLogs.screenshots);
    expect(savedLogs.screenshot).toBeNull();
    expect(savedLogs.consoleLog).toEqual(liveLogs.consoleLog);
    expect(savedLogs.report.sections).toEqual(liveLogs.report.sections);
    expect(savedLogs.report.title).toBe(liveLogs.report.title);
    await panel.getByTestId("detail-submit-open").click();
    await expect(panel.getByTestId("submit-issue-confirm")).toBeEnabled();
    await panel.getByTestId("submit-issue-confirm").click();
    await expect.poll(() => calls.length).toBe(2);
    expect(calls[1].files.filter(file => file.filename.startsWith("screenshot-"))).toEqual(calls[0].files.filter(file => file.filename.startsWith("screenshot-")));
    expect(calls[1].payload.environment).toEqual(calls[0].payload.environment);
    for (const call of calls) {
      const logsFile = call.files.find(file => file.filename === "logs.html");
      expect(logsFile).toBeTruthy();
      const submittedLogs = decodeLogs(Buffer.from(logsFile!.dataUrl.split(",")[1], "base64").toString("utf8"));
      expect(submittedLogs.screenshots).toEqual(liveLogs.screenshots);
      expect(submittedLogs.screenshot).toBeNull();
      expect(submittedLogs.consoleLog).toEqual(liveLogs.consoleLog);
      expect(submittedLogs.report.sections).toEqual(liveLogs.report.sections);
      expect(call.payload.body).toContain("title");
      expect(call.payload.body).toContain("card");
    }
    await expect(panel.getByTestId("submit-issue-confirm")).toBeEnabled();
    await panel.keyboard.press("Escape");
    // Remove a real immutable source after opening detail: cached display URLs must not
    // make the HTML action report success with an incomplete image list.
    await panel.evaluate(async () => {
      const raw = (await chrome.storage.local.get("bugshot-issues"))["bugshot-issues"];
      const record = JSON.parse(raw).state.issues.find((entry: { title: string }) => entry.title === "Ordered captures remain intact");
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("bugshot-video");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = db.transaction("images", "readwrite");
      tx.objectStore("images").delete(`${record.id}:${record.elementShots[1].imageSlot}`);
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
      db.close();
    });
    const unexpectedDownloads: string[] = [];
    const onDownload = (download: { suggestedFilename(): string }) => unexpectedDownloads.push(download.suggestedFilename());
    panel.on("download", onDownload);
    await detail.getByTestId("download-logs").click();
    await expect(panel.locator('[data-sonner-toast][data-type="error"]').filter({ hasText: /Local file unavailable|로컬 파일 없음/ })).toBeVisible();
    expect(unexpectedDownloads).toEqual([]);
    panel.off("download", onDownload);
    await panel.evaluate(async () => { await chrome.storage.local.remove("bugshot-settings"); });
  });

});
