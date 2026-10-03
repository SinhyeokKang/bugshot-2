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
afterEach(() => vi.unstubAllGlobals());
describe("existing remote attachment recovery APIs", () => {
  it("GitHub only reads and patches body of the same issue", async () => {
    const fetch = responses({ body: "remote" }, { body: "desired" });
    expect(await github.getIssueBody(auth.github, "owner", "repo", 7)).toBe("remote");
    await github.updateIssueBody(auth.github, "owner", "repo", 7, "desired");
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(Array(2).fill("https://api.github.com/repos/owner/repo/issues/7"));
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: "PATCH", body: JSON.stringify({ body: "desired" }) });
  });
  it("GitLab reads description without creation fallback", async () => {
    const fetch = responses({ description: "remote" });
    expect(await gitlab.getIssueDescription(auth.gitlab, 4, 7)).toBe("remote");
    expect(fetch.mock.calls[0][0]).toContain("/projects/4/issues/7");
    expect(fetch.mock.calls[0][1].method).not.toBe("POST");
  });
  it("Jira preserves attachment IDs alongside ADF", async () => {
    const description = { version: 1, type: "doc", content: [] };
    responses({ fields: { description, attachment: [{ id: "a1", filename: "f", content: "https://test.atlassian.net/file/a1" }] } });
    expect(await jira.getIssueAttachments(auth.jira, "BUG-1")).toEqual({ description, attachments: [{ id: "a1", filename: "f", content: "https://test.atlassian.net/file/a1" }] });
  });
  it("Linear reads all attachment pages and rejects unsuccessful update", async () => {
    const fetch = responses(
      { data: { issue: { description: "remote", attachments: { nodes: [{ id: "a", url: "https://files/a" }], pageInfo: { hasNextPage: true, endCursor: "cursor" } } } } },
      { data: { issue: { description: "remote", attachments: { nodes: [{ id: "b", url: "https://files/b" }], pageInfo: { hasNextPage: false, endCursor: null } } } } },
      { data: { issueUpdate: { success: false } } },
    );
    expect((await linear.getIssueAttachments(auth.linear, "issue")).attachments.map(a => a.id)).toEqual(["a", "b"]);
    expect(JSON.parse(fetch.mock.calls[1][1].body).variables.after).toBe("cursor");
    await expect(linear.updateIssueDescription(auth.linear, "issue", "desired")).rejects.toThrow();
  });
  it("Asana returns HTML notes and attachment IDs without signed download URLs", async () => {
    responses({ data: { html_notes: "<body>remote</body>", attachments: [{ gid: "a", permanent_url: "https://app.asana.com/a" }] } });
    expect(await asana.getTaskAttachments(auth.asana, "task")).toEqual({ htmlNotes: "<body>remote</body>", attachments: [{ gid: "a", permanent_url: "https://app.asana.com/a" }] });
  });
  it("ClickUp requires the actual markdown representation", async () => {
    const fetch = responses({ markdown_description: "remote", attachments: [{ id: "a" }] }, { description: "plain" });
    expect((await clickup.getTaskAttachments(auth.clickup, "task")).markdown).toBe("remote");
    expect(fetch.mock.calls[0][0]).toContain("include_markdown_description=true");
    await expect(clickup.getTaskAttachments(auth.clickup, "task")).rejects.toThrow();
  });
  it("Notion paginates reads and returns append IDs with fixed version", async () => {
    const fetch = responses({ results: [{ id: "a" }], has_more: true, next_cursor: "next" }, { results: [{ id: "b" }], has_more: false }, { results: [{ id: "c" }] });
    expect((await notion.getBlockChildren(auth.notion, "page")).map(b => b.id)).toEqual(["a", "b"]);
    expect(fetch.mock.calls[1][0]).toContain("start_cursor=next");
    expect(await notion.appendBlockChildren(auth.notion, "page", [{ object: "block", type: "paragraph", paragraph: { rich_text: [] } }])).toEqual([{ id: "c" }]);
    expect(fetch.mock.calls[2][1].headers["Notion-Version"]).toBe("2022-06-28");
    await expect(notion.appendBlockChildren(auth.notion, "page", Array(101).fill({}))).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("Slack allocates an ID separately from bytes and complete", async () => {
    const fetch = responses({ ok: true, file_id: "F1", upload_url: "https://files.slack.com/upload/1" }, {}, { ok: true, files: [{ id: "F1" }] });
    const allocated = await slack.requestFileUpload(auth.slack, "file.txt", 3);
    expect(allocated).toEqual({ fileId: "F1", uploadUrl: "https://files.slack.com/upload/1" });
    expect(fetch).toHaveBeenCalledTimes(1);
    await slack.sendFileUpload(allocated.uploadUrl, "file.txt", new Blob(["abc"]));
    await slack.completeFileUpload(auth.slack, "C1", "1.2", "F1", "file.txt");
    expect(fetch.mock.calls[2][0]).toContain("files.completeUploadExternal");
    expect(fetch.mock.calls[2][1].body.get("thread_ts")).toBe("1.2");
  });
  it.each([401, 403, 404])("GitHub %i fails without creating an issue", async status => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status }));
    vi.stubGlobal("fetch", fetch);
    await expect(github.getIssueBody(auth.github, "o", "r", 1)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].method).not.toBe("POST");
  });
});
