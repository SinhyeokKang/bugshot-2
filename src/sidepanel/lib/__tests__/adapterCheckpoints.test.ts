import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttachmentCheckpoint, SubmissionFile } from "@/types/attachment";
import type { MarkdownContext } from "../buildIssueMarkdown";
import type { SubmissionProgress } from "../submissionRecovery";
import { submitToGithub } from "../submitToGithub";
import { submitToGitlab } from "../submitToGitlab";
import { submitToJira } from "../submitToJira";
import { submitToLinear } from "../submitToLinear";
import { submitToNotion } from "../submitToNotion";
import { submitToAsana } from "../submitToAsana";
import { submitToClickup } from "../submitToClickup";
import { submitToSlack } from "../submitToSlack";

const sendBg = vi.hoisted(() => vi.fn());
vi.mock("@/lib/bg-client", () => ({ sendBg }));

const ctx: MarkdownContext = { bodyLocale: "en", captureMode: "screenshot", title: "Title", sections: {}, sectionConfig: [], url: "https://example.com", selector: "", tagName: "", classListBefore: [], classListAfter: [], specifiedStyles: {}, tokens: [], viewport: { width: 100, height: 100 }, capturedAt: 1, diffs: [], environment: [], actionLogCaptured: 1 };
const file = (id: string, kind: SubmissionFile["kind"], filename: string): SubmissionFile => ({ id, kind, filename, contentType: kind === "logs" ? "text/html" : kind === "user" ? "application/pdf" : "image/webp", dataUrl: `data:application/octet-stream;base64,${Buffer.from(id).toString("base64")}` });
const capture = file("capture:screenshot", "capture", "screenshot.webp");
const logs = file("logs", "logs", "logs.html");
const user = file("user:a", "user", "a.pdf");
const user2 = file("user:b", "user", "b.pdf");

let events: string[];
let checkpoints: Array<Partial<AttachmentCheckpoint> & { fileId: string }>;
let bodies: string[];
let progress: SubmissionProgress & { fileCheckpoint: ReturnType<typeof vi.fn>; bodyWritten: ReturnType<typeof vi.fn> };
const describeCp = (cp: Partial<AttachmentCheckpoint> & { fileId: string }) => `cp:${cp.fileId}:${["upload", "link", "body"].filter((k) => k in cp).map((k) => `${k}=${cp[k as keyof AttachmentCheckpoint]}`).join(",")}`;
beforeEach(() => {
  vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "1" }) } });
  sendBg.mockReset();
  events = [];
  checkpoints = [];
  bodies = [];
  progress = {
    attemptId: "a",
    beforeCreate: vi.fn(async () => { events.push("creating"); }),
    created: vi.fn(async () => { events.push("created"); }),
    fileCheckpoint: vi.fn(async (...files: Array<Partial<AttachmentCheckpoint> & { fileId: string }>) => { for (const f of files) { checkpoints.push(f); events.push(describeCp(f)); } }),
    bodyWritten: vi.fn(async (body: string, ...files: Array<Partial<AttachmentCheckpoint> & { fileId: string }>) => { bodies.push(body); events.push("body"); for (const f of files) { checkpoints.push(f); events.push(describeCp(f)); } }),
  };
});
function rpc(handlers: Record<string, (msg: any) => unknown>) {
  sendBg.mockImplementation(async (msg) => {
    events.push(`send:${msg.type}`);
    const handler = handlers[msg.type];
    if (!handler) throw new Error(`unexpected ${msg.type}`);
    return handler(msg);
  });
}
const last = (fileId: string) => Object.assign({}, ...checkpoints.filter((c) => c.fileId === fileId));
const echoUpload = (href: (f: any) => string) => (msg: any) => msg.files.map((f: any) => ({ fileId: f.fileId, filename: f.filename, ok: true, href: href(f) }));

describe("upload-first markdown providers", () => {
  it("GitHub persists each uploaded locator before creating, then records the created body", async () => {
    rpc({
      "github.uploadFiles": echoUpload((f) => `https://github.com/user-attachments/files/1/${f.filename}`),
      "github.submitIssue": () => ({ number: 1, url: "https://github.com/o/r/issues/1" }),
    });
    await submitToGithub({ ctx, owner: "o", repo: "r", images: [{ filename: "screenshot.webp", dataUrl: "x" }], submissionFiles: [capture], progress });
    expect(events).toEqual(["send:github.uploadFiles", "cp:capture:screenshot:upload=done", "creating", "send:github.submitIssue", "created", "body", "cp:capture:screenshot:body=done"]);
    expect(last(capture.id)).toMatchObject({ upload: "done", body: "done", uploaded: { platform: "github", href: "https://github.com/user-attachments/files/1/screenshot.webp" } });
    expect(bodies[0]).toContain("https://github.com/user-attachments/files/1/screenshot.webp");
  });

  it("GitHub records a definite rejection as failed and a lost batch as unknown", async () => {
    rpc({
      "github.uploadFiles": (msg) => msg.files.map((f: any) => ({ fileId: f.fileId, filename: f.filename, ok: false, failure: { stage: "upload", code: "permission", httpStatus: 403 } })),
      "github.submitIssue": () => ({ number: 1, url: "https://github.com/o/r/issues/1" }),
    });
    await submitToGithub({ ctx, owner: "o", repo: "r", attachments: [{ filename: "a.pdf", dataUrl: "x" }], submissionFiles: [user], progress });
    expect(last(user.id)).toMatchObject({ upload: "failed" });
    expect(last(user.id)).not.toHaveProperty("uploaded");
    checkpoints = [];
    rpc({ "github.uploadFiles": () => { throw new TypeError("Failed to fetch"); }, "github.submitIssue": () => ({ number: 2, url: "https://github.com/o/r/issues/2" }) });
    await submitToGithub({ ctx, owner: "o", repo: "r", attachments: [{ filename: "a.pdf", dataUrl: "x" }], submissionFiles: [user], progress });
    expect(last(user.id)).toMatchObject({ upload: "unknown" });
  });

  it("GitHub does not create the issue when the upload checkpoint cannot be stored", async () => {
    rpc({ "github.uploadFiles": echoUpload(() => "https://github.com/f"), "github.submitIssue": () => ({ number: 1, url: "u" }) });
    progress.fileCheckpoint.mockRejectedValueOnce(new Error("quota"));
    await expect(submitToGithub({ ctx, owner: "o", repo: "r", images: [{ filename: "screenshot.webp", dataUrl: "x" }], submissionFiles: [capture], progress })).rejects.toThrow("quota");
    expect(events).not.toContain("send:github.submitIssue");
  });

  it("GitLab keeps a project-relative upload path as the locator", async () => {
    rpc({
      "gitlab.uploadFiles": echoUpload((f) => `/uploads/abc/${f.filename}`),
      "gitlab.submitIssue": () => ({ iid: 3, url: "https://gitlab.com/o/r/-/issues/3" }),
    });
    await submitToGitlab({ ctx, projectId: 4, attachments: [{ filename: "a.pdf", dataUrl: "x" }], submissionFiles: [user], progress });
    expect(events.indexOf("cp:user:a:upload=done")).toBeLessThan(events.indexOf("send:gitlab.submitIssue"));
    expect(last(user.id)).toMatchObject({ upload: "done", body: "done", uploaded: { platform: "gitlab", href: "/uploads/abc/a.pdf" } });
  });

  it("GitLab records the backlinked logs URL with the swapped body and surfaces a storage failure", async () => {
    const html = `data:text/html;base64,${Buffer.from("<html><body></body></html>").toString("base64")}`;
    rpc({
      "gitlab.uploadFiles": (msg) => msg.files.map((f: any) => ({ fileId: f.fileId, filename: f.filename, ok: true, href: `/uploads/${gitlabUploads++}/logs.html` })),
      "gitlab.submitIssue": () => ({ iid: 3, url: "https://gitlab.com/o/r/-/issues/3" }),
      "gitlab.updateIssueDescription": () => ({}),
    });
    let gitlabUploads = 1;
    const logsFile = { ...logs, dataUrl: html };
    await submitToGitlab({ ctx, projectId: 4, logs: [{ filename: "logs.html", dataUrl: html }], submissionFiles: [logsFile], progress });
    expect(last(logs.id).uploaded).toEqual({ platform: "gitlab", href: "/uploads/2/logs.html" });
    expect(bodies.at(-1)).toContain("/uploads/2/logs.html");
    gitlabUploads = 1;
    progress.bodyWritten.mockImplementation(async (body: string) => { if (body.includes("/uploads/2/")) throw new Error("quota"); });
    await expect(submitToGitlab({ ctx, projectId: 4, logs: [{ filename: "logs.html", dataUrl: html }], submissionFiles: [logsFile], progress })).rejects.toThrow("quota");
  });

  it("Linear checkpoints uploads before creation and links logs before the body update", async () => {
    rpc({
      "linear.uploadFile": (msg) => ({ fileId: msg.fileId, assetUrl: `https://uploads.linear.app/${msg.fileId}` }),
      "linear.submitIssue": () => ({ id: "issue", identifier: "L-1", url: "https://linear.app/issue/L-1" }),
      "linear.createAttachment": () => ({ ok: true }),
      "linear.updateIssueDescription": () => ({ ok: true }),
    });
    await submitToLinear({ ctx, teamId: "t", images: [{ filename: "screenshot.webp", dataUrl: "x" }], logs: [{ filename: "logs.html", dataUrl: "x" }], submissionFiles: [capture, logs], progress });
    expect(events).toEqual([
      "send:linear.uploadFile", "cp:capture:screenshot:upload=done", "creating", "send:linear.submitIssue", "created", "body", "cp:capture:screenshot:body=done",
      "send:linear.uploadFile", "cp:logs:upload=done", "send:linear.createAttachment", "cp:logs:link=done", "send:linear.updateIssueDescription", "body", "cp:logs:body=done",
    ]);
    expect(last(logs.id).uploaded).toEqual({ platform: "linear", href: "https://uploads.linear.app/logs" });
  });

  it("Linear records an unacknowledged attachment link as failed", async () => {
    rpc({
      "linear.submitIssue": () => ({ id: "issue", identifier: "L-1", url: "https://linear.app/issue/L-1" }),
      "linear.uploadFile": (msg) => ({ fileId: msg.fileId, assetUrl: "https://uploads.linear.app/u" }),
      "linear.createAttachment": () => { throw Object.assign(new Error("Linear attachment was not acknowledged"), { status: 200 }); },
    });
    await submitToLinear({ ctx, teamId: "t", attachments: [{ filename: "a.pdf", dataUrl: "x" }], submissionFiles: [user], progress });
    expect(last(user.id)).toMatchObject({ upload: "done", link: "failed" });
  });

  it("Notion stores the upload id with its expiry and marks only blocks inside the page as linked", async () => {
    rpc({
      "notion.uploadFile": (msg) => ({ fileId: msg.fileId, fileUploadId: `up-${msg.fileId}`, expiresAt: msg.fileId === "user:a" ? null : 1700000000000 }),
      "notion.submitPage": () => ({ pageId: "page-1", url: "https://notion.so/page-1", attachedFileIds: ["user:a"] }),
    });
    await submitToNotion({ ctx, databaseId: "d", titlePropertyName: "Name", selectValues: [], attachments: [{ filename: "a.pdf", dataUrl: "x" }, { filename: "b.pdf", dataUrl: "x" }], submissionFiles: [user, user2], progress });
    expect(events.indexOf("cp:user:b:upload=done")).toBeLessThan(events.indexOf("send:notion.submitPage"));
    expect(last(user.id)).toMatchObject({ upload: "done", link: "done", uploaded: { platform: "notion", id: "up-user:a", expiresAt: null } });
    expect(last(user2.id)).toMatchObject({ upload: "done", uploaded: { platform: "notion", id: "up-user:b", expiresAt: 1700000000000 } });
    expect(last(user2.id).link).toBeUndefined();
  });
});

describe("create-first providers", () => {
  it("Jira records the created body and each attachment id before the next upload", async () => {
    const description = { version: 1, type: "doc", content: [] };
    rpc({
      "jira.createIssue": () => ({ key: "BUG-1", url: "https://acme.atlassian.net/browse/BUG-1", siteId: "cloud", description }),
      "jira.uploadAttachment": (msg) => ({ fileId: msg.attachment.fileId, filename: msg.attachment.filename, ok: true, attachmentId: `id-${msg.attachment.fileId}`, href: `https://acme.atlassian.net/secure/attachment/1/${msg.attachment.filename}`, file: { kind: "media", mediaId: `m-${msg.attachment.fileId}` } }),
      "jira.updateIssueDescription": () => ({ ok: true, description: { ...description, content: [{ type: "paragraph" }] } }),
    });
    await submitToJira({ ctx, projectKey: "BUG", summary: "s", issueTypeId: "1", images: [{ filename: "screenshot.webp", dataUrl: "x" }], logs: [{ filename: "logs.html", dataUrl: "x" }], submissionFiles: [capture, logs], progress });
    expect(events).toEqual([
      "creating", "send:jira.createIssue", "created", "body",
      "send:jira.uploadAttachment", "cp:capture:screenshot:upload=done",
      "send:jira.uploadAttachment", "cp:logs:upload=done",
      "send:jira.updateIssueDescription", "body", "cp:capture:screenshot:body=done", "cp:logs:body=done",
    ]);
    expect(bodies[0]).toBe(JSON.stringify(description));
    expect(JSON.parse(bodies[1]).content).toEqual([{ type: "paragraph" }]);
    expect(last(capture.id).uploaded).toEqual({ platform: "jira", id: "id-capture:screenshot", href: "https://acme.atlassian.net/secure/attachment/1/screenshot.webp", mediaId: "m-capture:screenshot" });
  });

  it("Jira leaves the body pending when the description update fails", async () => {
    rpc({
      "jira.createIssue": () => ({ key: "BUG-1", url: "https://acme.atlassian.net/browse/BUG-1", siteId: "cloud", description: { version: 1, type: "doc", content: [] } }),
      "jira.uploadAttachment": (msg) => ({ fileId: msg.attachment.fileId, filename: msg.attachment.filename, ok: true, attachmentId: "1", href: "https://acme.atlassian.net/secure/attachment/1/x", file: { kind: "external", url: "https://acme.atlassian.net/secure/attachment/1/x" } }),
      "jira.updateIssueDescription": () => { throw Object.assign(new Error("server"), { status: 503 }); },
    });
    await submitToJira({ ctx, projectKey: "BUG", summary: "s", issueTypeId: "1", images: [{ filename: "screenshot.webp", dataUrl: "x" }], submissionFiles: [capture], progress });
    expect(last(capture.id)).toMatchObject({ upload: "done", body: "unknown" });
    expect(bodies).toHaveLength(1);
  });

  it("Asana records notes, attachment gids and the second notes write in order", async () => {
    rpc({
      "asana.submitIssue": () => ({ gid: "task", permalinkUrl: "https://app.asana.com/0/0/task" }),
      "asana.uploadFiles": (msg) => msg.files.map((f: any) => ({ fileId: f.fileId, filename: f.filename, ok: true, gid: `g-${f.fileId}`, viewUrl: "https://app.asana.com/app/asana/-/get_asset?asset_id=1" })),
      "asana.updateTaskNotes": () => ({}),
    });
    await submitToAsana({ ctx, workspaceGid: "w", logs: [{ filename: "logs.html", dataUrl: "x" }], submissionFiles: [logs], progress });
    expect(events).toEqual(["creating", "send:asana.submitIssue", "created", "body", "send:asana.uploadFiles", "cp:logs:upload=done", "send:asana.updateTaskNotes", "body", "cp:logs:body=done"]);
    expect(last(logs.id).uploaded).toEqual({ platform: "asana", id: "g-logs" });
  });

  it("ClickUp records the first markdown, uploaded URLs and the second markdown", async () => {
    rpc({
      "clickup.submitIssue": () => ({ id: "task", url: "https://app.clickup.com/t/task" }),
      "clickup.uploadFile": echoUpload((f) => `https://t1.p.clickup-attachments.com/t1/${f.filename}`),
      "clickup.updateTaskMarkdown": () => ({}),
    });
    await submitToClickup({ ctx, listId: "l", logs: [{ filename: "logs.html", dataUrl: "x" }], submissionFiles: [logs], progress });
    expect(events).toEqual(["creating", "send:clickup.submitIssue", "created", "body", "send:clickup.uploadFile", "cp:logs:upload=done", "send:clickup.updateTaskMarkdown", "body", "cp:logs:body=done"]);
    expect(bodies[1]).toContain("https://t1.p.clickup-attachments.com/t1/logs.html");
  });
});

describe("Slack staged uploads", () => {
  const handlers = (complete: () => unknown) => ({
    "slack.postMessage": (msg: any) => ({ ts: msg.payload.threadTs ? "1.3" : "1.2" }),
    "slack.requestFileUpload": (msg: any) => ({ fileId: `F-${msg.fileId}`, uploadUrl: `https://files.slack.com/upload/v1/${msg.fileId}` }),
    "slack.sendFileUpload": () => ({ ok: true }),
    "slack.completeFileUploads": complete,
    "slack.getPermalink": () => ({ permalink: "https://slack.com/archives/C/p12" }),
  });
  const submit = () => submitToSlack({ ctx, channelId: "C", attachments: [{ filename: "a.pdf", dataUrl: "x" }, { filename: "b.pdf", dataUrl: "x" }], submissionFiles: [user, user2], progress });

  it("saves the file id before bytes and the complete intent before one complete call", async () => {
    rpc(handlers(() => ({ ok: true })));
    const result = await submit();
    const files = events.filter((e) => /slack\.(requestFileUpload|sendFileUpload|completeFileUploads)|^cp:/.test(e));
    expect(files).toEqual([
      "send:slack.requestFileUpload", "cp:user:a:upload=pending", "send:slack.sendFileUpload", "cp:user:a:upload=done",
      "send:slack.requestFileUpload", "cp:user:b:upload=pending", "send:slack.sendFileUpload", "cp:user:b:upload=done",
      "cp:user:a:link=unknown", "cp:user:b:link=unknown", "send:slack.completeFileUploads", "cp:user:a:link=done", "cp:user:b:link=done",
    ]);
    expect(checkpoints.find((c) => c.fileId === "user:a" && c.upload === "pending")?.uploaded).toEqual({ platform: "slack", id: "F-user:a" });
    const grants = sendBg.mock.calls.map(([m]) => m).filter((m) => m.type === "slack.requestFileUpload");
    expect(grants.map((m) => m.length)).toEqual([Buffer.from("user:a").length, Buffer.from("user:b").length]);
    const bytes = sendBg.mock.calls.map(([m]) => m).filter((m) => m.type === "slack.sendFileUpload");
    expect(bytes.map((m) => m.dataUrl)).toEqual([user.dataUrl, user2.dataUrl]);
    expect(sendBg.mock.calls.map(([m]) => m).find((m) => m.type === "slack.completeFileUploads")).toMatchObject({ channelId: "C", threadTs: "1.2", files: [{ id: "F-user:a", title: "a.pdf" }, { id: "F-user:b", title: "b.pdf" }] });
    expect(JSON.stringify(checkpoints)).not.toContain("files.slack.com");
    expect(result.attachments?.map((r) => r.delivery)).toEqual(["attached", "attached"]);
  });

  it("keeps an ambiguous complete unknown and never repeats it", async () => {
    rpc(handlers(() => ({ ok: false, outcome: "ambiguous", failure: { stage: "link", code: "unknown" } })));
    const result = await submit();
    expect(events.filter((e) => e === "send:slack.completeFileUploads")).toHaveLength(1);
    expect(last(user.id).link).toBe("unknown");
    expect(result.attachments?.map((r) => r.delivery)).toEqual(["unknown", "unknown"]);
  });

  it("marks a definite complete rejection as a failed link", async () => {
    rpc(handlers(() => ({ ok: false, outcome: "failed", failure: { stage: "link", code: "permission" } })));
    const result = await submit();
    expect(last(user.id).link).toBe("failed");
    expect(result.attachments?.map((r) => r.delivery)).toEqual(["failed", "failed"]);
  });

  it("excludes a file whose allocation failed from bytes and complete", async () => {
    const base = handlers(() => ({ ok: true }));
    rpc({ ...base, "slack.requestFileUpload": (msg: any) => { if (msg.fileId === "user:a") throw Object.assign(new Error("denied"), { status: 200 }); return base["slack.requestFileUpload"](msg); } });
    const result = await submit();
    expect(last(user.id)).toMatchObject({ upload: "failed" });
    expect(sendBg.mock.calls.map(([m]) => m).filter((m) => m.type === "slack.sendFileUpload").map((m) => m.fileId)).toEqual(["user:b"]);
    expect(sendBg.mock.calls.map(([m]) => m).find((m) => m.type === "slack.completeFileUploads")?.files).toEqual([{ id: "F-user:b", title: "b.pdf" }]);
    expect(result.attachments?.map((r) => r.delivery)).toEqual(["failed", "attached"]);
  });
});
