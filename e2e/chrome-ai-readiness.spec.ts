import { enterDebug, expect, test, type ExtContext } from "./fixtures/extension";
import { openSettings, setScreenLocale } from "./fixtures/settings";
import type { Page } from "@playwright/test";

type NativeState = {
  availability: string;
  probes: unknown[];
  creates: { expectedInputs?: unknown; expectedOutputs?: unknown; initialPrompts?: { content: string }[] }[];
  prompts: string[];
  destroyed: number;
  progress: (loaded: number) => void;
  complete: (fail?: boolean) => void;
};
const native = (panel: Page) => panel.evaluate(() => {
  const state = (window as unknown as { __chromeAI: NativeState }).__chromeAI;
  return { availability: state.availability, probes: state.probes, creates: state.creates, prompts: state.prompts, destroyed: state.destroyed };
});

async function setup(ext: ExtContext, locale = "en", availability = "downloadable") {
  const previous = await ext.evalInExt(async () => (await chrome.storage.local.get("bugshot-app-settings"))["bugshot-app-settings"]);
  await ext.evalInExt(async (locale) => {
    await chrome.storage.local.set({ "bugshot-app-settings": JSON.stringify({ state: { llm: null, locale }, version: 5 }) });
  }, locale);
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.context.newPage();
  // Install before the very first app script: no BYOK endpoint or HTTP mock.
  await panel.addInitScript(({ availability }) => {
    const state: NativeState = { availability, probes: [], creates: [], prompts: [], destroyed: 0, progress: () => {}, complete: () => {} };
    (window as unknown as { __chromeAI: NativeState }).__chromeAI = state;
    const session = () => ({
      destroy() { state.destroyed++; },
      async prompt(input: string) {
        state.prompts.push(input);
        return JSON.stringify({ title: "Native mock draft", description: "Native mock description", stepsToReproduce: "Click Submit", expectedResult: "The order is submitted.", notes: "" });
      },
    });
    Object.defineProperty(globalThis, "LanguageModel", { configurable: true, value: {
      async availability(options: unknown) { state.probes.push(options); return state.availability; },
      create(options: { initialPrompts?: { content: string }[]; monitor?: (m: { addEventListener: (type: string, fn: (e: { loaded: number }) => void) => void }) => void }) {
        state.creates.push(options);
        if (options.initialPrompts) {
          if (state.availability !== "available") throw new Error("Implicit download forbidden");
          return Promise.resolve(session());
        }
        if (!navigator.userActivation.isActive) throw new Error("Preparation lost user activation");
        options.monitor?.({ addEventListener(_type, callback) { state.progress = (loaded) => callback({ loaded }); } });
        state.availability = "downloading";
        return new Promise((resolve, reject) => {
          state.complete = (fail = false) => {
            state.availability = fail ? "downloadable" : "available";
            if (fail) reject(new Error("Download failed"));
            else resolve(session());
          };
        });
      },
    } });
  }, { availability });
  await panel.goto(`chrome-extension://${ext.extensionId}/src/sidepanel/index.html?tabId=${tabId}`);
  await openSettings(panel, "ai");
  return { panel, close: async () => {
    await panel.close();
    await fixture.close();
    await ext.evalInExt(async (previous) => {
      if (previous === undefined) await chrome.storage.local.remove("bugshot-app-settings");
      else await chrome.storage.local.set({ "bugshot-app-settings": previous });
    }, previous);
  } };
}

// Rendered language is part of this contract, so fixtures explicitly select it.
test("Chrome preparation through keyboard exposes real progress and enables a native draft", async ({ ext }) => {
  const { panel, close } = await setup(ext);
  try {
    await expect(panel.getByTestId("chrome-ai-status")).toContainText("Download the browser model");
    expect((await native(panel)).creates).toHaveLength(0);
    const prepare = panel.getByTestId("chrome-ai-prepare");
    await prepare.focus();
    await panel.keyboard.press("Enter");
    const progress = panel.getByRole("progressbar");
    await expect(progress).toBeVisible();
    await expect(progress).not.toHaveAttribute("aria-valuenow");
    await panel.keyboard.press("Enter");
    expect((await native(panel)).creates).toHaveLength(1);
    await panel.evaluate(() => (window as unknown as { __chromeAI: NativeState }).__chromeAI.progress(0.42));
    await expect(progress).toHaveAttribute("aria-valuenow", "42");
    await expect(panel.getByTestId("llm-connect-byok")).toBeEnabled();
    await panel.evaluate(() => (window as unknown as { __chromeAI: NativeState }).__chromeAI.complete());
    await expect(panel.getByTestId("chrome-ai-status")).toHaveText("Chrome AI is ready.");
    expect((await native(panel)).destroyed).toBe(1);
    await enterDebug(panel);
    await panel.getByTestId("mode-freeform").click();
    await panel.getByTestId("ai-draft-trigger").click();
    await panel.getByTestId("ai-draft-input").fill("The submit button does nothing");
    await panel.getByTestId("ai-draft-submit").click();
    await expect(panel.getByTestId("draft-title")).toHaveValue("Native mock draft");
    const calls = await native(panel);
    expect(calls.creates).toHaveLength(2);
    expect(calls.prompts).toHaveLength(1);
    expect(calls.creates[1].initialPrompts?.[0].content).toContain("Write in English.");
    expect(calls.creates[1].expectedOutputs).toEqual([{ type: "text", languages: ["en"] }]);
  } finally { await close(); }
});

test("failed preparation retries and hidden settings reactivation refreshes readiness", async ({ ext }) => {
  const { panel, close } = await setup(ext);
  try {
    await panel.getByTestId("chrome-ai-prepare").click();
    await panel.evaluate(() => (window as unknown as { __chromeAI: NativeState }).__chromeAI.complete(true));
    await expect(panel.getByTestId("chrome-ai-status")).toContainText("preparation failed");
    await panel.getByTestId("chrome-ai-prepare").click();
    await panel.evaluate(() => (window as unknown as { __chromeAI: NativeState }).__chromeAI.complete());
    await expect(panel.getByTestId("chrome-ai-status")).toHaveText("Chrome AI is ready.");
    await enterDebug(panel);
    await panel.evaluate(() => { (window as unknown as { __chromeAI: NativeState }).__chromeAI.availability = "unavailable"; });
    const before = (await native(panel)).probes.length;
    await panel.getByTestId("tab-settings").click();
    await expect(panel.getByTestId("chrome-ai-status")).toContainText("unavailable on this device");
    expect((await native(panel)).probes.length).toBeGreaterThan(before);
    await expect(panel.getByTestId("chrome-ai-prepare")).toHaveCount(0);
    expect((await native(panel)).creates).toHaveLength(2);
  } finally { await close(); }
});

test("unsupported Korean never downloads and supported Japanese uses matching declarations", async ({ ext }) => {
  const { panel, close } = await setup(ext, "ko");
  try {
    await expect(panel.getByTestId("chrome-ai-status")).toContainText("현재 화면 언어로 출력할 수 없어요");
    await expect(panel.getByTestId("llm-connect-byok")).toBeEnabled();
    await expect(panel.getByTestId("chrome-ai-prepare")).toHaveCount(0);
    expect((await native(panel)).creates).toHaveLength(0);
    await setScreenLocale(panel, "日本語");
    await openSettings(panel, "ai");
    await expect(panel.getByTestId("chrome-ai-status")).toContainText("ダウンロード");
    await panel.getByTestId("chrome-ai-prepare").click();
    const calls = await native(panel);
    expect(calls.creates[0].expectedInputs).toEqual([{ type: "text", languages: ["en", "ja"] }]);
    expect(calls.creates[0].expectedOutputs).toEqual([{ type: "text", languages: ["ja"] }]);
    await panel.evaluate(() => (window as unknown as { __chromeAI: NativeState }).__chromeAI.complete());
    await expect(panel.getByTestId("chrome-ai-status")).toHaveText("Chrome AI を利用できます。");
  } finally { await close(); }
});

test("short zoomed German onboarding keeps every action reachable by keyboard", async ({ ext }) => {
  const { panel, close } = await setup(ext, "de");
  try {
    await panel.setViewportSize({ width: 400, height: 400 });
    await panel.evaluate(() => { document.documentElement.style.zoom = "1.25"; });
    await panel.getByTestId("settings-sub-ai").focus();
    const reached = new Set<string>();
    const actions = ["llm-connect-free", "llm-connect-byok", "chrome-ai-prepare", "chrome-ai-refresh"];
    for (let i = 0; i < 20 && reached.size < actions.length; i++) {
      await panel.keyboard.press("Tab");
      const id = await panel.evaluate(() => document.activeElement?.getAttribute("data-testid"));
      if (id && actions.includes(id)) {
        reached.add(id);
        await expect(panel.getByTestId(id)).toBeInViewport({ ratio: 1 });
      }
    }
    expect([...reached].sort()).toEqual([...actions].sort());
    // clientWidth excludes the vertical scrollbar; at 125% the 320px app
    // minimum exactly fills this 400px viewport. Check physical viewport width.
    expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await panel.getByTestId("llm-connect-byok").focus();
    await panel.keyboard.press("Enter");
    await expect(panel.getByRole("dialog")).toBeVisible();
  } finally { await close(); }
});
