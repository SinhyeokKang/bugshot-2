import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { jiraFetch } from "../jira-api";
import { githubFetch } from "../github-api";
import { gitlabFetch } from "../gitlab-api";
import { asanaFetch } from "../asana-api";
import { getMyself as linearMyself } from "../linear-api";
import "../github-oauth";
import "../gitlab-oauth";
import "../linear-oauth";
import "../asana-oauth";
import { acquireStoredAuth } from "@/lib/settings-storage";
import { createAuthCandidate } from "../lib/authContext";
vi.mock("@/i18n", () => ({ t: (key: string) => key }));
const base = { kind: "oauth" as const, accessToken: "A", refreshToken: "RA", grantId: "ga", expiresAt: 9e15, grantedAt: 1 };
const cases = [
  { platform: "jira", auth: { ...base, cloudId: "site-a", siteUrl: "https://a.atlassian.net", email: "a" }, request: (a: any) => jiraFetch(a, "/rest/api/3/myself"), url: "https://api.atlassian.com/ex/jira/site-a/rest/api/3/myself", refresh: "https://p.example/token" },
  { platform: "github", auth: { ...base, viewerLogin: "a", scope: "repo", tokenType: "bearer" }, request: (a: any) => githubFetch(a, "/user"), url: "https://api.github.com/user", refresh: "https://p.example/github/refresh" },
  { platform: "gitlab", auth: { ...base, viewerUsername: "a", scope: "api", baseUrl: "https://gitlab.com" }, request: (a: any) => gitlabFetch(a, "/user"), url: "https://gitlab.com/api/v4/user", refresh: "https://gitlab.com/oauth/token" },
  { platform: "linear", auth: { ...base, viewerName: "a", scope: "read" }, request: (a: any) => linearMyself(a), url: "https://api.linear.app/graphql", refresh: "https://api.linear.app/oauth/token" },
  { platform: "asana", auth: { ...base, viewerName: "a", viewerGid: "1" }, request: (a: any) => asanaFetch(a, "/users/me"), url: "https://app.asana.com/api/1.0/users/me", refresh: "https://p.example/asana/refresh" },
] as const;
let raw: any;
let requests: Array<{ url: string; init: RequestInit }>;
let first: () => Promise<Response>;
function ok() { return new Response(JSON.stringify({ data: { viewer: { name: "a" } } })); }
beforeEach(() => {
  raw = undefined; requests = []; first = async () => new Response("", { status: 401 });
  let tail = Promise.resolve();
  vi.stubGlobal("navigator", { locks: { request: (_name: string, _opts: object, run: () => Promise<any>) => { const next = tail.then(run); tail = next.catch(() => {}); return next; } } });
  vi.stubGlobal("chrome", { storage: { local: {
    get: async () => ({ "bugshot-settings": structuredClone(raw) }),
    set: async (x: any) => { raw = structuredClone(x["bugshot-settings"]); if (typeof raw === "string") raw = JSON.parse(raw); },
  } }, identity: { getRedirectURL: () => "https://abc.chromiumapp.org/" } });
  for (const p of cases) vi.stubEnv(`VITE_${p.platform.toUpperCase()}_CLIENT_ID`, "client");
  vi.stubEnv("VITE_ATLASSIAN_CLIENT_ID", "client");
  vi.stubEnv("VITE_OAUTH_PROXY_URL", "https://p.example");
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("/token") || String(url).endsWith("/refresh")) return new Response(JSON.stringify({ access_token: "A2", refresh_token: "RA2", expires_in: 3600, scope: "read", token_type: "bearer" }));
    return requests.filter((r) => r.url === String(url)).length === 1 ? first() : ok();
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function seed(c: typeof cases[number], auth: unknown = c.auth) { raw = { version: 12, state: { accounts: { [c.platform]: { auth } }, lastSubmitFields: {}, titlePrefix: "" } }; }
it.each(cases)("$platform: late 401 after reconnect never uses the replacement grant", async (c) => {
  seed(c); first = async () => { seed(c, { ...c.auth, grantId: "gb", accessToken: "B", refreshToken: "RB" }); return new Response("", { status: 401 }); };
  await expect(c.request(c.auth)).rejects.toThrow("platform.accountChanged.title");
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe(c.url);
  expect((requests[0].init.headers as any).Authorization).toBe("Bearer A");
  expect(raw.state.accounts[c.platform].auth.accessToken).toBe("B");
});
it.each(cases)("$platform: stored 401 refresh retains metadata and uses only start credentials", async (c) => {
  seed(c); await c.request(c.auth);
  expect(requests.map((r) => r.url)).toEqual([c.url, c.refresh, c.url]);
  expect((requests[2].init.headers as any).Authorization).toBe("Bearer A2");
  const body = requests[1].init.body instanceof URLSearchParams ? Object.fromEntries(requests[1].init.body) : JSON.parse(String(requests[1].init.body));
  expect(body).toEqual({ refresh_token: "RA", client_id: "client", ...(["jira", "linear", "gitlab"].includes(c.platform) ? { grant_type: "refresh_token" } : {}), ...(c.platform === "gitlab" ? { redirect_uri: "https://abc.chromiumapp.org/" } : {}) });
  expect((requests[0].init.headers as any).Authorization).toBe("Bearer A");
  expect(raw.state.accounts[c.platform].auth).toEqual({ ...c.auth, accessToken: "A2", refreshToken: "RA2", expiresAt: expect.any(Number), ...(["github", "gitlab", "linear"].includes(c.platform) ? { scope: "read" } : {}) });
});
it.each(cases)("$platform: pre-refresh and explicit candidate 401 keep existing durable auth", async (c) => {
  seed(c, { ...c.auth, grantId: "stored", accessToken: "stored" });
  const before = structuredClone(raw);
  const candidate = createAuthCandidate({ ...c.auth, grantId: "candidate" });
  await c.request(candidate.current);
  expect(candidate.current.accessToken).toBe("A2");
  expect(raw).toEqual(before);
  expect(requests.map((r) => r.url)).toEqual([c.url, c.refresh, c.url]);
  requests = [];
  const expired = createAuthCandidate({ ...c.auth, grantId: "candidate2", expiresAt: 0 });
  first = async () => ok(); await c.request(expired.current);
  expect(requests.map((r) => r.url)).toEqual([c.refresh, c.url]);
  expect(raw).toEqual(before);
});
it.each(cases)("$platform: concurrent legacy acquisition returns one canonical grant before rotation", async (c) => {
  const { grantId: _id, ...legacy } = c.auth; seed(c, legacy);
  const [a,b] = await Promise.all([acquireStoredAuth(c.platform, legacy), acquireStoredAuth(c.platform, legacy)]);
  expect((a as any).grantId).toBeTruthy(); expect(a).toEqual(b);
  await c.request(a);
  await expect(c.request(legacy)).rejects.toThrow("platform.accountChanged.title");
});
it.each(cases)("$platform: same grant concurrent refresh is deduplicated and late requests reuse rotation", async (c) => {
  seed(c, { ...c.auth, expiresAt: 0 });
  const requested = { ...c.auth, expiresAt: 0 };
  first = async () => ok();
  await Promise.all([c.request(requested), c.request(requested)]);
  expect(requests.filter((r) => r.url === c.refresh)).toHaveLength(1);
  await c.request(requested);
  expect(requests.filter((r) => r.url === c.refresh)).toHaveLength(1);
  expect(requests.filter((r) => r.url === c.url).every((r) => (r.init.headers as any).Authorization === "Bearer A2")).toBe(true);
});
it.each(cases)("$platform: a late refresh failure after replacement is neutral", async (c) => {
  seed(c);
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url) === c.refresh) { seed(c, { ...c.auth, grantId: "new", accessToken: "B" }); return new Response("revoked", { status: 400 }); }
    return new Response("", { status: 401 });
  }));
  const error = await c.request(c.auth).catch((e) => e);
  expect((error as Error).message).toContain("platform.accountChanged.title");
  expect((error as { refreshFailed?: boolean }).refreshFailed).not.toBe(true);
  expect(raw.state.accounts[c.platform].auth.accessToken).toBe("B");
});
it.each([false, true])("Jira media delayed probes stop after reconnect (already refreshed=%s)", async (refreshFirst) => {
  const c = cases[0]; seed(c);
  let count = 0;
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url) === c.refresh) return new Response(JSON.stringify({ access_token: "A2", refresh_token: "RA2", expires_in: 3600 }));
    return new Response("", { status: refreshFirst && count++ === 0 ? 401 : 200 });
  }));
  const { getMediaFileId } = await import("../jira-api");
  await expect(getMediaFileId(c.auth, "attachment", async () => { seed(c, { ...c.auth, grantId: "new", accessToken: "B" }); })).rejects.toThrow("platform.accountChanged.title");
  expect(requests).toHaveLength(refreshFirst ? 4 : 2);
});
it.each([cases[1], cases[4]])("$platform retains an omitted refresh token and reuses the access-token rotation", async (c) => {
  seed(c, { ...c.auth, expiresAt: 0 });
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url) === c.refresh) return new Response(JSON.stringify({ access_token: "A2", expires_in: 3600, scope: "repo", token_type: "bearer" }));
    return ok();
  }));
  await c.request({ ...c.auth, expiresAt: 0 }); await c.request(c.auth);
  expect(raw.state.accounts[c.platform].auth.refreshToken).toBe("RA");
  expect(requests.filter((r) => r.url === c.refresh)).toHaveLength(1);
  expect(requests.filter((r) => r.url === c.url).every((r) => (r.init.headers as any).Authorization === "Bearer A2")).toBe(true);
});
it("GitHub tokens without refresh tokens remain usable until a real 401", async () => {
  const c = cases[1]; const auth = { ...c.auth, refreshToken: undefined, expiresAt: undefined }; seed(c, auth);
  first = async () => ok(); await c.request(auth);
  expect(requests).toHaveLength(1);
});
it.each(cases)("$platform missing storage or read/lock/write failure never becomes an expiration", async (c) => {
  for (const failure of ["missing", "read", "lock", "write"] as const) {
    seed(c);
    const originalGet = chrome.storage.local.get, originalSet = chrome.storage.local.set, originalLocks = navigator.locks;
    if (failure === "missing") raw = undefined;
    if (failure === "read") chrome.storage.local.get = vi.fn(async () => { throw Error("disk read"); });
    if (failure === "write") chrome.storage.local.set = vi.fn(async () => { throw Error("disk write"); });
    if (failure === "lock") Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    requests = []; first = async () => new Response("", { status: 401 });
    const error = await c.request(c.auth).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error); expect(error).not.toHaveProperty("refreshFailed", true);
    if (failure !== "write") expect(requests).toHaveLength(0);
    chrome.storage.local.get = originalGet; chrome.storage.local.set = originalSet;
    Object.defineProperty(navigator, "locks", { configurable: true, value: originalLocks });
  }
});
it.each(cases)("$platform: a new grant refresh runs independently while the old grant remains in flight", async (c) => {
  const old = { ...c.auth, expiresAt: 0 }; seed(c, old);
  let finishOld!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url) === c.refresh) {
      const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : JSON.parse(String(init.body));
      if (body.refresh_token === "RA") return new Promise((resolve) => { finishOld = resolve; });
      expect(body.refresh_token).toBe("RB");
      return new Response(JSON.stringify({ access_token: "B2", refresh_token: "RB2", expires_in: 3600, token_type: "bearer", scope: "read" }));
    }
    expect((init.headers as any).Authorization).toBe("Bearer B2"); return ok();
  }));
  const oldResult = c.request(old).catch((error: unknown) => error);
  await vi.waitFor(() => expect(finishOld).toBeTypeOf("function"));
  const replacement = { ...old, grantId: "gb", accessToken: "B", refreshToken: "RB" }; seed(c, replacement);
  await c.request(replacement);
  finishOld(new Response(JSON.stringify({ access_token: "A2", refresh_token: "RA2", expires_in: 3600, token_type: "bearer", scope: "read" })));
  expect(await oldResult).toBeInstanceOf(Error);
  expect(raw.state.accounts[c.platform].auth).toMatchObject({ grantId: "gb", accessToken: "B2", refreshToken: "RB2" });
  expect(requests.filter((r) => r.url === c.refresh)).toHaveLength(2);
  expect(requests.filter((r) => r.url === c.url)).toHaveLength(1);
});
it.each(cases)("$platform: a rejected refresh flight is cleared before the next legitimate request", async (c) => {
  const expired = { ...c.auth, expiresAt: 0 }; seed(c, expired);
  let refreshCount = 0;
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url) === c.refresh) {
      if (++refreshCount === 1) return new Response("temporary rejection", { status: 503 });
      return new Response(JSON.stringify({ access_token: "A2", refresh_token: "RA2", expires_in: 3600, token_type: "bearer", scope: "read" }));
    }
    expect((init.headers as any).Authorization).toBe("Bearer A2"); return ok();
  }));
  await expect(c.request(expired)).rejects.toThrow();
  await c.request(expired);
  expect(refreshCount).toBe(2);
  expect(raw.state.accounts[c.platform].auth.accessToken).toBe("A2");
});
