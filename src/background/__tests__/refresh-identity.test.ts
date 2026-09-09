import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({ t: (key: string) => key }));

import { refreshGithubToken } from "../github-oauth";
import { refreshLinearToken } from "../linear-oauth";
import { refreshGitlabToken } from "../gitlab-oauth";
import { refreshAsanaToken } from "../asana-oauth";

/**
 * storage writer의 그랜트 신원 게이트(`lib/settings-storage.ts:writer`)는 **정상 갱신이
 * 신원 필드를 그대로 넘긴다**는 전제 하나로 서 있다. 특히 `grantedAt` — 재연동은 그걸 새로
 * 찍고 갱신은 안 찍기 때문에, 게이트가 "재연동 뒤 뒤늦게 돌아온 옛 갱신"을 그 필드로 가른다.
 *
 * 어느 refresh가 `grantedAt: Date.now()`를 넣기 시작하면 게이트가 정상 회전을 **무음 no-op**으로
 * 만들고, 그러면 회전된 refresh token이 유실돼 다음 갱신이 invalid_grant가 된다 — 이 픽스가
 * 없애려던 강제 재연동과 증상이 같고 원인만 뒤집힌 형태다. 그 전제를 여기서 못 박는다.
 * (jira는 `JiraOAuthAuth`에 grantedAt이 없고, notion·clickup·slack은 refresh 경로가 없다.)
 */
const GRANTED_AT = 1_700_000_000_000;

const CASES = [
  {
    name: "github",
    env: { VITE_GITHUB_CLIENT_ID: "gh", VITE_OAUTH_PROXY_URL: "https://p.example" },
    auth: {
      kind: "oauth",
      accessToken: "old",
      tokenType: "bearer",
      scope: "repo",
      refreshToken: "r0",
      expiresAt: 1,
      viewerLogin: "octocat",
      grantedAt: GRANTED_AT,
    },
    body: { access_token: "new", token_type: "bearer", scope: "repo", refresh_token: "r1", expires_in: 3600 },
    run: refreshGithubToken,
  },
  {
    name: "linear",
    env: { VITE_LINEAR_CLIENT_ID: "ln", VITE_OAUTH_PROXY_URL: "https://p.example" },
    auth: {
      kind: "oauth",
      accessToken: "old",
      refreshToken: "r0",
      expiresAt: 1,
      scope: "read",
      viewerName: "me",
      grantedAt: GRANTED_AT,
    },
    body: { access_token: "new", refresh_token: "r1", expires_in: 3600, scope: "read" },
    run: refreshLinearToken,
  },
  {
    name: "gitlab",
    env: { VITE_GITLAB_CLIENT_ID: "gl", VITE_OAUTH_PROXY_URL: "https://p.example" },
    auth: {
      kind: "oauth",
      accessToken: "old",
      refreshToken: "r0",
      expiresAt: 1,
      scope: "api",
      baseUrl: "https://gitlab.self.io",
      viewerUsername: "me",
      grantedAt: GRANTED_AT,
    },
    body: { access_token: "new", refresh_token: "r1", expires_in: 3600, scope: "api" },
    run: refreshGitlabToken,
  },
  {
    name: "asana",
    env: { VITE_ASANA_CLIENT_ID: "as", VITE_OAUTH_PROXY_URL: "https://p.example" },
    auth: {
      kind: "oauth",
      accessToken: "old",
      refreshToken: "r0",
      expiresAt: 1,
      viewerGid: "g1",
      viewerName: "me",
      grantedAt: GRANTED_AT,
    },
    body: { access_token: "new", refresh_token: "r1", expires_in: 3600 },
    run: refreshAsanaToken,
  },
] as const;

beforeEach(() => {
  vi.stubGlobal("chrome", {
    storage: { local: { get: async () => ({}), set: async () => {} } },
    // gitlab refresh는 redirect_uri를 함께 실어 보낸다.
    identity: { getRedirectURL: () => "https://abc.chromiumapp.org/" },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("refresh는 계정 신원을 그대로 넘긴다 (writer 게이트의 전제)", () => {
  it.each(CASES)("$name: grantedAt을 새로 찍지 않는다", async ({ env, auth, body, run }) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => "",
      }) as unknown as Response),
    );

    const out = (await run(auth as never)) as unknown as Record<string, unknown>;

    expect(out.grantedAt).toBe(GRANTED_AT);
    // 토큰은 갱신되고 신원은 그대로여야 게이트가 이 갱신을 통과시킨다.
    expect(out.accessToken).toBe("new");
  });
});
