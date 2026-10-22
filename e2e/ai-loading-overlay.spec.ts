import { enterDebug, enterDebugAndPick, expect, test } from "./fixtures/extension";
import type { Page, Route } from "@playwright/test";

const response = {
  title: "Generated title",
  description: "Generated description",
  stepsToReproduce: "Generated steps",
  expectedResult: "Generated expectation",
};

for (const finish of ["complete", "cancel", "fail"] as const) {
  test(`AI loading isolates keyboard and pointer input until ${finish}`, async ({ ext }) => {
    const fixture = await ext.context.newPage();
    let panel: Page | undefined;
    let pending: Route | undefined;
    try {
      await fixture.goto(ext.fixtureUrl("basic.html"));
      panel = await ext.openPanel(await ext.fixtureTabId());
      await panel.evaluate(() => chrome.storage.local.set({
        "bugshot-app-settings": JSON.stringify({ state: {
          llm: { baseUrl: "https://mock-llm.test/v1", apiKey: "", modelId: "mock-model" },
        }, version: 5 }),
      }));
      await panel.reload();
      await panel.route("**/chat/completions", (route) => { pending = route; });
      await enterDebug(panel);
      await panel.getByTestId("mode-freeform").click();
      const title = panel.getByTestId("draft-title");
      const editor = panel.getByTestId("draft-section-description").locator('[contenteditable="true"]');
      await title.click();
      await panel.evaluate(() => new Promise(requestAnimationFrame));
      await title.fill("Original title");
      await editor.fill("Original description");
      await panel.getByTestId("ai-draft-trigger").click();
      await panel.getByTestId("ai-draft-input").fill("Rewrite this report");
      await panel.getByTestId("ai-draft-submit").click();
      await expect.poll(() => !!pending).toBe(true);
      const overlay = panel.getByTestId("ai-loading-overlay");
      const stop = panel.getByTestId("ai-loading-stop");
      await expect(overlay).toHaveAttribute("aria-modal", "true");
      await expect(stop).toBeFocused();

      for (const key of ["Tab", "Shift+Tab", "Tab", "Shift+Tab"]) {
        await panel.keyboard.press(key);
        await expect(stop).toBeFocused();
        await panel.keyboard.type("SHOULD_NOT_EDIT");
      }
      // Trusted coordinate clicks must also remain on the blocking surface.
      for (const target of [title, editor, panel.getByTestId("tab-settings")]) {
        const box = await target.boundingBox();
        expect(box).not.toBeNull();
        await panel.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
        await panel.keyboard.type("SHOULD_NOT_EDIT");
      }
      await expect(title).toHaveValue("Original title");
      await expect(editor).toHaveText("Original description");
      await expect(panel.getByTestId("tab-debug")).toHaveAttribute("data-state", "active");
      await panel.keyboard.press("Escape");
      await expect(overlay).toBeVisible();

      if (finish === "cancel") {
        await stop.focus();
        await panel.keyboard.press("Enter");
        await expect(overlay).toHaveCount(0);
      }
      await pending!.fulfill({ status: finish === "fail" ? 400 : 200, contentType: "application/json",
        body: JSON.stringify(finish === "fail" ? { error: { message: "Rejected request" } } : { choices: [{ message: { content: JSON.stringify(response) } }] }),
      });
      pending = undefined;
      await expect(overlay).toHaveCount(0);
      await expect(panel.getByTestId("tab-debug")).toBeFocused();
      await expect(title).toHaveValue(finish === "complete" ? "Generated title" : "Original title");
      await expect(editor).toHaveText(finish === "complete" ? "Generated description" : "Original description");
      // Actual typing after closure proves that modal cleanup releases editing.
      await title.click();
      await panel.evaluate(() => new Promise(requestAnimationFrame));
      await panel.keyboard.type(" edited");
      await expect(title).toHaveValue(`${finish === "complete" ? "Generated title" : "Original title"} edited`);
      await editor.click();
      await panel.keyboard.press("End");
      await panel.keyboard.type(" edited");
      await expect(editor).toContainText("edited");
    } finally {
      await pending?.abort().catch(() => {});
      await panel?.close();
      await fixture.close();
    }
  });
}

test("Enter submission with an immediate failure restores focus outside the closing dialog", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  let panel: Page | undefined;
  try {
    await fixture.goto(ext.fixtureUrl("basic.html"));
    panel = await ext.openPanel(await ext.fixtureTabId());
    await panel.evaluate(() => chrome.storage.local.set({
      "bugshot-app-settings": JSON.stringify({ state: {
        llm: { baseUrl: "https://mock-llm.test/v1", apiKey: "", modelId: "mock-model" },
      }, version: 5 }),
    }));
    await panel.reload();
    let requested = false;
    await panel.route("**/chat/completions", async (route) => {
      requested = true;
      await route.fulfill({ status: 400, contentType: "application/json",
        body: JSON.stringify({ error: { message: "Rejected request" } }),
      });
    });
    await enterDebug(panel);
    await panel.getByTestId("mode-freeform").click();
    await panel.getByTestId("ai-draft-trigger").click();
    const prompt = panel.getByTestId("ai-draft-input");
    await prompt.fill("Rewrite this report");
    await prompt.press("Enter");
    await expect.poll(() => requested).toBe(true);
    await expect(panel.getByTestId("ai-loading-overlay")).toHaveCount(0);
    await expect(prompt).toHaveCount(0);
    await expect(panel.getByTestId("tab-debug")).toBeFocused();
    await panel.getByTestId("draft-title").click();
    await panel.keyboard.type("Editable after failure");
    await expect(panel.getByTestId("draft-title")).toHaveValue("Editable after failure");
  } finally {
    await panel?.close();
    await fixture.close();
  }
});

test("AI styling isolates focus and restores editing on completion, cancellation and failure", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  let panel: Page | undefined;
  let pending: Route | undefined;
  try {
    await fixture.goto(ext.fixtureUrl("basic.html"));
    panel = await ext.openPanel(await ext.fixtureTabId());
    await panel.evaluate(() => chrome.storage.local.set({
      "bugshot-app-settings": JSON.stringify({ state: {
        llm: { baseUrl: "https://mock-llm.test/v1", apiKey: "", modelId: "mock-model" },
      }, version: 5 }),
    }));
    await panel.reload();
    await panel.route("**/chat/completions", (route) => { pending = route; });
    await enterDebugAndPick(fixture, panel, "#title");
    for (const finish of ["complete", "cancel", "fail"] as const) {
      await panel.getByTestId("ai-styling-trigger").click();
      await panel.getByTestId("ai-styling-input").fill("Change padding");
      await panel.getByTestId("ai-styling-input").press("Enter");
      await expect.poll(() => !!pending).toBe(true);
      const stop = panel.getByTestId("ai-loading-stop");
      await expect(stop).toBeFocused();
      await panel.keyboard.press("Tab");
      await expect(stop).toBeFocused();
      await panel.keyboard.press("Shift+Tab");
      await expect(stop).toBeFocused();
      await panel.keyboard.type("SHOULD_NOT_EDIT");
      if (finish === "cancel") {
        await panel.keyboard.press("Enter");
        await expect(panel.getByTestId("ai-loading-overlay")).toHaveCount(0);
      }
      await pending!.fulfill({
        status: finish === "fail" ? 400 : 200,
        contentType: "application/json",
        body: JSON.stringify(finish === "fail" ? { error: { message: "Rejected request" } } : {
          choices: [{ message: { content: JSON.stringify({
            explanation: "Change padding", inlineStyle: { padding: finish === "complete" ? "20px" : "40px" },
          }) } }],
        }),
      });
      pending = undefined;
      await expect(panel.getByTestId("ai-loading-overlay")).toHaveCount(0);
      await expect(panel.getByTestId("ai-styling-input")).toHaveCount(0);
      await expect(panel.getByTestId("tab-debug")).toBeFocused();
      await expect(fixture.locator("#title")).toHaveCSS("padding", "20px");
    }
    await panel.getByTestId("ai-styling-trigger").click();
    await panel.getByTestId("ai-styling-input").pressSequentially("Editable after loading");
    await expect(panel.getByTestId("ai-styling-input")).toHaveValue("Editable after loading");
    await panel.keyboard.press("Escape");
  } finally {
    await pending?.abort().catch(() => {});
    await panel?.close();
    await fixture.close();
  }
});
