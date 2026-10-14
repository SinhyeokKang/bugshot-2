import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { startGithubOAuth } from "../github-oauth";
import { startGitlabOAuth } from "../gitlab-oauth";
import { startLinearOAuth } from "../linear-oauth";
import { startAsanaOAuth } from "../asana-oauth";
vi.mock("@/i18n", () => ({ t: (key: string) => key }));
const cases = [ ["github", startGithubOAuth], ["gitlab", startGitlabOAuth], ["linear", startLinearOAuth], ["asana", startAsanaOAuth] ] as const;
let raw: any;
let calls: Array<[string, RequestInit]>;
beforeEach(() => {
  raw = undefined; calls = [];
  vi.stubGlobal("chrome", {
    identity: { getRedirectURL: () => "https://abc.chromiumapp.org/", launchWebAuthFlow: async ({ url }: { url: string }) => `https://abc.chromiumapp.org/?code=code&state=${new URL(url).searchParams.get("state")}` },
    storage: { local: { get: async () => ({ "bugshot-settings": structuredClone(raw) }), set: vi.fn() } },
  });
  for (const [p] of cases) vi.stubEnv(`VITE_${p.toUpperCase()}_CLIENT_ID`, "client");
  vi.stubEnv("VITE_OAUTH_PROXY_URL", "https://p.example");
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    calls.push([String(url), init]);
    if (String(url).endsWith("/token") || String(url).endsWith("/refresh")) {
      const body = String(init.body); const refresh = body.includes("refresh_token");
      return new Response(JSON.stringify({ access_token: refresh ? "B2" : "B", refresh_token: refresh ? "RB2" : "RB", expires_in: 3600, scope: "api", token_type: "bearer" }));
    }
    if ((init.headers as any).Authorization === "Bearer B") return new Response("", { status: 401 });
    const profile = { name: "B", login: "b", username: "b", gid: "b", email: "b@example.com" };
    return new Response(JSON.stringify(String(url).includes("graphql") ? { data: { viewer: profile } } : String(url).includes("asana") ? { data: profile } : profile));
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it.each(cases)("%s initial/reconnect flow returns refreshed candidate and unique grants at the same timestamp", async (platform, start) => {
  vi.spyOn(Date, "now").mockReturnValue(123);
  const first = await start();
  raw = { version: 12, state: { accounts: { [platform]: { auth: first } } } };
  const before = structuredClone(raw);
  const second = await start();
  expect(first.grantId).toBeTruthy(); expect(second.grantId).not.toBe(first.grantId);
  expect(first.accessToken).toBe("B2"); expect(second.accessToken).toBe("B2");
  expect(first.refreshToken).toBe("RB2"); expect(second.refreshToken).toBe("RB2");
  expect(raw).toEqual(before); expect(chrome.storage.local.set).not.toHaveBeenCalled();
  const profiles = calls.filter(([url]) => !url.endsWith("/token") && !url.endsWith("/refresh"));
  expect(profiles.map(([,init]) => (init.headers as any).Authorization)).toEqual(["Bearer B", "Bearer B2", "Bearer B", "Bearer B2"]);
  vi.restoreAllMocks();
});
