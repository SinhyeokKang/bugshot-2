import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSettingsStore } from "../settings-store";
import { writeStoredLinearOAuthTokens } from "@/lib/settings-storage";

const auth = { kind: "oauth" as const, grantId: "grant-a", accessToken: "old", refreshToken: "r0", expiresAt: 1, scope: "read", viewerName: "me", grantedAt: 1 };
const account = { platform: "linear" as const, connectedAt: 1, auth, defaults: {} };
let raw: any;
let writes: number;
let failWrite: boolean;
let lockTail: Promise<unknown>;
let releaseWrite: (() => void) | undefined;
beforeEach(() => {
  raw = { version: 99, future: "keep", state: { accounts: { linear: account }, lastSubmitFields: {}, titlePrefix: "", future: { x: 1 } } };
  writes = 0; failWrite = false; lockTail = Promise.resolve(); releaseWrite = undefined;
  vi.stubGlobal("navigator", { locks: { request: vi.fn((_name, _opts, run) => {
    const result = lockTail.then(run); lockTail = result.catch(() => {}); return result;
  }) } });
  vi.stubGlobal("chrome", { storage: { local: {
    get: vi.fn(async () => ({ "bugshot-settings": structuredClone(raw) })),
    set: vi.fn(async (items) => { if (failWrite) throw Error("disk"); if (releaseWrite) await new Promise<void>((r) => { releaseWrite = r; }); raw = structuredClone(items["bugshot-settings"]); if (typeof raw === "string") raw = JSON.parse(raw); writes++; }),
    remove: vi.fn(async () => { raw = undefined; }),
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
