import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSettingsUiStore } from "../settings-ui-store";
import { APP_SETTINGS_PERSIST_KEY as KEY } from "@/lib/session-keys";
import { obfuscateApiKey } from "@/lib/key-obfuscation";
import { onSettingsReset, onStateSaveFailed } from "@/lib/app-events";

let raw: any;
let writes: number;
let failWrite: boolean;
let tail: Promise<unknown>;
let listeners: Array<(changes: any, area: string) => void>;
let pauseWrite: (() => void) | undefined;
const llm = { baseUrl: "https://example.test", modelId: "model", apiKey: "secret" };
const envelope = () => typeof raw === "string" ? JSON.parse(raw) : raw;
beforeEach(() => {
  raw = JSON.stringify({ version: 99, future: "keep", state: { theme: "light", llm: { ...llm, apiKey: obfuscateApiKey(llm.apiKey) }, future: { x: 1 } } });
  writes = 0; failWrite = false; tail = Promise.resolve(); listeners = []; pauseWrite = undefined;
  vi.stubGlobal("navigator", { locks: { request: vi.fn((_name, _opts, run) => {
    const result = tail.then(run); tail = result.catch(() => {}); return result;
  }) } });
  vi.stubGlobal("chrome", { storage: { onChanged: {
    addListener: (fn: any) => listeners.push(fn),
    removeListener: (fn: any) => { listeners = listeners.filter((x) => x !== fn); },
  }, local: {
    get: vi.fn(async () => ({ [KEY]: structuredClone(raw) })),
    set: vi.fn(async (items) => {
      if (failWrite) throw Error("disk");
      if (pauseWrite) await new Promise<void>((resolve) => { pauseWrite = resolve; });
      const oldValue = raw; raw = structuredClone(items[KEY]); writes++;
      queueMicrotask(() => listeners.forEach((fn) => fn({ [KEY]: { oldValue, newValue: raw } }, "local")));
    }),
    remove: vi.fn(async () => { raw = undefined; }),
  } } });
});
afterEach(() => vi.unstubAllGlobals());

it("a stale panel's unrelated write cannot resurrect disconnected BYOK credentials", async () => {
  const a = createSettingsUiStore(), b = createSettingsUiStore();
  await Promise.all([a.persist.rehydrate(), b.persist.rehydrate()]);
  expect(b.getState().llm).toEqual(llm);
  a.getState().setLlm(null); await a.persist.flush();
  b.getState().setTheme("dark"); await b.persist.flush();
  await a.persist.rehydrate();
  expect(envelope()).toMatchObject({ version: 99, future: "keep", state: { llm: null, theme: "dark", future: { x: 1 } } });
  expect(a.getState().llm).toBeNull(); expect(b.getState().llm).toBeNull();
  expect(a.getState().theme).toBe("dark");
});

it("serializes actual independent store writes across a suspended Web Lock commit", async () => {
  const a = createSettingsUiStore(), b = createSettingsUiStore();
  await Promise.all([a.persist.rehydrate(), b.persist.rehydrate()]);
  pauseWrite = () => {};
  a.getState().setTheme("dark");
  await vi.waitFor(() => expect(chrome.storage.local.set).toHaveBeenCalledTimes(1));
  b.getState().setLocale("en");
  await Promise.resolve(); expect(writes).toBe(0);
  const release = pauseWrite!; pauseWrite = undefined; release();
  await Promise.all([a.persist.flush(), b.persist.flush()]);
  await Promise.all([a.persist.rehydrate(), b.persist.rehydrate()]);
  expect(envelope().state).toMatchObject({ theme: "dark", locale: "en", llm: { apiKey: obfuscateApiKey("secret") } });
  expect(a.getState().locale).toBe("en"); expect(b.getState().theme).toBe("dark");
  expect(navigator.locks.request).toHaveBeenCalledWith("bugshot-app-settings-write", { mode: "exclusive" }, expect.any(Function));
});

it("sync rebases pending failed intents and converges without echo writes", async () => {
  const { installAppSettingsSync } = await import("@/sidepanel/lib/app-settings-sync");
  const a = createSettingsUiStore(), b = createSettingsUiStore();
  await Promise.all([a.persist.rehydrate(), b.persist.rehydrate()]);
  const offA = installAppSettingsSync(a), offB = installAppSettingsSync(b);
  const failed = vi.fn(), offError = onStateSaveFailed.subscribe(failed);
  failWrite = true; a.getState().setLlm(null); await a.persist.flush();
  expect(failed).toHaveBeenCalledTimes(1); expect(a.getState().llm).toBeNull();
  failWrite = false; b.getState().setTheme("dark"); await b.persist.flush();
  await vi.waitFor(() => { expect(b.getState().llm).toBeNull(); expect(a.getState().theme).toBe("dark"); });
  await Promise.all([a.persist.flush(), b.persist.flush()]);
  expect(envelope().state.llm).toBeNull(); expect(writes).toBe(2);
  offA(); offB(); offError();
});

it("late hydration preserves pending local intent and a newer durable result", async () => {
  const a = createSettingsUiStore(); await a.persist.rehydrate();
  let release!: () => void;
  const original = chrome.storage.local.get;
  vi.mocked(chrome.storage.local.get).mockImplementationOnce(async () => {
    const snapshot = raw; await new Promise<void>((r) => { release = r; }); return { [KEY]: snapshot };
  });
  const hydrate = a.persist.rehydrate();
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  a.getState().setLlm(null);
  expect(a.getState().llm).toBeNull(); release();
  await hydrate; await a.persist.flush();
  expect(a.getState().llm).toBeNull(); expect(envelope().state.llm).toBeNull();
  expect(chrome.storage.local.get).toBe(original);
});

it.each(["read", "lock"])("%s failure never overwrites durable state with defaults", async (failure) => {
  const a = createSettingsUiStore();
  if (failure === "read") vi.mocked(chrome.storage.local.get).mockRejectedValue(Error("read"));
  if (failure === "lock") vi.mocked(navigator.locks.request).mockRejectedValue(Error("lock"));
  const before = raw;
  await a.persist.rehydrate();
  expect(a.persist.hasHydrated()).toBe(true);
  a.getState().setTheme("dark"); await a.persist.flush();
  expect(raw).toEqual(before); expect(writes).toBe(0);
});

it("legacy migration and plaintext credentials survive transactions and become obfuscated", async () => {
  raw = { version: 11, extra: true, state: { llm: { ...llm, baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", modelId: "gemini-2.0-flash" } } };
  const a = createSettingsUiStore(); await a.persist.rehydrate();
  expect(a.getState().llm).toMatchObject({ apiKey: "secret", modelId: "gemini-2.5-flash" });
  a.getState().setTheme("dark"); await a.persist.flush();
  expect(raw).toMatchObject({ extra: true, version: 12, state: { llm: { apiKey: obfuscateApiKey("secret"), modelId: "gemini-2.5-flash" }, theme: "dark" } });
});

it("section edits apply against the latest sections instead of a stale array", async () => {
  const a = createSettingsUiStore(), b = createSettingsUiStore();
  await Promise.all([a.persist.rehydrate(), b.persist.rehydrate()]);
  a.getState().setIssueEnabled("notes", true);
  b.getState().setIssueEnabled("description", false);
  await Promise.all([a.persist.flush(), b.persist.flush()]);
  expect(envelope().state.issueSections.find((s: any) => s.id === "notes").enabled).toBe(true);
  expect(envelope().state.issueSections.find((s: any) => s.id === "description").enabled).toBe(false);
});

it.each([true, undefined] as const)("persists new credentials with freeTier=%s without plaintext and reads them back", async (freeTier) => {
  raw = undefined;
  const a = createSettingsUiStore(); await a.persist.rehydrate();
  expect(writes).toBe(0);
  const config = { ...llm, ...(freeTier ? { freeTier } : {}) };
  a.getState().setLlm(config); await a.persist.flush();
  expect(raw).not.toContain("secret");
  expect(envelope().state.llm.apiKey).toMatch(/^obf:/);
  const b = createSettingsUiStore(); await b.persist.rehydrate();
  expect(b.getState().llm).toEqual(config);
});


it.each(["{broken", { state: [] }, { state: { llm: { apiKey: "obf:!" } } }])("recovers corrupt app settings and retains the reset notice for late subscribers (%j)", async (corrupt) => {
  raw = corrupt;
  const reset = vi.fn(), off = onSettingsReset.subscribe(reset);
  const a = createSettingsUiStore(); await a.persist.rehydrate();
  expect(chrome.storage.local.remove).toHaveBeenCalledWith(KEY);
  expect(a.persist.takeSettingsReset()).toBe(true);
  expect(a.persist.takeSettingsReset()).toBe(false);
  expect(reset).toHaveBeenCalledTimes(1);
  a.getState().setTheme("dark"); await a.persist.flush();
  expect(envelope().state).toMatchObject({ theme: "dark", llm: null });
  off();
});

it("corruption recovery rechecks under the lock and never deletes a repaired envelope", async () => {
  const good = raw;
  let reads = 0;
  vi.mocked(chrome.storage.local.get).mockImplementation(async () => ({ [KEY]: ++reads === 1 ? "{broken" : good }));
  const a = createSettingsUiStore(); await a.persist.rehydrate();
  expect(chrome.storage.local.remove).not.toHaveBeenCalled();
  expect(a.getState().llm).toEqual(llm);
  expect(a.persist.takeSettingsReset()).toBe(false);
});

it("a stale section reorder moves the selected ID, not whoever occupies its old index", async () => {
  const a = createSettingsUiStore(), b = createSettingsUiStore();
  await Promise.all([a.persist.rehydrate(), b.persist.rehydrate()]);
  a.getState().reorderIssueSections(0, 4); await a.persist.flush();
  b.getState().reorderIssueSections(1, 2); await b.persist.flush();
  await a.persist.rehydrate();
  const expected = ["media", "stepsToReproduce", "expectedResult", "notes", "description"];
  expect(envelope().state.issueSections.map((s: any) => s.id)).toEqual(expected);
  expect(a.getState().issueSections.map((s) => s.id)).toEqual(expected);
  expect(b.getState().issueSections.map((s) => s.id)).toEqual(expected);
});

it("retains the reset notice after removal even when the subsequent read fails", async () => {
  raw = "{broken";
  const remove = chrome.storage.local.remove;
  vi.mocked(chrome.storage.local.remove).mockImplementation(async () => {
    raw = undefined;
    vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(Error("read after removal"));
  });
  const a = createSettingsUiStore(); await a.persist.rehydrate();
  expect(remove).toHaveBeenCalledOnce();
  expect(a.persist.hasHydrated()).toBe(true);
  expect(a.persist.takeSettingsReset()).toBe(true);
  a.getState().setTheme("dark"); await a.persist.flush();
  expect(envelope().state.theme).toBe("dark");
});

it("corruption recovery retains pending user intent without backing up credentials", async () => {
  raw = "{broken";
  const a = createSettingsUiStore();
  a.getState().setTheme("dark"); await a.persist.flush();
  expect(raw).toBe("{broken");
  await a.persist.rehydrate();
  expect(a.getState().theme).toBe("dark");
  expect(envelope().state.theme).toBe("dark");
  expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
  expect(Object.keys(vi.mocked(chrome.storage.local.set).mock.calls[0][0])).toEqual([KEY]);
});

it("stale identical moves preserve the requested side of the target section", async () => {
  const a = createSettingsUiStore(), b = createSettingsUiStore();
  await Promise.all([a.persist.rehydrate(), b.persist.rehydrate()]);
  a.getState().reorderIssueSections(1, 2); await a.persist.flush();
  b.getState().reorderIssueSections(1, 2); await b.persist.flush();
  expect(envelope().state.issueSections.map((s: any) => s.id)).toEqual(["description", "media", "stepsToReproduce", "expectedResult", "notes"]);
});
