import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSettingsStore } from "../settings-store";
import { writeStoredLinearOAuthTokens } from "@/lib/settings-storage";

const auth = { kind: "oauth" as const, grantId: "grant-a", accessToken: "old", refreshToken: "r0", expiresAt: 1, scope: "read", viewerName: "me", grantedAt: 1 };
const account = { platform: "linear" as const, connectedAt: 1, auth, defaults: {} };
let raw: any;
let writes: number;
let failWrite: boolean;
let lockTail: Promise<unknown>;
let listeners: Array<(changes: any, area: string) => void>;
let releaseWrite: (() => void) | undefined;
beforeEach(() => {
  raw = { version: 99, future: "keep", state: { accounts: { linear: account }, lastSubmitFields: {}, titlePrefix: "", future: { x: 1 } } };
  listeners = [];
  writes = 0; failWrite = false; lockTail = Promise.resolve(); releaseWrite = undefined;
  vi.stubGlobal("navigator", { locks: { request: vi.fn((_name, _opts, run) => {
    const result = lockTail.then(run); lockTail = result.catch(() => {}); return result;
  }) } });
  vi.stubGlobal("chrome", { storage: { onChanged: { addListener: (fn: any) => listeners.push(fn), removeListener: (fn: any) => { listeners = listeners.filter((x) => x !== fn); } }, local: {
    get: vi.fn(async () => ({ "bugshot-settings": structuredClone(raw) })),
    set: vi.fn(async (items) => { if (failWrite) throw Error("disk"); if (releaseWrite) await new Promise<void>((r) => { releaseWrite = r; }); const oldValue = structuredClone(raw); raw = structuredClone(items["bugshot-settings"]); if (typeof raw === "string") raw = JSON.parse(raw); writes++; const newValue = structuredClone(raw); queueMicrotask(() => listeners.forEach((listener) => listener({ "bugshot-settings": { oldValue, newValue } }, "local"))); }),
    remove: vi.fn(async (keys: string | string[]) => { if ([keys].flat().includes("bugshot-settings")) raw = undefined; }),
  } } });
});
afterEach(() => vi.unstubAllGlobals());
it("independent panels and background preserve tokens, intents and future envelope fields", async () => {
  const a = createSettingsStore(), b = createSettingsStore();
  await Promise.all([a.persist.rehydrate(), b.persist.rehydrate()]);
  a.getState().setTitlePrefix("new prefix");
  b.getState().updateLinearAccount({ defaults: { teamId: "T" } });
  await writeStoredLinearOAuthTokens(auth, { ...auth, accessToken: "new", refreshToken: "r1" });
  await Promise.all([a.persist.flush(), b.persist.flush()]);
  await Promise.all([a.persist.rehydrate(), b.persist.rehydrate()]);
  expect(raw).toMatchObject({ version: 99, future: "keep", state: { titlePrefix: "new prefix", future: { x: 1 }, accounts: { linear: { defaults: { teamId: "T" }, auth: { accessToken: "new", refreshToken: "r1" } } } } });
  expect(a.getState().accounts).toEqual(b.getState().accounts);
  expect(writes).toBe(3);
});
it("failed intent remains ordered through rehydrate and reconnect", async () => {
  const a = createSettingsStore(); await a.persist.rehydrate();
  failWrite = true; a.getState().removeAccount("linear"); await a.persist.flush();
  await a.persist.rehydrate(); expect(a.getState().accounts.linear).toBeUndefined();
  failWrite = false; a.getState().setAccount("linear", { ...account, auth: { ...auth, grantId: "b", accessToken: "B" } });
  await a.persist.flush();
  expect(raw.state.accounts.linear.auth.accessToken).toBe("B");
});
it("late prefill cannot cross a reconnect and defaults replace shallowly", async () => {
  const a = createSettingsStore(); await a.persist.rehydrate();
  a.getState().setAccount("linear", { ...account, auth: { ...auth, grantId: "b" }, defaults: { teamId: "B" } });
  a.getState().setLastSubmitFields("linear", { teamId: "OLD" }, auth);
  a.getState().updateLinearAccount({ defaults: {} });
  await a.persist.flush();
  expect(raw.state.lastSubmitFields.linear).toBeUndefined();
  expect(raw.state.accounts.linear.defaults).toEqual({});
});
it("initial read failure finishes hydration without replacing durable data", async () => {
  vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(Error("read"));
  const a = createSettingsStore(); await a.persist.rehydrate();
  expect(a.persist.hasHydrated()).toBe(true);
  a.getState().setTitlePrefix("recover"); await a.persist.flush();
  expect(raw.state.accounts.linear.auth.accessToken).toBe("old");
  expect(raw.state.titlePrefix).toBe("recover");
});
it("queues an independent panel and background behind a suspended durable commit", async () => {
  const a = createSettingsStore(), b = createSettingsStore();
  await Promise.all([a.persist.rehydrate(), b.persist.rehydrate()]);
  releaseWrite = () => {};
  a.getState().setTitlePrefix("first");
  await vi.waitFor(() => expect(chrome.storage.local.set).toHaveBeenCalledTimes(1));
  b.getState().updateLinearAccount({ defaults: { teamId: "second" } });
  const background = writeStoredLinearOAuthTokens(auth, { ...auth, accessToken: "new", refreshToken: "r1" });
  await Promise.resolve();
  expect(writes).toBe(0);
  expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
  const release = releaseWrite!; releaseWrite = undefined; release();
  await Promise.all([a.persist.flush(), b.persist.flush(), background]);
  expect(raw.state).toMatchObject({ titlePrefix: "first", accounts: { linear: { defaults: { teamId: "second" }, auth: { accessToken: "new" } } } });
});
it("disconnect-all removes durable accounts absent from a stale panel and explicit undefined deletes", async () => {
  const a = createSettingsStore(); await a.persist.rehydrate();
  raw.state.accounts.github = { auth: { kind: "pat", pat: "p", viewerLogin: "u" } };
  a.getState().updateLinearAccount({ defaults: undefined }); await a.persist.flush();
  expect(raw.state.accounts.linear.defaults).toBeUndefined();
  a.getState().removeAllAccounts(); await a.persist.flush();
  expect(raw.state.accounts).toEqual({}); expect(raw.state.lastSubmitFields).toEqual({});
});
it.each([1, 2, 10, 11, 12])("migrates v%s under the same lock with concurrent panel initialization and background refresh", async (version) => {
  raw = { version, marker: "outer", state: version < 3 ? { unknown: "inner", jiraConfig: version === 1 ? { baseUrl: "https://jira.test", email: "e", apiToken: "t" } : { auth: { kind: "apiKey", baseUrl: "https://jira.test", email: "e", apiToken: "t" } } } : { accounts: { linear: account }, lastSubmitFields: { jira: { relatesKey: "J-1" } }, unknown: "inner" } };
  const a = createSettingsStore(), b = createSettingsStore();
  await Promise.all([a.persist.rehydrate(), b.persist.rehydrate()]);
  expect(raw).toMatchObject({ version: 12, marker: "outer", state: { unknown: "inner" } });
  expect(a.getState().accounts).toEqual(b.getState().accounts);
  if (version < 3) expect(raw.state.accounts.jira.auth.apiToken).toBe("t");
  else { await writeStoredLinearOAuthTokens(auth, { ...auth, accessToken: "rotated" }); expect(raw.state.accounts.linear.auth.accessToken).toBe("rotated"); }
});
it("missing Web Locks never fall back to overwriting", async () => {
  const a = createSettingsStore();
  vi.stubGlobal("navigator", {});
  await a.persist.rehydrate(); expect(writes).toBe(0);
  expect(raw.state.accounts.linear).toBeDefined();
});
it.each(["broken", "{not json", { state: { accounts: "broken" } }, { state: {}, version: "future" }, { state: [] }])("panel hydration discards a corrupt envelope (%j) instead of locking every later write", async (bad) => {
  const { onSettingsReset, onStateSaveFailed } = await import("@/lib/app-events");
  const reset = vi.fn(), failed = vi.fn();
  const offReset = onSettingsReset.subscribe(reset), offFailed = onStateSaveFailed.subscribe(failed);
  raw = structuredClone(bad);
  const a = createSettingsStore(); await a.persist.rehydrate();
  expect(raw).toBeUndefined();
  // 손상 원문(토큰 포함)을 다른 키로 옮겨 남기지 않는다 — 연결 해제가 삭제를 보장하지 못하게 된다.
  expect(vi.mocked(chrome.storage.local.set).mock.calls.flatMap(([items]) => Object.keys(items as object))).not.toContainEqual(expect.not.stringMatching(/^bugshot-settings$/));
  expect(a.persist.hasHydrated()).toBe(true);
  expect(reset).toHaveBeenCalledTimes(1); expect(failed).not.toHaveBeenCalled();
  a.getState().setTitlePrefix("fresh"); await a.persist.flush();
  expect(raw.state.titlePrefix).toBe("fresh");
  a.getState().setAccount("linear", account); await a.persist.flush();
  expect(raw.state.accounts.linear.auth.accessToken).toBe("old");
  offReset(); offFailed();
});
it.each(["read", "lock"])("a transient %s failure during hydration is not mistaken for corruption", async (failure) => {
  if (failure === "read") vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(Error("read"));
  else vi.mocked(navigator.locks.request).mockRejectedValueOnce(Error("lock"));
  const a = createSettingsStore(); await a.persist.rehydrate();
  expect(chrome.storage.local.remove).not.toHaveBeenCalled();
  expect(raw.state.accounts.linear.auth.accessToken).toBe("old");
});
it("clearStorage is not blocked by a failed intent queued ahead of it", async () => {
  const a = createSettingsStore(); await a.persist.rehydrate();
  raw = "{not json";
  a.getState().setTitlePrefix("stuck"); await a.persist.flush();
  await a.persist.clearStorage();
  expect(raw).toBeUndefined();
  a.getState().setTitlePrefix("after-clear"); await a.persist.flush();
  expect(raw.state.titlePrefix).toBe("after-clear");
});
it("background readers stay fail-closed on a corrupt envelope and never discard it", async () => {
  const { readStoredLinearAuth } = await import("@/lib/settings-storage");
  const { SettingsCorruptError } = await import("@/lib/settings-envelope");
  raw = "{not json";
  await expect(readStoredLinearAuth()).rejects.toBeInstanceOf(SettingsCorruptError);
  expect(raw).toBe("{not json"); expect(chrome.storage.local.remove).not.toHaveBeenCalled();
});
it("does not resurrect a migrated legacy Jira connection after disconnect", async () => {
  raw = { version: 2, state: { jiraConfig: { auth: { kind: "oauth", accessToken: "old", refreshToken: "r", expiresAt: 1, cloudId: "s", email: "e", siteUrl: "https://s.test" } } } };
  const a = createSettingsStore(); await a.persist.rehydrate();
  a.getState().removeAccount("jira"); await a.persist.flush();
  const { readStoredAuth } = await import("@/lib/settings-storage");
  expect(await readStoredAuth()).toBeNull();
});
it("production settings sync rebases failed intents over external writes and converges without echo writes", async () => {
  const { installSettingsSync } = await import("@/sidepanel/lib/settings-sync");
  const { onStateSaveFailed } = await import("@/lib/app-events");
  const failed = vi.fn(); const offError = onStateSaveFailed.subscribe(failed);
  const a = createSettingsStore(), b = createSettingsStore();
  await Promise.all([a.persist.rehydrate(), b.persist.rehydrate()]);
  const offA = installSettingsSync(a), offB = installSettingsSync(b);
  failWrite = true; a.getState().setTitlePrefix("pending"); await a.persist.flush();
  expect(failed).toHaveBeenCalledTimes(1);
  expect(a.getState().titlePrefix).toBe("pending");
  failWrite = false;
  await writeStoredLinearOAuthTokens(auth, { ...auth, accessToken: "external", refreshToken: "r1" });
  await vi.waitFor(() => {
    expect(a.getState().accounts.linear!.auth).toMatchObject({ accessToken: "external" });
    expect(b.getState().titlePrefix).toBe("pending");
  });
  await Promise.all([a.persist.flush(), b.persist.flush()]);
  expect(writes).toBe(2);
  expect(raw.state.titlePrefix).toBe("pending");
  offA(); offB(); offError();
});
it("a migration holds the same lock while a second panel and token writer wait", async () => {
  raw.version = 10; raw.state.lastSubmitFields = { jira: { relatesKey: "J-1" } };
  releaseWrite = () => {};
  const a = createSettingsStore(), b = createSettingsStore();
  const first = a.persist.rehydrate();
  await vi.waitFor(() => expect(chrome.storage.local.set).toHaveBeenCalledTimes(1));
  const refresh = writeStoredLinearOAuthTokens(auth, { ...auth, accessToken: "new", refreshToken: "r1" });
  const second = b.persist.rehydrate();
  await Promise.resolve(); expect(writes).toBe(0);
  const release = releaseWrite!; releaseWrite = undefined; release();
  await Promise.all([first, second, refresh]);
  expect(raw.version).toBe(12);
  expect(raw.state.lastSubmitFields.jira).toEqual({ relates: [{ key: "J-1", label: "J-1" }] });
  expect(raw.state.accounts.linear.auth.accessToken).toBe("new");
  expect(b.getState().accounts.linear!.auth).toMatchObject({ accessToken: "new" });
  expect(writes).toBe(2);
});
it("a new intent arriving during a failed commit triggers ordered recovery without a third action", async () => {
  const a = createSettingsStore(); await a.persist.rehydrate();
  let reject!: (error: Error) => void;
  vi.mocked(chrome.storage.local.set).mockImplementationOnce(() => new Promise<void>((_yes, no) => { reject = no; }));
  a.getState().removeAccount("linear");
  await vi.waitFor(() => expect(reject).toBeTypeOf("function"));
  a.getState().setAccount("linear", { ...account, auth: { ...auth, grantId: "new", accessToken: "B" } });
  reject(Error("disk"));
  await vi.waitFor(() => expect(raw.state.accounts.linear?.auth.accessToken).toBe("B"));
});
it("failed clearStorage stays ordered and retries before a later settings action", async () => {
  const a = createSettingsStore(); await a.persist.rehydrate();
  vi.mocked(chrome.storage.local.remove).mockRejectedValueOnce(Error("disk"));
  await a.persist.clearStorage();
  expect(raw.state.accounts.linear).toBeDefined();
  a.getState().setTitlePrefix("after-clear"); await a.persist.flush();
  expect(raw.state.accounts).toEqual({}); expect(raw.state.titlePrefix).toBe("after-clear");
});
it("late hydration completion cannot replace a newer acknowledged local/durable generation", async () => {
  const a = createSettingsStore(), b = createSettingsStore();
  await Promise.all([a.persist.rehydrate(), b.persist.rehydrate()]);
  let release!: () => void;
  const request = vi.mocked(navigator.locks.request);
  const realRequest = request.getMockImplementation()!;
  request.mockImplementationOnce(((name: string, options: object, run: () => unknown) => {
    return (realRequest as any)(name, options, run).then(async (snapshot: unknown) => {
      await new Promise<void>((resolve) => { release = resolve; });
      return snapshot;
    });
  }) as typeof navigator.locks.request);
  const oldHydration = a.persist.rehydrate();
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  a.getState().setTitlePrefix("newer"); await a.persist.flush();
  b.getState().updateLinearAccount({ defaults: { teamId: "external" } }); await b.persist.flush();
  await a.persist.rehydrate();
  release(); await oldHydration;
  expect(a.getState().titlePrefix).toBe("newer");
  expect(a.getState().accounts.linear!.defaults).toEqual({ teamId: "external" });
  expect(raw.state.titlePrefix).toBe("newer");
});
it.each(["read", "lock"])("pending intent survives %s rejection and retries after a production external event", async (failure) => {
  const { installSettingsSync } = await import("@/sidepanel/lib/settings-sync");
  const a = createSettingsStore(); await a.persist.rehydrate();
  const off = installSettingsSync(a);
  if (failure === "read") vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(Error("read"));
  else vi.mocked(navigator.locks.request).mockRejectedValueOnce(Error("lock"));
  a.getState().setTitlePrefix("pending"); await a.persist.flush();
  expect(writes).toBe(0); expect(a.getState().titlePrefix).toBe("pending");
  await writeStoredLinearOAuthTokens(auth, { ...auth, accessToken: "external", refreshToken: "r1" });
  await vi.waitFor(() => expect(raw.state.titlePrefix).toBe("pending"));
  await a.persist.flush();
  expect(raw.state.accounts.linear.auth.accessToken).toBe("external");
  expect(a.getState().accounts.linear!.auth).toMatchObject({ accessToken: "external" });
  expect(writes).toBe(2);
  off();
});
it("clearStorage requested while an intent is in flight still runs after that intent lands", async () => {
  const a = createSettingsStore(); await a.persist.rehydrate();
  releaseWrite = () => {};
  a.getState().setTitlePrefix("in-flight");
  await vi.waitFor(() => expect(chrome.storage.local.set).toHaveBeenCalledTimes(1));
  const clearing = a.persist.clearStorage();
  const release = releaseWrite!; releaseWrite = undefined; release();
  await clearing; await a.persist.flush();
  expect(raw).toBeUndefined();
  expect(a.getState().accounts).toEqual({});
});
it("a reset that lands before the panel subscribes is still reported once", async () => {
  raw = "{not json";
  const a = createSettingsStore(); await a.persist.rehydrate();
  expect(a.persist.takeSettingsReset()).toBe(true);
  expect(a.persist.takeSettingsReset()).toBe(false);
});
it("a second panel that waited on the lock does not discard an envelope another panel already replaced", async () => {
  raw = "{not json";
  const a = createSettingsStore(); await a.persist.rehydrate();
  a.getState().setTitlePrefix("written-after-reset"); await a.persist.flush();
  const { discardCorruptSettingsEnvelope } = await import("@/lib/settings-envelope");
  await discardCorruptSettingsEnvelope();
  expect(raw.state.titlePrefix).toBe("written-after-reset");
});
it("a reset is still reported when re-reading after the discard fails transiently", async () => {
  raw = "{not json";
  const request = vi.mocked(navigator.locks.request);
  const real = request.getMockImplementation()!;
  let calls = 0;
  request.mockImplementation(((name: string, options: object, run: () => unknown) => {
    calls++;
    return calls === 3 ? Promise.reject(Error("lock")) : (real as any)(name, options, run);
  }) as typeof navigator.locks.request);
  const a = createSettingsStore(); await a.persist.rehydrate();
  expect(raw).toBeUndefined();
  expect(a.persist.takeSettingsReset()).toBe(true);
});
