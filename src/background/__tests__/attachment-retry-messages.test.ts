import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreatedDestination } from "@/types/attachment";
import type { BgRequest } from "@/types/messages";

const stored = vi.hoisted(() => ({ auth: {} as Record<string, unknown> }));
vi.mock("@/lib/settings-storage", async (original) => ({
  ...(await original<object>()),
  readStoredAuth: vi.fn(async () => stored.auth.jira ?? null),
  readStoredGithubAuth: vi.fn(async () => stored.auth.github ?? null),
  readStoredGitlabAuth: vi.fn(async () => stored.auth.gitlab ?? null),
  readStoredLinearAuth: vi.fn(async () => stored.auth.linear ?? null),
  readStoredNotionAuth: vi.fn(async () => stored.auth.notion ?? null),
  readStoredAsanaAuth: vi.fn(async () => stored.auth.asana ?? null),
  readStoredClickupAuth: vi.fn(async () => stored.auth.clickup ?? null),
  readStoredSlackAuth: vi.fn(async () => stored.auth.slack ?? null),
}));
import { handleMessage } from "../messages";
import { BG_REQUEST_TYPES } from "../bgRequestTypes";

const AUTH = {
  jira: { kind: "oauth", cloudId: "cloud-1", siteUrl: "https://acme.atlassian.net", email: "a@b.c", accessToken: "t1", refreshToken: "r1", expiresAt: Date.now() + 3600_000 },
  github: { kind: "pat", pat: "p1", viewerLogin: "old-login" },
  gitlab: { kind: "pat", pat: "p1", baseUrl: "https://gitlab.example", viewerUsername: "u" },
  linear: { kind: "apiKey", apiKey: "k1", viewerName: "u" },
  notion: { kind: "oauth", accessToken: "t1", botId: "bot", workspaceId: "ws", workspaceName: "W", botName: "B", grantedAt: 1 },
  asana: { kind: "pat", pat: "p1", viewerGid: "u", viewerName: "u" },
  clickup: { kind: "pat", pat: "p1", viewerId: "u", viewerName: "u" },
  slack: { kind: "oauth", accessToken: "xoxp-1", viewerId: "U1", viewerName: "u", grantedAt: 1 },
} as const;
const DESTINATION: Record<keyof typeof AUTH, CreatedDestination> = {
  jira: { platform: "jira", key: "BUG-1", locator: { issueKey: "BUG-1", siteId: "cloud-1" } },
  github: { platform: "github", key: "#1", locator: { owner: "o", repo: "r", number: "1" } },
  gitlab: { platform: "gitlab", key: "#1", locator: { projectId: "4", iid: "1" } },
  linear: { platform: "linear", key: "L-1", locator: { issueId: "issue" } },
  notion: { platform: "notion", key: "abc", locator: { pageId: "page" } },
  asana: { platform: "asana", key: "task", locator: { taskGid: "task" } },
  clickup: { platform: "clickup", key: "task", locator: { taskId: "task" } },
  slack: { platform: "slack", key: "1.2", locator: { channelId: "C1", ts: "1.2" } },
};
// URL substring → JSON body. Order-independent so parallel reads stay deterministic.
function route(table: Array<[string, unknown]>) {
  const fetch = vi.fn(async (url: string) => {
    const hit = table.find(([part]) => String(url).includes(part));
    if (!hit) throw new Error(`unexpected fetch ${url}`);
    return new Response(JSON.stringify(hit[1]), { status: 200 });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
const IDENTITY_ROUTES = (user: string): Record<keyof typeof AUTH, Array<[string, unknown]>> => ({
  jira: [["/rest/api/3/myself", { accountId: user }]],
  github: [["api.github.com/user", { id: Number(user.replace(/\D/g, "")) || 1, login: "renamed" }]],
  gitlab: [["/api/v4/user", { id: Number(user.replace(/\D/g, "")) || 1, username: "u" }]],
  linear: [["linear.app/graphql", { data: { viewer: { id: user }, organization: { id: "org" } } }]],
  notion: [],
  asana: [["/tasks/task", { data: { workspace: { gid: "ws" } } }], ["/users/me", { data: { gid: user } }]],
  clickup: [["/task/task", { team_id: "team" }], ["/user", { user: { id: user } }]],
  slack: [["auth.test", { ok: true, user_id: user, team_id: "T1", user: "u", team: "t" }]],
});
const identity = (platform: keyof typeof AUTH) => handleMessage({ type: `${platform}.getAccountIdentity`, destination: DESTINATION[platform] } as BgRequest, {}) as Promise<{ identity: string }>;

beforeEach(() => { stored.auth = { ...AUTH }; });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("message registries", () => {
  const added = [
    ...["jira", "github", "gitlab", "linear", "notion", "asana", "clickup", "slack"].map((p) => `${p}.getAccountIdentity`),
    "github.getIssueBody", "github.updateIssueBody", "gitlab.getIssueDescription", "jira.getIssueAttachments",
    "linear.getIssueAttachments", "notion.getBlockChildren", "notion.appendBlockChildren", "notion.deleteBlock", "notion.getFileUpload",
    "asana.getTaskAttachments", "clickup.getTaskAttachments", "slack.requestFileUpload", "slack.sendFileUpload", "slack.completeFileUploads",
  ];
  it.each(added)("routes %s through the allowlist", (type) => {
    expect(BG_REQUEST_TYPES.has(type)).toBe(true);
    expect(readFileSync("src/types/messages.ts", "utf8")).toContain(type.endsWith(".getAccountIdentity") ? ".getAccountIdentity" : `"${type}"`);
  });
  it("retires the batched Slack upload message from every routing layer", () => {
    for (const path of ["src/types/messages.ts", "src/background/messages.ts", "src/background/bgRequestTypes.ts"]) {
      expect(readFileSync(path, "utf8")).not.toContain('"slack.uploadFiles"');
    }
  });
});

describe("account identity", () => {
  it.each(Object.keys(AUTH) as Array<keyof typeof AUTH>)("%s resolves a stable identity from the current connection", async (platform) => {
    route(IDENTITY_ROUTES("user7")[platform]);
    const first = await identity(platform);
    expect(JSON.parse(first.identity)[0]).toBe(platform);
    expect(first.identity).not.toMatch(/xoxp|p1|k1|t1|old-login|renamed/);
    stored.auth = { ...AUTH, [platform]: { ...AUTH[platform], ...("accessToken" in AUTH[platform] ? { accessToken: "refreshed" } : {}), ...("pat" in AUTH[platform] ? { pat: "rotated" } : {}), ...("apiKey" in AUTH[platform] ? { apiKey: "rotated" } : {}) } };
    route(IDENTITY_ROUTES("user7")[platform]);
    expect((await identity(platform)).identity).toBe(first.identity);
  });

  it.each(["jira", "github", "gitlab", "linear", "asana", "clickup", "slack"] as const)("%s differs for another account", async (platform) => {
    route(IDENTITY_ROUTES("user7")[platform]);
    const first = await identity(platform);
    route(IDENTITY_ROUTES("user8")[platform]);
    expect((await identity(platform)).identity).not.toBe(first.identity);
  });

  it("uses the connected Jira site, so another site is another identity", async () => {
    route(IDENTITY_ROUTES("user7").jira);
    const first = await identity("jira");
    stored.auth = { ...AUTH, jira: { ...AUTH.jira, cloudId: "cloud-2" } };
    expect((await identity("jira")).identity).not.toBe(first.identity);
  });

  it("uses the GitLab base URL, so a self-managed origin is another identity", async () => {
    route(IDENTITY_ROUTES("user7").gitlab);
    const first = await identity("gitlab");
    stored.auth = { ...AUTH, gitlab: { ...AUTH.gitlab, baseUrl: "https://other.example" } };
    route([["/api/v4/user", { id: 7 }]]);
    expect((await identity("gitlab")).identity).not.toBe(first.identity);
  });

  it("uses stored OAuth IDs for Notion and the users/me workspace for an API key", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect(JSON.parse((await identity("notion")).identity)).toEqual(["notion", "ws", "bot"]);
    stored.auth = { ...AUTH, notion: { kind: "apiKey", token: "secret", botName: "B" } };
    route([["/users/me", { id: "bot-user", type: "bot", bot: { workspace_id: "ws2" } }]]);
    expect(JSON.parse((await identity("notion")).identity)).toEqual(["notion", "ws2", "bot-user"]);
  });

  it("rejects when the fixed Notion version omits the API-key workspace", async () => {
    stored.auth = { ...AUTH, notion: { kind: "apiKey", token: "secret", botName: "B" } };
    route([["/users/me", { id: "bot-user", type: "bot", bot: {} }]]);
    await expect(identity("notion")).rejects.toThrow();
  });

  it("rejects when the platform is disconnected", async () => {
    stored.auth = {};
    vi.stubGlobal("fetch", vi.fn());
    await expect(identity("github")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Slack staged upload handlers", () => {
  it("returns the allocation, sends one file's bytes and completes once", async () => {
    const fetch = route([
      ["files.getUploadURLExternal", { ok: true, file_id: "F1", upload_url: "https://files.slack.com/upload/v1/x" }],
      ["files.slack.com/upload", {}],
      ["files.completeUploadExternal", { ok: true, files: [{ id: "F1" }] }],
    ]);
    expect(await handleMessage({ type: "slack.requestFileUpload", filename: "a.txt", length: 1 }, {})).toEqual({ fileId: "F1", uploadUrl: "https://files.slack.com/upload/v1/x" });
    expect(await handleMessage({ type: "slack.sendFileUpload", uploadUrl: "https://files.slack.com/upload/v1/x", filename: "a.txt", dataUrl: "data:text/plain;base64,QQ==" }, {})).toEqual({ ok: true });
    expect(await handleMessage({ type: "slack.completeFileUploads", channelId: "C1", threadTs: "1.2", files: [{ id: "F1", title: "a.txt" }] }, {})).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each([["internal_error", "ambiguous"], ["fatal_error", "ambiguous"], ["channel_not_found", "failed"]] as const)("reports complete %s as %s without calling it again", async (code, outcome) => {
    const fetch = route([["files.completeUploadExternal", { ok: false, error: code }]]);
    const result = await handleMessage({ type: "slack.completeFileUploads", channelId: "C1", threadTs: "1.2", files: [{ id: "F1", title: "a.txt" }] }, {});
    expect(result).toMatchObject({ ok: false, outcome, failure: { stage: "link" } });
    expect(JSON.stringify(result)).not.toContain(code);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("existing-issue read handlers", () => {
  it("reads and patches a GitHub body of the destination issue", async () => {
    const fetch = route([["/repos/o/r/issues/1", { body: "remote" }]]);
    expect(await handleMessage({ type: "github.getIssueBody", owner: "o", repo: "r", number: 1 }, {})).toEqual({ body: "remote" });
    expect(await handleMessage({ type: "github.updateIssueBody", owner: "o", repo: "r", number: 1, body: "next" }, {})).toEqual({ ok: true });
    expect(fetch.mock.calls.map(([, init]) => (init as RequestInit | undefined)?.method ?? "GET")).toEqual(["GET", "PATCH"]);
  });

  it("returns Notion append block IDs and refuses an oversized batch before any request", async () => {
    const fetch = route([["/blocks/page/children", { results: [{ id: "n1" }] }]]);
    expect(await handleMessage({ type: "notion.appendBlockChildren", blockId: "page", children: [{ type: "paragraph" }] }, {})).toEqual({ blockIds: ["n1"] });
    await expect(handleMessage({ type: "notion.appendBlockChildren", blockId: "page", children: Array(101).fill({ type: "paragraph" }) }, {})).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
