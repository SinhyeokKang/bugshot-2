import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSettingsUiStore } from "../settings-ui-store";
import { APP_SETTINGS_PERSIST_KEY as KEY } from "@/lib/session-keys";
import { obfuscateApiKey } from "@/lib/key-obfuscation";
import { onStateSaveFailed } from "@/lib/app-events";

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

it.each(["read", "lock", "corrupt"])("%s failure never overwrites durable state with defaults", async (failure) => {
  const a = createSettingsUiStore();
  if (failure === "read") vi.mocked(chrome.storage.local.get).mockRejectedValue(Error("read"));
  if (failure === "lock") vi.mocked(navigator.locks.request).mockRejectedValue(Error("lock"));
  if (failure === "corrupt") raw = "{broken";
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
