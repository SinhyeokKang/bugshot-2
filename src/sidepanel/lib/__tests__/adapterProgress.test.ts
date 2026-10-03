import { readFileSync } from "node:fs";
import { PLATFORM_TAB_KEYS } from "@/types/platform";
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

describe.each(providers)("%s prepared file delivery", (name, submit, args, createType, response) => {
  it.each(["capture", "video", "inline", "logs", "user"] as const)("returns a result for %s using frozen bytes and echoed IDs", async (kind) => {
    const id = kind === "inline" ? "inline:ref" : kind === "capture" ? "capture:screenshot" : kind === "user" ? "user:u" : kind;
    const filename = kind === "logs" ? name === "notion" ? "logs.zip" : "logs.html" : kind === "video" ? "recording.mp4" : "screenshot.webp";
    const file = { id, kind, filename, contentType: "application/octet-stream", dataUrl: "data:application/octet-stream;base64,RlJPWkVO" };
    sendBg.mockImplementation(async (msg) => {
      if (msg.type === createType) return { ...response, attachedFileIds: msg.payload?.attachments?.map((f: { fileId: string }) => f.fileId) };
      if (msg.type === "slack.postMessage") return { ts: "1.3" };
      if (msg.type === "slack.getPermalink") return { permalink: "https://slack.com/archives/c/p12" };
      if (msg.type === "linear.uploadFile") return { fileId: msg.fileId, assetUrl: "https://files.example/file" };
      if (msg.type === "notion.uploadFile") return { fileId: msg.fileId, fileUploadId: "remote-file" };
      if (msg.type === "jira.uploadAttachment") return { fileId: msg.attachment.fileId, filename: msg.attachment.filename, ok: true, href: "https://files.example/file", file: { kind: "external", url: "https://files.example/file" } };
      if (msg.files) return msg.files.map((f: { fileId: string; filename: string }) => ({ fileId: f.fileId, filename: f.filename, ok: true, href: "https://files.example/file", gid: "gid", remoteFileId: "remote-file" }));
      return { ok: true };
    });
    const progress = { attemptId: "a", beforeCreate: vi.fn(async () => {}), created: vi.fn(async () => {}) };
    const result = await submit({ ctx: { ...ctx, captureMode: kind === "video" ? "video" : "screenshot", sections: { description: "![pic](inline:ref)" }, sectionConfig: [{ id: "description", enabled: true, renderAs: "paragraph", builtIn: true }], actionLogCaptured: kind === "logs" ? 1 : undefined }, ...args, submissionFiles: [file], progress } as never);
    expect(result).toMatchObject({ attachments: [{ fileId: id, delivery: "attached" }] });
    const uploads = sendBg.mock.calls.map(([m]) => m).filter((m) => m.type.includes("upload"));
    if (name !== "webhook") {
      expect(uploads.length).toBeGreaterThan(0);
      const sent = uploads.flatMap((m) => m.files ?? [m.attachment ?? m]);
      expect(sent).toContainEqual(expect.objectContaining({ fileId: id, dataUrl: file.dataUrl }));
    }
    expect(progress.beforeCreate).toHaveBeenCalledTimes(1);
    expect(progress.created).toHaveBeenCalledTimes(1);
  });
});

describe.each(providers)("%s missing delivery evidence", (name, submit, args, createType, response) => {
  it.each(["capture", "video", "inline", "logs", "user"] as const)("does not report %s attached when its response is missing", async (kind) => {
    const id = kind === "inline" ? "inline:ref" : kind === "capture" ? "capture:screenshot" : kind === "user" ? "user:u" : kind;
    const filename = kind === "logs" ? name === "notion" ? "logs.zip" : "logs.html" : kind === "video" ? "recording.mp4" : "screenshot.webp";
    const file = { id, kind, filename, contentType: "application/octet-stream", dataUrl: "data:application/octet-stream;base64,RlJPWkVO" };
    sendBg.mockImplementation(async (msg) => {
      if (msg.type === createType) { if (name === "webhook") throw new Error("Response lost"); return { ...response, attachedFileIds: [] }; }
      if (msg.type === "slack.postMessage") return { ts: "1.3" };
      if (msg.type === "slack.getPermalink") return { permalink: "https://slack.com/archives/c/p12" };
      if (msg.type === "linear.uploadFile") return { assetUrl: "https://files.example/file" };
      if (msg.type === "notion.uploadFile") return { fileUploadId: "remote-file" };
      if (msg.type === "jira.uploadAttachment") return { filename: msg.attachment.filename, ok: true, href: "https://files.example/file", file: { kind: "external", url: "https://files.example/file" } };
      if (msg.files) return [];
      return { ok: true };
    });
    const progress = { attemptId: "a", beforeCreate: vi.fn(async () => {}), created: vi.fn(async () => {}) };
    const pending = submit({ ctx: { ...ctx, captureMode: kind === "video" ? "video" : "screenshot", sections: { description: "![pic](inline:ref)" }, sectionConfig: [{ id: "description", enabled: true, renderAs: "paragraph", builtIn: true }], actionLogCaptured: kind === "logs" ? 1 : undefined }, ...args, submissionFiles: [file], progress } as never);
    if (name === "webhook" || (["linear", "notion"].includes(name) && ["capture", "video", "inline"].includes(kind))) {
      await expect(pending).rejects.toThrow();
      if (name !== "webhook") expect(progress.beforeCreate).not.toHaveBeenCalled();
    } else {
      const result = await pending;
      expect(result).toMatchObject({ attachments: [{ fileId: id }] });
      expect((result as { attachments: { delivery: string }[] }).attachments[0].delivery).not.toBe("attached");
    }
  });
});

describe.each(providers)("%s colliding user filenames", (name, submit, args, createType, response) => {
  it.each(["logs.html", "screenshot.webp"])("keeps %s independent from capture and generated logs", async (filename) => {
    const submissionFiles = [
      { id: "capture:screenshot", kind: "capture", filename: "screenshot.webp", contentType: "image/webp", dataUrl: "data:image/webp;base64,QQ==" },
      { id: "logs", kind: "logs", filename: name === "notion" ? "logs.zip" : "logs.html", contentType: name === "notion" ? "application/zip" : "text/html", dataUrl: "data:text/html;base64,QQ==" },
      { id: "user:u", kind: "user", filename, contentType: "application/octet-stream", dataUrl: "data:application/octet-stream;base64,VQ==" },
    ];
    sendBg.mockImplementation(async (msg) => {
      if (msg.type === createType) return { ...response, attachedFileIds: ["capture:screenshot", "logs"] };
      if (msg.type === "slack.getPermalink") return { permalink: "https://slack.com/archives/c/p12" };
      if (msg.type === "linear.uploadFile" || msg.type === "notion.uploadFile") {
        if (msg.fileId === "user:u") throw new Error("denied");
        return { fileId: msg.fileId, assetUrl: `https://files.example/${msg.fileId}`, fileUploadId: `remote-${msg.fileId}` };
      }
      const uploaded = (f: { fileId: string }) => ({ fileId: f.fileId, filename, ok: f.fileId !== "user:u", href: "https://files.example/file", gid: "gid", remoteFileId: "remote-file", file: { kind: "external", url: "https://files.example/file" } });
      if (msg.type === "jira.uploadAttachment") return uploaded(msg.attachment);
      if (msg.files) return msg.files.map(uploaded);
      return { ok: true };
    });
    const result = await submit({ ctx: { ...ctx, captureMode: "screenshot", actionLogCaptured: 1 }, ...args, attachments: [{ filename: `u__${filename}`, displayName: filename, dataUrl: "old" }], submissionFiles, progress: { attemptId: "a", beforeCreate: async () => {}, created: async () => {} } } as never);
    expect(result).toMatchObject({ attachments: [
      { fileId: "capture:screenshot", delivery: "attached" },
      { fileId: "logs", delivery: "attached" },
      { fileId: "user:u", delivery: name === "webhook" ? "attached" : expect.stringMatching(/failed|unknown/) },
    ] });
    const encoded = JSON.stringify(sendBg.mock.calls);
    expect(encoded).not.toContain('"dataUrl":"old"');
  });
});


describe("production recovery coverage", () => {
  it("covers every production adapter and both prepared submission entrances", () => {
    expect(providers.map(([name]) => name).sort()).toEqual(Object.keys(PLATFORM_TAB_KEYS).sort());
    for (const name of ["IssueCreateModal", "DraftDetailDialog"]) {
      const source = readFileSync(`src/sidepanel/tabs/${name}.tsx`, "utf8");
      expect(source).not.toContain("assertSubmissionAdaptersReady");
      expect(source).toContain("withSubmissionProgress(");
      expect(source).toContain("prepared.files");
      expect(source).toContain("runSubmissionRecovery(");
    }
  });
});

describe.each(providers)("%s rejected uploads", (name, submit, args, createType, response) => {
  it.each(["capture", "video", "inline", "logs", "user"] as const)("does not report %s attached when upload fails", async (kind) => {
    const id = kind === "inline" ? "inline:ref" : kind === "capture" ? "capture:screenshot" : kind === "user" ? "user:u" : kind;
    const filename = kind === "logs" ? name === "notion" ? "logs.zip" : "logs.html" : kind === "video" ? "recording.mp4" : "screenshot.webp";
    const file = { id, kind, filename, contentType: "application/octet-stream", dataUrl: "data:application/octet-stream;base64,RlJPWkVO" };
    sendBg.mockImplementation(async (msg) => {
      if (msg.type === createType) { if (name === "webhook") throw new Error("Response lost"); return { ...response, attachedFileIds: [] }; }
      if (msg.type === "slack.postMessage") return { ts: "1.3" };
      if (msg.type === "slack.getPermalink") return { permalink: "https://slack.com/archives/c/p12" };
      if (msg.type === "linear.uploadFile") throw new Error("upload failed");
      if (msg.type === "notion.uploadFile") throw new Error("upload failed");
      if (msg.type === "jira.uploadAttachment") return { fileId: msg.attachment.fileId, filename: msg.attachment.filename, ok: false, href: "https://files.example/file", file: { kind: "external", url: "https://files.example/file" } };
      if (msg.files) return msg.files.map((f: { fileId: string; filename: string }) => ({ ...f, ok: false }));
      return { ok: true };
    });
    const progress = { attemptId: "a", beforeCreate: vi.fn(async () => {}), created: vi.fn(async () => {}) };
    const pending = submit({ ctx: { ...ctx, captureMode: kind === "video" ? "video" : "screenshot", sections: { description: "![pic](inline:ref)" }, sectionConfig: [{ id: "description", enabled: true, renderAs: "paragraph", builtIn: true }], actionLogCaptured: kind === "logs" ? 1 : undefined }, ...args, submissionFiles: [file], progress } as never);
    if (name === "webhook" || (["linear", "notion"].includes(name) && ["capture", "video", "inline"].includes(kind))) {
      await expect(pending).rejects.toThrow();
      if (name !== "webhook") expect(progress.beforeCreate).not.toHaveBeenCalled();
    } else {
      const result = await pending;
      expect(result).toMatchObject({ attachments: [{ fileId: id }] });
      expect((result as { attachments: { delivery: string }[] }).attachments[0].delivery).not.toBe("attached");
    }
  });
});

describe("provider-specific attachment completion", () => {
  it.each([false, true])("Linear native attachment success=%s with a failed body write", async (nativeAttached) => {
    sendBg.mockImplementation(async (msg) => {
      if (msg.type === "linear.submitIssue") return { id: "id", identifier: "L-1", url: "https://linear.app/issue/L-1" };
      if (msg.type === "linear.uploadFile") return { fileId: msg.fileId, assetUrl: "https://files.example/logs" };
      if (msg.type === "linear.createAttachment") return { ok: nativeAttached };
      if (msg.type === "linear.updateIssueDescription") throw new Error("body failed");
      throw new Error("unexpected message");
    });
    const result = await submitToLinear({ ctx: { ...ctx, actionLogCaptured: 1 }, teamId: "t", submissionFiles: [{ id: "logs", kind: "logs", filename: "logs.html", contentType: "text/html", dataUrl: "data:text/html;base64,QQ==" }] });
    expect(result.attachments).toMatchObject([{ fileId: "logs", delivery: nativeAttached ? "attached" : "failed", presentation: "failed", failure: { stage: nativeAttached ? "body" : "link" } }]);
  });
  it("Slack retains successful file delivery but reports a failed permalink boundary", async () => {
    sendBg.mockImplementation(async (msg) => {
      if (msg.type === "slack.postMessage") return { ts: "1.2" };
      if (msg.type === "slack.uploadFiles") return [{ fileId: "user:u", filename: "u.pdf", ok: true, remoteFileId: "F1" }];
      if (msg.type === "slack.getPermalink") throw new Error("lost response");
    });
    const result = await submitToSlack({ ctx, channelId: "c", submissionFiles: [{ id: "user:u", kind: "user", filename: "u.pdf", contentType: "application/pdf", dataUrl: "data:application/pdf;base64,QQ==" }] });
    expect(result).toMatchObject({ key: "1.2", attachments: [{ fileId: "user:u", delivery: "attached", presentation: "failed" }] });
  });
});

it.each(["jpg", "png"])("Jira maps prepared %s comparison captures to actual ADF slots by ID", async (extension) => {
  const { buildJiraDescriptionContent } = await import("@/background/messages");
  let finalBody = "";
  sendBg.mockImplementation(async (m) => {
    if (m.type === "jira.createIssue") return { key: "P-1", url: "https://jira.example/P-1", siteId: "s" };
    if (m.type === "jira.uploadAttachment") return { fileId: m.attachment.fileId, filename: m.attachment.filename, ok: true, href: "https://jira.example/file", file: { kind: "media", mediaId: m.attachment.fileId } };
    if (m.type === "jira.updateIssueDescription") finalBody = JSON.stringify(buildJiraDescriptionContent({ description: m.description, uploadMap: new Map(m.uploads.map((r: { filename: string; file: never }) => [r.filename, r.file])), bodyLocale: "en" }));
    return { ok: true };
  });
  const captures = ["before", "after"].map((side) => ({ id: `capture:${side}-0`, kind: "capture" as const, filename: `${side}-0.${extension}`, contentType: extension === "jpg" ? "image/jpeg" : "image/png", dataUrl: "data:application/octet-stream;base64,QQ==" }));
  const result = await submitToJira({ ctx: { ...ctx, captureMode: "element", styleElements: [{ selector: "#x", tagName: "div", classListBefore: [], classListAfter: [], specifiedStyles: {}, diffs: [{ prop: "color", asIs: "red", toBe: "blue" }], beforeFilename: "before-0.webp", afterFilename: "after-0.webp" }] }, projectKey: "P", summary: "Title", issueTypeId: "1", images: captures.map((f) => ({ ...f, filename: f.filename.replace(extension, "webp") })), submissionFiles: [...captures, { ...captures[0], id: "user:collision", kind: "user" }] });
  expect(finalBody).toContain("capture:before-0");
  expect(finalBody).toContain("capture:after-0");
  expect(finalBody).not.toContain("user:collision");
  expect(result.attachments?.slice(0, 2).every((r) => r.presentation === "complete")).toBe(true);
});

it.each(["reject", "missing", "empty"])("Slack preserves presentation failure on %s permalink", async (mode) => {
  sendBg.mockImplementation(async (m) => {
    if (m.type === "slack.postMessage") return { ts: "1.2" };
    if (m.type === "slack.uploadFiles") return m.files.map((f: { fileId: string; filename: string }) => ({ ...f, ok: true, remoteFileId: "F1" }));
    if (mode === "reject") throw new Error("lost response");
    return mode === "empty" ? { permalink: "" } : {};
  });
  const result = await submitToSlack({ ctx, channelId: "C", submissionFiles: [{ id: "logs", kind: "logs", filename: "logs.html", contentType: "text/html", dataUrl: "data:text/html;base64,QQ==" }] });
  expect(result.attachments?.[0]).toMatchObject({ delivery: "attached", presentation: "failed" });
});

it.each([true, false])("Slack log summary is truthful before upload success=%s", async (ok) => {
  const texts: string[] = [];
  sendBg.mockImplementation(async (m) => {
    if (m.type === "slack.postMessage") { texts.push(m.payload.text); return { ts: "1.2" }; }
    if (m.type === "slack.uploadFiles") return [{ fileId: "logs", filename: "logs.html", ok, remoteFileId: ok ? "F1" : undefined }];
    return { permalink: "https://slack.com/archives/C/p12" };
  });
  await submitToSlack({ ctx: { ...ctx, actionLogCaptured: 1 }, channelId: "C", submissionFiles: [{ id: "logs", kind: "logs", filename: "logs.html", contentType: "text/html", dataUrl: "data:text/html;base64,QQ==" }] });
  expect(texts.join("\n")).not.toMatch(/BugShot report attached|file not attached/);
  expect(texts.join("\n")).toContain("1");
});

it.each(providers.filter(([name]) => ["jira", "linear", "notion", "asana", "clickup", "gitlab"].includes(name)))("%s preserves safe upload failure metadata across its adapter", async (_name, submit, args, createType, response) => {
  for (const [status, code] of [[413, "size-limit"], [401, "authentication"], [403, "permission"], [429, "rate-limit"], [504, "timeout"], [undefined, "network"]] as const) {
    sendBg.mockImplementation(async (m) => {
      if (m.type === createType) return { ...response, attachedFileIds: [] };
      if (m.type.includes("upload")) throw status === undefined ? new TypeError("private network payload") : Object.assign(new Error("private API body"), { status });
      return { ok: true };
    });
    const result = await submit({ ctx, ...args, submissionFiles: [{ id: "user:u", kind: "user", filename: "file.pdf", contentType: "application/pdf", dataUrl: "data:application/pdf;base64,QQ==" }] } as never);
    if (!("attachments" in result)) throw new Error("Missing file results");
    expect(result.attachments?.[0]).toMatchObject({ delivery: status === undefined || status >= 500 ? "unknown" : "failed", failure: { stage: "upload", code, ...(status ? { httpStatus: status } : {}) } });
    expect(JSON.stringify(result.attachments)).not.toContain("private");
  }
});
