import type { Page, Request } from "@playwright/test";
import { expect, test, type ExtContext } from "./fixtures/extension";
import { openSettings, setScreenLocale } from "./fixtures/settings";

const SETTINGS_KEY = "bugshot-app-settings";
const STUDIO = "https://aistudio.google.com/**";
const GEMINI_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/openai/models";
const ROUTER_API = "https://openrouter.ai/api/v1/**";
const freeGeminiModels = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"];

test.describe.serial("free AI connection", () => {
  let fixture: Page;
  let panel: Page;
  let originalSettings: string | undefined;
  const keyRequests: Request[] = [];
  const modelRequests: Request[] = [];
  const probes: Request[] = [];
  const geminiRequests: Request[] = [];

  async function closeStudioWindows(ext: ExtContext) {
    await ext.evalInExt(async () => {
      const windows = await chrome.windows.getAll({ windowTypes: ["popup"], populate: true });
      for (const win of windows) {
        if (win.id != null && win.tabs?.some((tab) => (tab.url || tab.pendingUrl)?.startsWith("https://aistudio.google.com/"))) {
          await chrome.windows.remove(win.id);
        }
      }
    });
    await panel.bringToFront();
  }

  test.beforeAll(async ({ ext }) => {
    originalSettings = await ext.evalInExt(async (key) => (await chrome.storage.local.get(key))[key] as string | undefined, SETTINGS_KEY);
    await ext.evalInExt((key) => chrome.storage.local.set({ [key]: JSON.stringify({ state: { llm: null, locale: "en" }, version: 12 }) }), SETTINGS_KEY);
    await ext.context.route(STUDIO, (route) => route.fulfill({ contentType: "text/html", body: "<title>AI Studio fixture</title><p>Create a test key</p>" }));
    await ext.context.route(GEMINI_MODELS_URL, (route) => {
      geminiRequests.push(route.request());
      return route.fulfill({ json: { data: [{ id: "gemini-2.5-flash" }, { id: "gemini-2.5-pro" }] } });
    });
    await ext.context.route(ROUTER_API, (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname.endsWith("/auth/keys")) {
        keyRequests.push(request);
        return route.fulfill({ json: { key: "e2e-openrouter-key" } });
      }
      if (pathname.endsWith("/models")) {
        modelRequests.push(request);
        return route.fulfill({ json: { data: [
          { id: "z/vision:free", architecture: { input_modalities: ["text", "image"] } },
          { id: "a/vision:free", architecture: { input_modalities: ["image"] } },
          { id: "paid/vision", architecture: { input_modalities: ["image"] } },
          { id: "text/only:free", architecture: { input_modalities: ["text"] } },
        ] } });
      }
      if (pathname.endsWith("/chat/completions")) {
        probes.push(request);
        return route.fulfill({ json: { choices: [{ message: { content: "pong" } }] } });
      }
      return route.abort();
    });
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    panel = await ext.openPanel(await ext.fixtureTabId("http://127.0.0.1/basic.html"));
    await panel.bringToFront();
    await openSettings(panel, "ai");
  });

  test.afterAll(async ({ ext }) => {
    if (panel && !panel.isClosed()) {
      await closeStudioWindows(ext);
      await panel.close();
    }
    await fixture?.close();
    await ext.context.unroute(STUDIO);
    await ext.context.unroute(GEMINI_MODELS_URL);
    await ext.context.unroute(ROUTER_API);
    await ext.evalInExt(async ({ key, original }) => {
      if (original === undefined) await chrome.storage.local.remove(key);
      else await chrome.storage.local.set({ [key]: original });
    }, { key: SETTINGS_KEY, original: originalSettings });
  });

  test("shows free connection to the left of API-key connection", async () => {
    const free = panel.getByTestId("llm-connect-free");
    const byok = panel.getByTestId("llm-connect-byok");
    await expect(free).toBeVisible();
    await expect(byok).toBeVisible();
    const freeBox = await free.boundingBox();
    const byokBox = await byok.boundingBox();
    expect(freeBox!.x).toBeLessThan(byokBox!.x);
    expect(Math.abs(freeBox!.y - byokBox!.y)).toBeLessThan(1);
  });

  test("keeps German cards scrollable and Next reachable at 360 by 600", async () => {
    const originalViewport = panel.viewportSize()!;
    await panel.setViewportSize({ width: 360, height: 600 });
    try {
      await setScreenLocale(panel, "Deutsch");
      await openSettings(panel, "ai");
      await panel.getByTestId("llm-connect-free").click();
      const dialog = panel.getByTestId("free-llm-dialog");
      await expect(dialog).toBeVisible();
      const next = panel.getByTestId("free-llm-next");
      await expect(async () => {
        const box = await next.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(360);
        expect(box!.y + box!.height).toBeLessThanOrEqual(600);
      }).toPass();
      const scroll = dialog.getByRole("radiogroup").locator("..");
      expect(await scroll.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
      await scroll.evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      const lastCard = panel.getByTestId("free-llm-card-openrouter");
      const cardBox = await lastCard.boundingBox();
      const scrollBox = await scroll.boundingBox();
      expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(scrollBox!.y + scrollBox!.height + 1);
      expect(cardBox!.y + cardBox!.height).toBeGreaterThan(scrollBox!.y);
      await lastCard.click();
      await expect(lastCard).toHaveAttribute("aria-checked", "true");
      expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await panel.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    } finally {
      await panel.setViewportSize(originalViewport);
      await setScreenLocale(panel, "English");
      await openSettings(panel, "ai");
    }
  });

  test("requires choosing one of two provider cards", async () => {
    await panel.getByTestId("llm-connect-free").click();
    await expect(panel.getByTestId("free-llm-dialog")).toBeVisible();
    await expect(panel.getByRole("radiogroup").getByRole("radio")).toHaveCount(2);
    await expect(panel.getByTestId("free-llm-card-gemini")).toBeVisible();
    await expect(panel.getByTestId("free-llm-card-openrouter")).toBeVisible();
    await expect(panel.getByTestId("free-llm-next")).toBeDisabled();
  });

  test("renders 40px brand tiles with 24px logos (toggle svg sizing does not win)", async () => {
    for (const id of ["gemini", "openrouter"]) {
      const tile = panel.getByTestId(`free-llm-icon-${id}`);
      await expect(tile).toBeVisible();
      const tileBox = (await tile.boundingBox())!;
      expect(Math.abs(tileBox.width - 40)).toBeLessThanOrEqual(1);
      expect(Math.abs(tileBox.height - 40)).toBeLessThanOrEqual(1);
      const logoBox = (await tile.locator("svg").boundingBox())!;
      expect(Math.abs(logoBox.width - 24)).toBeLessThanOrEqual(1);
      expect(Math.abs(logoBox.height - 24)).toBeLessThanOrEqual(1);
    }
  });

  test("opens AI Studio in an actual popup and focuses the key input", async ({ ext }) => {
    await panel.getByTestId("free-llm-card-gemini").click();
    const next = panel.getByTestId("free-llm-next");
    await expect(next).not.toHaveAttribute("aria-disabled", "true");
    await next.click();
    await expect.poll(() => ext.evalInExt(async () => {
      const windows = await chrome.windows.getAll({ windowTypes: ["popup"], populate: true });
      return windows.filter((win) => win.tabs?.some((tab) => (tab.url || tab.pendingUrl) === "https://aistudio.google.com/apikey")).length;
    })).toBe(1);
    await expect(panel.getByTestId("free-llm-gemini-key")).toBeVisible();
    await expect(panel.getByTestId("free-llm-gemini-key")).toBeFocused();
    await closeStudioWindows(ext);
  });

  test("returns from key entry to the selected card", async () => {
    await panel.getByTestId("free-llm-gemini-key").fill("discard-me");
    await panel.getByTestId("free-llm-back").click();
    await expect(panel.getByTestId("free-llm-gemini-key")).toHaveCount(0);
    await expect(panel.getByTestId("free-llm-card-gemini")).toHaveAttribute("aria-checked", "true");
    await expect(panel.getByTestId("free-llm-card-gemini")).toBeFocused();
  });

  test("validates a Gemini key and connects with only free models offered", async ({ ext }) => {
    const next = panel.getByTestId("free-llm-next");
    await expect(next).not.toHaveAttribute("aria-disabled", "true");
    await next.click();
    await expect(panel.getByTestId("free-llm-gemini-key")).toHaveValue("");
    await closeStudioWindows(ext);
    await panel.getByTestId("free-llm-gemini-key").fill("  e2e-gemini-key  ");
    const connect = panel.getByTestId("free-llm-gemini-connect");
    await expect(connect).not.toHaveAttribute("aria-disabled", "true");
    await connect.click();
    await expect(panel.getByTestId("llm-model-dialog")).toBeVisible();
    const picker = panel.getByTestId("llm-model-picker");
    await expect(picker).not.toHaveAttribute("aria-disabled", "true");
    await picker.click();
    await expect(panel.getByRole("option")).toHaveText(freeGeminiModels);
    await panel.getByRole("option", { name: "gemini-2.5-flash", exact: true }).click();
    const confirm = panel.getByTestId("llm-model-confirm");
    await expect(confirm).not.toHaveAttribute("aria-disabled", "true");
    await confirm.click();
    await expect(panel.getByTestId("llm-connected")).toBeVisible();
    expect(geminiRequests).toHaveLength(1);
    expect(geminiRequests[0].headers().authorization).toBe("Bearer e2e-gemini-key");
    await expect.poll(() => panel.evaluate(async (key) => {
      const { state } = JSON.parse((await chrome.storage.local.get(key))[key]);
      return { modelId: state.llm?.modelId, freeTier: state.llm?.freeTier };
    }, SETTINGS_KEY)).toEqual({ modelId: "gemini-2.5-flash", freeTier: true });
  });

  test("binds real Chrome redirect, randomness and fetch through the OpenRouter launcher", async ({ ext }) => {
    // Only the external auth window is replaced; the launcher and PKCE/key exchange remain real.
    await panel.addInitScript(() => {
      const state = window as unknown as { __openRouterAuth: chrome.identity.WebAuthFlowOptions[]; __completeOpenRouterAuth?: () => void };
      state.__openRouterAuth = [];
      chrome.identity.launchWebAuthFlow = (async (details: chrome.identity.WebAuthFlowOptions) => {
        state.__openRouterAuth.push(details);
        const auth = new URL(details.url);
        const redirect = new URL(chrome.identity.getRedirectURL());
        redirect.search = new URLSearchParams({ code: "x", state: auth.searchParams.get("state")! }).toString();
        return new Promise<string>((resolve) => { state.__completeOpenRouterAuth = () => resolve(redirect.href); });
      }) as typeof chrome.identity.launchWebAuthFlow;
    });
    await panel.evaluate((key) => chrome.storage.local.set({ [key]: JSON.stringify({ state: { llm: null, locale: "en" }, version: 12 }) }), SETTINGS_KEY);
    await panel.reload();
    const originalViewport = panel.viewportSize()!;
    await panel.setViewportSize({ width: 400, height: 760 });
    await setScreenLocale(panel, "한국어");
    await openSettings(panel, "ai");
    await panel.getByTestId("llm-connect-free").click();
    await panel.getByTestId("free-llm-card-openrouter").click();
    const next = panel.getByTestId("free-llm-next");
    await expect(next).not.toHaveAttribute("aria-disabled", "true");
    await next.click();
    const dialog = panel.getByTestId("free-llm-dialog");
    const status = dialog.getByRole("status");
    await expect(status).not.toBeEmpty();
    await expect(status).toBeInViewport({ ratio: 1 });
    const statusBox = await status.boundingBox();
    const dialogBox = await dialog.boundingBox();
    expect(statusBox!.x).toBeGreaterThanOrEqual(Math.max(0, dialogBox!.x));
    expect(statusBox!.y).toBeGreaterThanOrEqual(Math.max(0, dialogBox!.y));
    expect(statusBox!.x + statusBox!.width).toBeLessThanOrEqual(Math.min(400, dialogBox!.x + dialogBox!.width));
    expect(statusBox!.y + statusBox!.height).toBeLessThanOrEqual(Math.min(760, dialogBox!.y + dialogBox!.height));
    await expect(next).toBeInViewport({ ratio: 1 });
    await panel.evaluate(() => (window as unknown as { __completeOpenRouterAuth: () => void }).__completeOpenRouterAuth());
    await panel.setViewportSize(originalViewport);
    await expect(panel.getByTestId("llm-model-dialog")).toBeVisible();
    const calls = await panel.evaluate(() => (window as unknown as { __openRouterAuth: chrome.identity.WebAuthFlowOptions[] }).__openRouterAuth);
    expect(calls).toHaveLength(1);
    expect(calls[0].interactive).toBe(true);
    const auth = new URL(calls[0].url);
    expect(auth.searchParams.get("callback_url")).toBe(`https://${ext.extensionId}.chromiumapp.org/`);
    expect(auth.searchParams.get("state")).toMatch(/^[\w-]{43}$/);
    expect(auth.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(keyRequests).toHaveLength(1);
    expect(keyRequests[0].postDataJSON()).toEqual({ code: "x", code_verifier: expect.stringMatching(/^[\w-]{43}$/), code_challenge_method: "S256" });
    const picker = panel.getByTestId("llm-model-picker");
    await expect(picker).not.toHaveAttribute("aria-disabled", "true");
    await picker.click();
    await expect(panel.getByRole("option")).toHaveText(["a/vision:free", "z/vision:free"]);
    await panel.getByRole("option", { name: "a/vision:free", exact: true }).click();
    const confirm = panel.getByTestId("llm-model-confirm");
    await expect(confirm).not.toHaveAttribute("aria-disabled", "true");
    await confirm.click();
    await expect(panel.getByTestId("llm-connected")).toBeVisible();
    expect(modelRequests.length).toBeGreaterThanOrEqual(1);
    expect(modelRequests[0].headers().authorization).toBe("Bearer e2e-openrouter-key");
    expect(probes).toHaveLength(1);
    expect(probes[0].headers().authorization).toBe("Bearer e2e-openrouter-key");
    expect(probes[0].postDataJSON()).toEqual({ model: "a/vision:free", messages: [{ role: "user", content: "ping" }], max_tokens: 16 });
    await expect.poll(() => panel.evaluate(async (key) => {
      const { state } = JSON.parse((await chrome.storage.local.get(key))[key]);
      return { baseUrl: state.llm?.baseUrl, modelId: state.llm?.modelId, freeTier: state.llm?.freeTier };
    }, SETTINGS_KEY)).toEqual({ baseUrl: "https://openrouter.ai/api/v1", modelId: "a/vision:free", freeTier: true });
  });
});
