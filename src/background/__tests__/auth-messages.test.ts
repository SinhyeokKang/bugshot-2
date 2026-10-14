import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { BgRequest, BgResponse } from "@/types/messages";

import { onOAuthExpired } from "@/lib/app-events";
import { BgError, sendBg } from "@/lib/bg-client";

vi.mock("@/i18n", () => ({ t: (key: string) => key }));

vi.mock("@/i18n/bg-init", () => ({ initBgLocale: vi.fn() }));
vi.mock("@/lib/pending-log-prune", () => ({ pruneOrphanPendingLogsOncePerSession: vi.fn() }));
vi.mock("../tab-bindings", () => ({ setupTabBindings: vi.fn() }));

let raw: any;
let failWrite = false;
let listener: (request: BgRequest, sender: chrome.runtime.MessageSender, respond: (response: BgResponse) => void) => boolean | undefined;
let responses: BgResponse[];
const expired = vi.fn();
let unsubscribe: () => void;
const fetchMock = vi.fn<typeof fetch>();

beforeAll(async () => {
  const event = () => ({ addListener: vi.fn() });
  vi.stubGlobal("navigator", { locks: { request: async (_name: string, _opts: object, run: () => unknown) => run() } });
  vi.stubGlobal("chrome", {
    identity: { getRedirectURL: () => "https://abc.chromiumapp.org/" },
    storage: { local: {
      get: async () => ({ "bugshot-settings": structuredClone(raw) }),
      set: async (data: any) => { if (failWrite) throw Error("disk"); raw = structuredClone(data["bugshot-settings"]); },
    } },
    runtime: {
      onInstalled: event(), onStartup: event(), onConnect: event(),
      onMessage: { addListener: (callback: typeof listener) => { listener = callback; } },
      sendMessage: (request: BgRequest, callback: (response: BgResponse) => void) => {
        const keepAlive = listener(request, {}, (response) => {
          const wire: BgResponse = JSON.parse(JSON.stringify(response));
          responses.push(wire);
          callback(wire);
        });
        expect(keepAlive).toBe(true);
      },
    },
    contextMenus: { onClicked: event() },
    webNavigation: { onBeforeNavigate: event(), onCommitted: event() },
  });
  await import("../index");
});

beforeEach(() => {
  responses = [];
  raw = undefined; failWrite = false;
  for (const p of ["github", "gitlab", "linear", "asana"]) vi.stubEnv(`VITE_${p.toUpperCase()}_CLIENT_ID`, "client");
  vi.stubEnv("VITE_ATLASSIAN_CLIENT_ID", "client");
  vi.stubEnv("VITE_OAUTH_PROXY_URL", "https://p.example");
  expired.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  unsubscribe = onOAuthExpired.subscribe(expired);
});
afterEach(() => { unsubscribe(); });
afterAll(() => { vi.unstubAllGlobals(); });

const auth = { kind: "oauth" as const, grantId: "a", accessToken: "A", refreshToken: "RA", expiresAt: 9e15, cloudId: "site-a", siteUrl: "https://a.atlassian.net", email: "a" };
function seed() { raw = { version: 12, state: { accounts: { jira: { auth } }, lastSubmitFields: {}, titlePrefix: "" } }; }
it.each([false, true])("explicit Jira candidate refresh crosses serialization without changing durable auth (existing=%s)", async (existing) => {
  if (existing) seed();
  const before = structuredClone(raw);
  fetchMock.mockResolvedValueOnce(new Response("", { status: 401 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "B2", refresh_token: "RB2", expires_in: 3600 })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ accountId: "b", emailAddress: "b@example.com", displayName: "B" })));
  const result = await sendBg({ type: "jira.myself", context: "candidate", config: { ...auth, grantId: "b", accessToken: "B", refreshToken: "RB" } });
  expect(result).toMatchObject({ auth: { grantId: "b", accessToken: "B2", refreshToken: "RB2" }, profile: { accountId: "b" } });
  expect(raw).toEqual(before); expect(expired).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["https://api.atlassian.com/ex/jira/site-a/rest/api/3/myself", "https://p.example/token", "https://api.atlassian.com/ex/jira/site-a/rest/api/3/myself"]);
  expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string).refresh_token).toBe("RB");
});
it.each(["stale", "storage", "revoked"])("Jira %s failure produces the correct global expiration signal", async (mode) => {
  seed();
  fetchMock.mockImplementation(async (url) => {
    if (String(url).endsWith("/token")) {
      if (mode === "stale") raw.state.accounts.jira.auth = { ...auth, grantId: "b", accessToken: "B" };
      if (mode === "storage") { failWrite = true; return new Response(JSON.stringify({ access_token: "A2", refresh_token: "RA2", expires_in: 3600 })); }
      return new Response("revoked", { status: 400 });
    }
    return new Response("", { status: 401 });
  });
  await expect(sendBg({ type: "jira.myself", config: auth })).rejects.toBeInstanceOf(BgError);
  expect(expired).toHaveBeenCalledTimes(mode === "revoked" ? 1 : 0);
  if (mode !== "revoked") expect(responses[0]).not.toHaveProperty("body.oauthRefreshFailed", true);
});
it("every serialized candidate waiter receives the shared refresh result", async () => {
  seed(); const before = structuredClone(raw);
  let finish!: (response: Response) => void;
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url).endsWith("/token")) return new Promise((resolve) => { finish = resolve; });
    if ((init!.headers as any).Authorization === "Bearer B") return new Response("", { status: 401 });
    return new Response(JSON.stringify({ accountId: "b", emailAddress: "b@example.com" }));
  });
  const candidate = { ...auth, grantId: "b", accessToken: "B", refreshToken: "RB" };
  const pending = [1, 2].map(() => sendBg({ type: "jira.myself", context: "candidate", config: structuredClone(candidate) }));
  await vi.waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => !String(url).endsWith("/token"))).toHaveLength(2));
  finish(new Response(JSON.stringify({ access_token: "B2", refresh_token: "RB2", expires_in: 3600 })));
  for (const result of await Promise.all(pending)) expect(result).toMatchObject({ auth: { accessToken: "B2", refreshToken: "RB2" } });
  expect(raw).toEqual(before);
});
const providerAuth = {
  jira: auth,
  github: { kind: "oauth", grantId: "a", accessToken: "A", refreshToken: "RA", expiresAt: 9e15, tokenType: "bearer", scope: "repo", viewerLogin: "a", grantedAt: 1 },
  gitlab: { kind: "oauth", grantId: "a", accessToken: "A", refreshToken: "RA", expiresAt: 9e15, baseUrl: "https://gitlab.com", scope: "api", viewerUsername: "a", grantedAt: 1 },
  linear: { kind: "oauth", grantId: "a", accessToken: "A", refreshToken: "RA", expiresAt: 9e15, scope: "read", viewerName: "a", grantedAt: 1 },
  asana: { kind: "oauth", grantId: "a", accessToken: "A", refreshToken: "RA", expiresAt: 9e15, viewerName: "a", viewerGid: "a", grantedAt: 1 },
};
it.each(Object.keys(providerAuth) as Array<keyof typeof providerAuth>)("%s neutral failures and actual revocation retain their meaning through serialization and bg-client", async (platform) => {
  for (const mode of ["read", "lock", "write", "stale", "revoked"] as const) {
    raw = { version: 12, state: { accounts: { [platform]: { auth: providerAuth[platform] } }, lastSubmitFields: {}, titlePrefix: "" } };
    expired.mockClear(); responses = []; failWrite = mode === "write";
    const read = mode === "read" ? vi.spyOn(chrome.storage.local, "get").mockRejectedValue(Error("read")) : undefined;
    const lock = mode === "lock" ? vi.spyOn(navigator.locks, "request").mockRejectedValue(Error("lock")) : undefined;
    fetchMock.mockImplementation(async (url) => {
      if (String(url).endsWith("/token") || String(url).endsWith("/refresh")) {
        if (mode === "stale") raw.state.accounts[platform].auth = { ...providerAuth[platform], grantId: "b", accessToken: "B" };
        return mode === "write" ? new Response(JSON.stringify({ access_token: "A2", refresh_token: "RA2", expires_in: 3600, scope: "read", token_type: "bearer" })) : new Response("revoked", { status: 400 });
      }
      return new Response("", { status: 401 });
    });
    const request: BgRequest = platform === "jira" ? { type: "jira.myself", config: auth } : { type: `${platform}.getMyself` };
    await expect(sendBg(request)).rejects.toBeInstanceOf(BgError);
    expect(expired).toHaveBeenCalledTimes(mode === "revoked" ? 1 : 0);
    if (mode === "revoked") expect(responses[0]).toMatchObject({ status: 401, body: { oauthRefreshFailed: true, platform } });
    else expect(responses[0]).not.toHaveProperty("body.oauthRefreshFailed", true);
    read?.mockRestore(); lock?.mockRestore();
  }
});
