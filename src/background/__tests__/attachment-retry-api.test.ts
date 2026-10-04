import { afterEach, describe, expect, it, vi } from "vitest";
import * as github from "../github-api";
import * as gitlab from "../gitlab-api";
import * as jira from "../jira-api";
import * as linear from "../linear-api";
import * as asana from "../asana-api";
import * as clickup from "../clickup-api";
import * as notion from "../notion-api";
import * as slack from "../slack-api";

const auth = {
  github: { kind: "pat", pat: "secret", viewerLogin: "u" } as const,
  gitlab: { kind: "pat", pat: "secret", baseUrl: "https://gitlab.com", viewerUsername: "u" } as const,
  jira: { kind: "apiKey", apiToken: "secret", baseUrl: "https://test.atlassian.net", email: "u@test" } as const,
  linear: { kind: "apiKey", apiKey: "secret", viewerName: "u" } as const,
  asana: { kind: "pat", pat: "secret", viewerGid: "u", viewerName: "u" } as const,
  clickup: { kind: "pat", pat: "secret", viewerId: "u", viewerName: "u" } as const,
  notion: { kind: "apiKey", token: "secret", botName: "bot" } as const,
  slack: { kind: "oauth", accessToken: "secret", viewerId: "u", viewerName: "u", grantedAt: 1 } as const,
};
function responses(...bodies: unknown[]) {
  const fetch = vi.fn();
  for (const body of bodies) fetch.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
const methods = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls.map(([, init]) => (init?.method ?? "GET") as string);
afterEach(() => vi.unstubAllGlobals());

describe("existing-issue reads and writes never create", () => {
  it("GitHub reads the body and PATCHes only the body field of the same issue", async () => {
    const fetch = responses({ body: "remote", title: "t", state: "open" }, { body: "desired" });
    expect(await github.getIssueBody(auth.github, "owner", "repo", 7)).toBe("remote");
    await github.updateIssueBody(auth.github, "owner", "repo", 7, "desired");
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(Array(2).fill("https://api.github.com/repos/owner/repo/issues/7"));
    expect(methods(fetch)).toEqual(["GET", "PATCH"]);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ body: "desired" });
  });

  it("GitHub treats a null body as empty", async () => {
    responses({ body: null });
    expect(await github.getIssueBody(auth.github, "o", "r", 1)).toBe("");
  });

  it.each([401, 403, 404])("GitHub %i rejects without a second request", async (status) => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status }));
    vi.stubGlobal("fetch", fetch);
    await expect(github.getIssueBody(auth.github, "o", "r", 1)).rejects.toMatchObject({ status });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(methods(fetch)).toEqual(["GET"]);
  });

  it("GitLab reads the description of projectId/iid", async () => {
    const fetch = responses({ description: "remote" });
    expect(await gitlab.getIssueDescription(auth.gitlab, 4, 7)).toBe("remote");
    expect(fetch.mock.calls[0][0]).toBe("https://gitlab.com/api/v4/projects/4/issues/7");
    expect(methods(fetch)).toEqual(["GET"]);
  });

  it("Jira returns ADF and attachment IDs without content URLs", async () => {
    const description = { version: 1, type: "doc", content: [] };
    const fetch = responses({ fields: { description, attachment: [{ id: "10001", filename: "f.png", content: "https://test.atlassian.net/rest/api/3/attachment/content/10001" }] } });
    expect(await jira.getIssueAttachments(auth.jira, "BUG-1")).toEqual({ description, attachments: [{ id: "10001", filename: "f.png" }] });
    expect(fetch.mock.calls[0][0]).toBe("https://test.atlassian.net/rest/api/3/issue/BUG-1?fields=description,attachment");
  });

  it("Linear reads every attachment page and rejects success:false updates", async () => {
    const fetch = responses(
      { data: { issue: { description: "remote", attachments: { nodes: [{ id: "a", url: "https://files/a" }], pageInfo: { hasNextPage: true, endCursor: "cursor" } } } } },
      { data: { issue: { description: "remote", attachments: { nodes: [{ id: "b", url: "https://files/b" }], pageInfo: { hasNextPage: false, endCursor: null } } } } },
      { data: { issueUpdate: { success: false } } },
    );
    expect(await linear.getIssueAttachments(auth.linear, "issue")).toEqual({ description: "remote", attachments: [{ id: "a", url: "https://files/a" }, { id: "b", url: "https://files/b" }] });
    expect(JSON.parse(fetch.mock.calls[1][1].body).variables.after).toBe("cursor");
    // A definite refusal keeps HTTP 200 so the sidepanel records "failed", not an ambiguous outcome.
    await expect(linear.updateIssueDescription(auth.linear, "issue", "desired")).rejects.toMatchObject({ status: 200 });
  });

  it("Linear normalizes an unresolvable issue id on the root lookup to 404", async () => {
    responses(
      { data: null, errors: [{ message: "Entity not found: Issue", path: ["issue"], extensions: { type: "invalid input" } }] },
      { data: { issue: null } },
      { data: null, errors: [{ message: "slow down", path: ["issue"], extensions: { type: "ratelimited" } }] },
      { data: null, errors: [{ message: "bad cursor", path: ["issue", "attachments"], extensions: { type: "invalid input" } }] },
    );
    await expect(linear.getIssueAttachments(auth.linear, "gone")).rejects.toMatchObject({ status: 404 });
    await expect(linear.getIssueAttachments(auth.linear, "gone")).rejects.toMatchObject({ status: 404 });
    await expect(linear.getIssueAttachments(auth.linear, "issue")).rejects.toMatchObject({ status: 200 });
    await expect(linear.getIssueAttachments(auth.linear, "issue")).rejects.toMatchObject({ status: 200 });
  });

  it("Linear reads the viewer and organization IDs in one query", async () => {
    const fetch = responses({ data: { viewer: { id: "user" }, organization: { id: "org" } } });
    expect(await linear.getViewerIdentity(auth.linear)).toEqual({ userId: "user", organizationId: "org" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("Asana reads html_notes, workspace and attachment names", async () => {
    const fetch = responses(
      { data: { html_notes: "<body>remote</body>", workspace: { gid: "ws" } } },
      { data: [{ gid: "a1", name: "logs.html" }] },
    );
    expect(await asana.getTaskAttachments(auth.asana, "task")).toEqual({ htmlNotes: "<body>remote</body>", workspaceGid: "ws", attachments: [{ gid: "a1", name: "logs.html" }] });
    expect(fetch.mock.calls[1][0]).toContain("/attachments?parent=task");
    expect(methods(fetch)).toEqual(["GET", "GET"]);
  });

  it("Asana fails closed when the attachment list may be truncated", async () => {
    responses({ data: { html_notes: "", workspace: { gid: "ws" } } }, { data: Array.from({ length: 100 }, (_, i) => ({ gid: String(i), name: "f" })) });
    await expect(asana.getTaskAttachments(auth.asana, "task")).rejects.toThrow();
  });

  it("ClickUp requires the markdown representation and returns the team", async () => {
    const fetch = responses({ markdown_description: "remote", team_id: "team", attachments: [{ id: "a", url: "https://t.clickup-attachments.com/a.png" }] }, { description: "plain" });
    expect(await clickup.getTaskAttachments(auth.clickup, "task")).toEqual({ markdown: "remote", teamId: "team", attachments: [{ id: "a", url: "https://t.clickup-attachments.com/a.png" }] });
    expect(fetch.mock.calls[0][0]).toContain("include_markdown_description=true");
    await expect(clickup.getTaskAttachments(auth.clickup, "task")).rejects.toThrow();
  });
});

describe("Notion child blocks under the fixed API version", () => {
  it("paginates children and projects only id, type, text and file name", async () => {
    const fetch = responses(
      { results: [{ id: "a", type: "paragraph", paragraph: { rich_text: [{ plain_text: "hello " }, { plain_text: "world" }] } }], has_more: true, next_cursor: "next" },
      { results: [{ id: "b", type: "file", file: { name: "report.pdf", caption: [], file: { url: "https://signed.example/x?X-Amz-Signature=s" } } }], has_more: false, next_cursor: null },
    );
    expect(await notion.getBlockChildren(auth.notion, "page")).toEqual([
      { id: "a", type: "paragraph", plainText: "hello world" },
      { id: "b", type: "file", plainText: "", name: "report.pdf" },
    ]);
    expect(fetch.mock.calls[1][0]).toContain("start_cursor=next");
    expect(fetch.mock.calls[0][1].headers["Notion-Version"]).toBe("2022-06-28");
  });

  it("rejects a repeated cursor instead of looping", async () => {
    responses({ results: [], has_more: true, next_cursor: "same" }, { results: [], has_more: true, next_cursor: "same" });
    await expect(notion.getBlockChildren(auth.notion, "page")).rejects.toThrow();
  });

  it("appends at most 100 blocks at the end and returns every new block ID", async () => {
    const fetch = responses({ results: [{ id: "c", type: "paragraph" }] });
    expect(await notion.appendBlockChildren(auth.notion, "page", [{ object: "block", type: "paragraph", paragraph: { rich_text: [] } }])).toEqual(["c"]);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(Object.keys(body)).toEqual(["children"]);
    expect(fetch.mock.calls[0][1].method).toBe("PATCH");
    await expect(notion.appendBlockChildren(auth.notion, "page", Array(101).fill({}))).rejects.toThrow();
    await expect(notion.appendBlockChildren(auth.notion, "page", [])).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects an append response whose IDs cannot be matched one-to-one", async () => {
    responses({ results: [] }, { results: [{ id: "existing", type: "heading_1" }] });
    await expect(notion.appendBlockChildren(auth.notion, "page", [{ type: "paragraph" }])).rejects.toThrow();
    await expect(notion.appendBlockChildren(auth.notion, "page", [{ type: "paragraph" }])).rejects.toThrow();
  });

  it("normalizes an append rejected because the target is archived to 404", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ object: "error", status: 400, code: "validation_error", message: "archived" }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ object: "block", id: "page", archived: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ object: "error", status: 400, code: "validation_error", message: "bad children" }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ object: "block", id: "page", archived: false, in_trash: false }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await expect(notion.appendBlockChildren(auth.notion, "page", [{ type: "paragraph" }])).rejects.toMatchObject({ status: 404 });
    await expect(notion.appendBlockChildren(auth.notion, "page", [{ type: "paragraph" }])).rejects.toMatchObject({ status: 400 });
    expect(methods(fetch)).toEqual(["PATCH", "GET", "PATCH", "GET"]);
  });

  it("deletes a single block", async () => {
    const fetch = responses({ id: "x", archived: true });
    await notion.deleteBlock(auth.notion, "x");
    expect(fetch.mock.calls[0]).toEqual([expect.stringContaining("/blocks/x"), expect.objectContaining({ method: "DELETE" })]);
  });

  it("reads an upload status with a nullable expiry", async () => {
    responses({ id: "u", status: "uploaded", expiry_time: null }, { id: "u", status: "pending", expiry_time: "2026-10-04T00:00:00.000Z" });
    expect(await notion.getFileUpload(auth.notion, "u")).toEqual({ status: "uploaded", expiresAt: null });
    expect(await notion.getFileUpload(auth.notion, "u")).toEqual({ status: "pending", expiresAt: Date.parse("2026-10-04T00:00:00.000Z") });
  });

  it("returns a null expiry from a new upload instead of NaN", async () => {
    responses({ id: "u", upload_url: "https://api.notion.com/v1/file_uploads/u/send", expiry_time: null }, { id: "u", status: "uploaded" });
    expect(await notion.uploadFile(auth.notion, "a.txt", "text/plain", "data:text/plain;base64,QQ==")).toEqual({ fileUploadId: "u", expiresAt: null });
  });

  it("reads the bot and workspace IDs of an API-key connection, failing closed without a workspace", async () => {
    responses({ id: "bot-user", type: "bot", bot: { workspace_id: "ws" } }, { id: "bot-user", type: "bot", bot: {} });
    expect(await notion.getBotIdentity(auth.notion)).toEqual({ botId: "bot-user", workspaceId: "ws" });
    expect(await notion.getBotIdentity(auth.notion)).toEqual({ botId: "bot-user" });
  });
});

describe("Slack upload stages are separate requests", () => {
  it("allocates an ID without sending bytes or completing", async () => {
    const fetch = responses({ ok: true, file_id: "F1", upload_url: "https://files.slack.com/upload/v1/abc" });
    expect(await slack.requestFileUpload(auth.slack, "file.txt", 3)).toEqual({ fileId: "F1", uploadUrl: "https://files.slack.com/upload/v1/abc" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain("files.getUploadURLExternal");
    const form = fetch.mock.calls[0][1].body as URLSearchParams;
    expect([form.get("filename"), form.get("length")]).toEqual(["file.txt", "3"]);
  });

  it("sends bytes only to an https files.slack.com URL", async () => {
    const fetch = responses({});
    await slack.sendFileUpload("https://files.slack.com/upload/v1/abc", "file.txt", new Blob(["abc"]));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].method).toBe("POST");
    const sent = (fetch.mock.calls[0][1].body as FormData).get("file") as File;
    expect([sent.name, await sent.text()]).toEqual(["file.txt", "abc"]);
    await expect(slack.sendFileUpload("https://evil.example/upload", "file.txt", new Blob(["abc"]))).rejects.toThrow();
    await expect(slack.sendFileUpload("http://files.slack.com/upload", "file.txt", new Blob(["abc"]))).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("completes several files into the parent thread with one call", async () => {
    const fetch = responses({ ok: true, files: [{ id: "F1" }, { id: "F2" }] });
    await slack.completeFileUploads(auth.slack, "C1", "1.2", [{ id: "F1", title: "a.txt" }, { id: "F2", title: "b.txt" }]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const form = fetch.mock.calls[0][1].body as URLSearchParams;
    expect(form.get("thread_ts")).toBe("1.2");
    expect(form.get("channel_id")).toBe("C1");
    expect(JSON.parse(form.get("files")!)).toEqual([{ id: "F1", title: "a.txt" }, { id: "F2", title: "b.txt" }]);
  });

  it.each([
    [new slack.SlackError("internal_error", "x"), "ambiguous"],
    [new slack.SlackError("fatal_error", "x"), "ambiguous"],
    [new slack.SlackError("unknown_error", "x", 503), "ambiguous"],
    [new TypeError("Failed to fetch"), "ambiguous"],
    [new slack.SlackError("channel_not_found", "x"), "failed"],
    [new slack.SlackError("invalid_auth", "x"), "failed"],
  ] as const)("classifies a complete failure %# as %s", (error, outcome) => {
    expect(slack.slackCompleteOutcome(error)).toBe(outcome);
  });
});
