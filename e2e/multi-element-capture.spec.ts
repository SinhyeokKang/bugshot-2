import type { Page } from "@playwright/test";
import { enterDebug, expect, pickElement, test, waitForPanelFront } from "./fixtures/extension";

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
    await expect.poll(() => items().first().getByTestId("media-preview-img").evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
    const geometry = await items().first().evaluate(node => {
      const image = node.querySelector("img")!.getBoundingClientRect();
      return [...node.querySelectorAll("button")].map(button => {
        const box = button.getBoundingClientRect();
        return { width: box.width, height: box.height, bottom: box.bottom, imageTop: image.top };
      });
    });
    for (const box of geometry) {
      expect(box.width).toBeGreaterThanOrEqual(32);
      expect(box.height).toBeGreaterThanOrEqual(32);
      expect(box.bottom).toBeLessThanOrEqual(box.imageTop);
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
      await expect(items().last().getByTestId("annotation-edit")).toBeFocused();
      await expect(panel.getByTestId("draft-title")).toHaveValue("Ordered captures remain intact");
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
    await expect(items().last().getByTestId("annotation-edit")).toBeFocused();
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
    await fixture.goto(ext.fixtureUrl("basic.html"));
    await panel.bringToFront();
    await panel.getByTestId("element-shot-add").click();
    await pickElement(fixture, panel, "#card", { expectSelection: false });
    await expect(items()).toHaveCount(2);
    await waitForPanelFront(panel);
    await expect(panel.getByTestId("to-preview")).not.toHaveAttribute("aria-disabled", "true");
    await panel.getByTestId("to-preview").click();
    await expect(panel.getByTestId("back-to-draft")).toBeVisible();
    await expect(items()).toHaveCount(2);
    const dom = panel.locator('[data-testid="env-row"][data-env-label="DOM"]');
    await expect(dom).toContainText("title");
    await expect(dom).toContainText("card");
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
    await panel.getByTestId("detail-submit-open").click();
    await expect(panel.getByTestId("submit-issue-confirm")).toBeEnabled();
    await panel.getByTestId("submit-issue-confirm").click();
    await expect.poll(() => calls.length).toBe(2);
    expect(calls[1].files.filter(file => file.filename.startsWith("screenshot-"))).toEqual(calls[0].files.filter(file => file.filename.startsWith("screenshot-")));
    expect(calls[1].payload.environment).toEqual(calls[0].payload.environment);
    for (const call of calls) {
      expect(call.payload.body).toContain("title");
      expect(call.payload.body).toContain("card");
    }
    await panel.evaluate(async () => { await chrome.storage.local.remove("bugshot-settings"); });
  });

});
