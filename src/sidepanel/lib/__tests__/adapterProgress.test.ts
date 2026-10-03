import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MarkdownContext } from "../buildIssueMarkdown";
import { submitToGithub } from "../submitToGithub";
import { submitToGitlab } from "../submitToGitlab";
import { submitToLinear } from "../submitToLinear";
import { submitToNotion } from "../submitToNotion";
import { submitToAsana } from "../submitToAsana";
import { submitToClickup } from "../submitToClickup";
import { submitToSlack } from "../submitToSlack";
import { submitToWebhook } from "../submitToWebhook";
import { submitToJira } from "../submitToJira";
const sendBg = vi.hoisted(() => vi.fn());
vi.mock("@/lib/bg-client", () => ({ sendBg }));
const ctx: MarkdownContext = { bodyLocale: "en", captureMode: "freeform", title: "Title", sections: {}, sectionConfig: [], url: "https://example.com", selector: "", tagName: "", classListBefore: [], classListAfter: [], specifiedStyles: {}, tokens: [], viewport: { width: 100, height: 100 }, capturedAt: 1, diffs: [], environment: [] };
const providers = [
  ["github", submitToGithub, { owner: "o", repo: "r" }, "github.submitIssue", { number: 1, url: "https://github.com/o/r/issues/1" }],
  ["gitlab", submitToGitlab, { projectId: 1 }, "gitlab.submitIssue", { iid: 1, url: "https://gitlab.com/o/r/-/issues/1" }],
  ["linear", submitToLinear, { teamId: "t" }, "linear.submitIssue", { id: "l", identifier: "L-1", url: "https://linear.app/issue/L-1" }],
  ["notion", submitToNotion, { databaseId: "d", titlePropertyName: "Name", selectValues: [] }, "notion.submitPage", { pageId: "p", url: "https://notion.so/p" }],
  ["asana", submitToAsana, { workspaceGid: "w" }, "asana.submitIssue", { gid: "a", permalinkUrl: "https://app.asana.com/0/a" }],
  ["clickup", submitToClickup, { listId: "l" }, "clickup.submitIssue", { id: "c", url: "https://app.clickup.com/t/c" }],
  ["slack", submitToSlack, { channelId: "c" }, "slack.postMessage", { ts: "1.2" }],
  ["webhook", submitToWebhook, { auth: { url: "https://hook.example", format: "multipart" }, idempotencyKey: "same" }, "webhook.submit", { key: "w", url: "https://hook.example/w" }],
  ["jira", submitToJira, { projectKey: "P", summary: "Title", issueTypeId: "1" }, "jira.createIssue", { key: "P-1", url: "https://jira.example/browse/P-1", siteId: "s" }],
] as const;
beforeEach(() => {
  vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "1" }) } });
  sendBg.mockReset();
});
describe.each(providers)("%s creation checkpoint", (_name, submit, args, createType, response) => {
  it("awaits creating and created, propagating checkpoint rejection before subsequent writes", async () => {
    const events: string[] = [];
    sendBg.mockImplementation(async (msg) => {
      events.push(msg.type);
      if (msg.type === createType) return response;
      if (msg.type.includes("upload")) return [];
      if (msg.type === "slack.getPermalink") return { permalink: "https://slack.com/archives/c/p12" };
      return {};
    });
    const progress = { attemptId: "attempt", beforeCreate: vi.fn(async () => { events.push("creating"); }), created: vi.fn(async () => { events.push("created"); throw new Error("checkpoint failed"); }) };
    await expect(submit({ ctx, ...args, submissionFiles: [], progress } as never)).rejects.toThrow("checkpoint failed");
    expect(events.indexOf("creating")).toBe(events.indexOf(createType) - 1);
    expect(events.at(-1)).toBe("created");
  });
});
