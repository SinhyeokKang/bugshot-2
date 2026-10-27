import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubmissionFile } from "@/types/attachment";
import type { MarkdownContext } from "../buildIssueMarkdown";
import { submitToJira } from "../submitToJira";
import { submitToGithub } from "../submitToGithub";
import { submitToGitlab } from "../submitToGitlab";
import { submitToLinear } from "../submitToLinear";
import { submitToNotion } from "../submitToNotion";
import { submitToAsana } from "../submitToAsana";
import { submitToClickup } from "../submitToClickup";
import { submitToSlack } from "../submitToSlack";
import { submitToWebhook } from "../submitToWebhook";

const sendBg = vi.hoisted(() => vi.fn());
vi.mock("@/lib/bg-client", () => ({ sendBg }));
vi.mock("@/sidepanel/capture", () => ({ loadImage: async () => ({ naturalWidth: 100, naturalHeight: 20 }) }));
const ctx: MarkdownContext = {
  bodyLocale: "en", captureMode: "screenshot", title: "Three captures", sections: { description: "Keep this body" },
  sectionConfig: [{ id: "description", enabled: true, renderAs: "paragraph", builtIn: true }],
  url: "https://example.com", selector: "#a, #b, #a", tagName: "DIV", classListBefore: [], classListAfter: [],
  specifiedStyles: {}, tokens: [], viewport: { width: 1000, height: 800 }, capturedAt: 1700000000000,
  diffs: [], environment: [],
};
const captures: SubmissionFile[] = ["a", "b", "a-again"].map((id, i) => ({
  id: `capture:shot-${id}`, kind: "capture", filename: `screenshot-${i + 1}.jpg`, contentType: "image/jpeg",
  dataUrl: `data:image/jpeg;base64,${["QUFB", "QkJC", "Q0ND"][i]}`,
}));
const common = (files = captures) => ({ ctx, submissionFiles: files, images: captures.map(f => ({ filename: f.filename, dataUrl: "stale" })) });
const runners = {
  jira: (files?: SubmissionFile[]) => submitToJira({ ...common(files), projectKey: "P", summary: ctx.title, issueTypeId: "1" }),
  github: (files?: SubmissionFile[]) => submitToGithub({ ...common(files), owner: "o", repo: "r" }),
  gitlab: (files?: SubmissionFile[]) => submitToGitlab({ ...common(files), projectId: 1 }),
  linear: (files?: SubmissionFile[]) => submitToLinear({ ...common(files), teamId: "t" }),
  notion: (files?: SubmissionFile[]) => submitToNotion({ ...common(files), databaseId: "d", titlePropertyName: "Name", selectValues: [] }),
  asana: (files?: SubmissionFile[]) => submitToAsana({ ...common(files), workspaceGid: "w", projectGid: "p" }),
  clickup: (files?: SubmissionFile[]) => submitToClickup({ ...common(files), listId: "l" }),
  slack: (files?: SubmissionFile[]) => submitToSlack({ ...common(files), channelId: "c" }),
  webhook: (files?: SubmissionFile[]) => submitToWebhook({ ...common(files), auth: { url: "https://example.com/hook", format: "multipart", headers: [] }, idempotencyKey: "draft" }),
};
beforeEach(() => {
  vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "1.0" }) } });
  sendBg.mockReset().mockImplementation(async (req) => {
    if (req.files && (req.type.endsWith("uploadFiles") || req.type === "clickup.uploadFile")) return req.files.map((f: { fileId: string; filename: string }) => ({ ...f, ok: true, href: `https://files.example/${f.filename}`, url: `https://files.example/${f.filename}`, gid: f.filename }));
    if (req.type === "jira.uploadAttachment") return { ...req.attachment, ok: true, attachmentId: req.attachment.filename, file: { kind: "media", mediaId: req.attachment.filename } };
    if (req.type === "jira.updateIssueDescription") return { description: req.description };
    if (req.type === "linear.uploadFile") return { fileId: req.fileId, assetUrl: `https://files.example/${req.filename}` };
    if (req.type === "notion.uploadFile") return { fileId: req.fileId, fileUploadId: req.filename };
    if (req.type === "notion.submitPage") return { pageId: "page-id", url: "https://example.com/issue", attachedFileIds: req.payload.attachments.map((f: { fileId: string }) => f.fileId) };
    if (req.type === "slack.requestFileUpload") return { fileId: req.filename, uploadUrl: "https://files.example/upload" };
    if (req.type === "slack.completeFileUploads") return { ok: true };
    if (req.type === "slack.getPermalink") return { permalink: "https://example.com/issue" };
    return { ok: true, key: "P-1", url: "https://example.com/issue", siteId: "s", number: 1, iid: 1, id: "1", identifier: "L-1", gid: "1", permalinkUrl: "https://example.com/issue", ts: "1" };
  });
});

describe.each(Object.entries(runners))("%s ordered element capture transport", (platform, run) => {
  it("sends every frozen image once in order with stable identity", async () => {
    await run();
    const messages = sendBg.mock.calls.map(([req]) => req);
    const sent = messages.flatMap(req => req.type === "jira.uploadAttachment" ? [req.attachment]
      : (req.type.endsWith("uploadFiles") || req.type === "clickup.uploadFile") || req.type === "webhook.submit" ? req.files ?? []
      : req.dataUrl ? [req] : []);
    expect(sent.map(f => f.dataUrl)).toEqual(captures.map(f => f.dataUrl));
    expect(sent.map(f => f.filename)).toEqual(captures.map(f => f.filename));
    if (platform !== "webhook") expect(sent.map(f => f.fileId)).toEqual(captures.map(f => f.id));
    const bodies = JSON.stringify(messages.filter(req => !req.dataUrl && !req.files && req.type !== "jira.uploadAttachment"));
    if (platform !== "webhook") expect(bodies).toContain("Keep this body");
    if (["github", "gitlab", "linear", "clickup"].includes(platform)) {
      for (const file of captures) expect(bodies).toContain(`![${file.filename}]`);
    }
    if (platform === "webhook") {
      const body = messages.find(req => req.type === "webhook.submit").payload.body;
      for (const file of captures) expect(body).toContain(`![${file.filename}]`);
    }
  });
  it("keeps user filename collisions separate from ordered capture identities", async () => {
    const user: SubmissionFile = { ...captures[0], id: "user:collision", kind: "user", dataUrl: "data:image/jpeg;base64,VVNFUg==" };
    await run([...captures, user]);
    const sent = sendBg.mock.calls.map(([req]) => req).flatMap(req => req.type === "jira.uploadAttachment" ? [req.attachment]
      : req.type.endsWith("uploadFiles") || req.type === "clickup.uploadFile" || req.type === "webhook.submit" ? req.files ?? []
      : req.dataUrl ? [req] : []);
    expect(sent.map(f => f.dataUrl)).toEqual([...captures, user].map(f => f.dataUrl));
    if (platform !== "webhook") expect(sent.map(f => f.fileId)).toEqual([...captures, user].map(f => f.id));
  });
  it("rejects combined attachment bytes before any upload or create RPC", async () => {
    const dataUrl = "data:application/octet-stream;base64," + "A".repeat(27 * 1024 * 1024);
    const files: SubmissionFile[] = [...captures,
      { id: "logs", kind: "logs", filename: "logs.zip", contentType: "application/zip", dataUrl },
      { id: "user:u", kind: "user", filename: "screenshot-1.jpg", contentType: "application/octet-stream", dataUrl },
    ];
    await expect(run(files)).rejects.toThrow();
    expect(sendBg).not.toHaveBeenCalled();
  });
});
