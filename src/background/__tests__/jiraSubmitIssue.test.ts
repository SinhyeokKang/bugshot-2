import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { IMAGE_PLACEHOLDER, VIDEO_PLACEHOLDER } from "@/lib/adf-sentinels";
import type { JiraAdfDoc, JiraAttachmentInput, JiraAuth } from "@/types/jira";
import type { BgRequest } from "@/types/messages";
import type { SubmissionFile } from "@/types/attachment";
import type { MarkdownContext } from "@/sidepanel/lib/buildIssueMarkdown";

const api = vi.hoisted(() => ({
  ensureFreshAuth: vi.fn(async (auth: unknown) => auth), createIssue: vi.fn(),
  uploadAttachment: vi.fn(), getMediaFileId: vi.fn(), updateIssueDescription: vi.fn(), createIssueLink: vi.fn(),
}));
const body = vi.hoisted(() => ({ doc: { version: 1, type: "doc", content: [] } as JiraAdfDoc }));
vi.mock("../jira-api", async (original) => ({ ...(await original<object>()), ...api }));
vi.mock("@/sidepanel/lib/buildIssueAdf", () => ({ buildIssueAdf: () => body.doc }));
vi.mock("@/sidepanel/lib/attachmentDimensions", () => ({ annotateAttachmentDimensions: async (files: unknown[]) => files }));
vi.mock("@/lib/bg-client", () => ({ sendBg: (message: BgRequest) => handleMessage(message, {}) }));
const AUTH: JiraAuth = { kind: "apiKey", baseUrl: "https://acme.atlassian.net", email: "a@b.c", apiToken: "tok" };
vi.mock("@/lib/settings-storage", async (original) => ({ ...(await original<object>()), readStoredAuth: vi.fn(async () => AUTH) }));
import { handleMessage } from "../messages";
import { submitToJira } from "@/sidepanel/lib/submitToJira";

const file = (id: string, kind: SubmissionFile["kind"], filename: string): SubmissionFile => ({ id, kind, filename, contentType: kind === "logs" ? "text/html" : "image/webp", dataUrl: "data:image/webp;base64,QQ==" });
const capture = file("capture:screenshot", "capture", "screenshot.webp");
const logs = file("logs", "logs", "logs.html");
const video = file("video", "video", "recording.mp4");
const user = file("user:a", "user", "report.pdf");
const doc = (marker: string): JiraAdfDoc => ({ version: 1, type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: marker }] }] });
const submit = (files: SubmissionFile[] = [capture, logs]) => submitToJira({
  ctx: { bodyLocale: "en", sections: {}, styleElements: [] } as unknown as MarkdownContext,
  projectKey: "BUG", summary: "s", issueTypeId: "1", submissionFiles: files,
  progress: { attemptId: "attempt", beforeCreate: async () => {}, created: async () => {} },
});
const resultFor = (result: Awaited<ReturnType<typeof submit>>, id: string) => result.attachments?.find((r) => r.fileId === id);

beforeEach(() => {
  body.doc = { version: 1, type: "doc", content: [] };
  api.createIssue.mockResolvedValue({ id: "1", key: "BUG-42" });
  api.uploadAttachment.mockImplementation(async (_auth, _key, filename: string) => [{ id: `1000${api.uploadAttachment.mock.calls.length}`, filename, mediaApiFileId: `media-${api.uploadAttachment.mock.calls.length}` }]);
  api.updateIssueDescription.mockResolvedValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("Jira split submission regression contracts", () => {
  it("removes the obsolete create-and-upload message from every routing layer", () => {
    for (const path of ["src/types/messages.ts", "src/background/messages.ts", "src/background/bgRequestTypes.ts"]) {
      expect(readFileSync(path, "utf8")).not.toContain('"jira.submitIssue"');
    }
  });
  it("returns the destination and per-file success", async () => {
    const result = await submit();
    expect(result).toMatchObject({ key: "BUG-42", url: `${AUTH.baseUrl}/browse/BUG-42` });
    expect(result.attachments?.map((r) => r.delivery)).toEqual(["attached", "attached"]);
    expect(api.updateIssueDescription).toHaveBeenCalledOnce();
  });
  it("retains attached bytes and destination when the body update fails", async () => {
    api.updateIssueDescription.mockRejectedValue(new Error("PUT 500"));
    const result = await submit();
    expect(result.key).toBe("BUG-42");
    expect(result.attachments).toEqual(expect.arrayContaining([expect.objectContaining({ fileId: capture.id, delivery: "attached", presentation: "failed" })]));
    expect(api.createIssue).toHaveBeenCalledOnce();
    expect(api.uploadAttachment.mock.calls.map((c) => c[2])).toEqual(["screenshot.webp", "logs.html"]);
  });
  it("inlines only the capture when a user file has the same name", async () => {
    body.doc = doc(IMAGE_PLACEHOLDER);
    await submit([capture, { ...user, filename: capture.filename }]);
    const written = JSON.stringify(api.updateIssueDescription.mock.calls[0][2]);
    expect(written).toContain("media-1");
    expect(written).not.toContain("media-2");
  });
  it("uploads immutable prepared logs and same-name user bytes without mutation", async () => {
    await submit([logs, { ...user, filename: logs.filename }]);
    for (const call of api.uploadAttachment.mock.calls) expect(await call[3].text()).toBe("A");
    expect(api.getMediaFileId).not.toHaveBeenCalled();
  });
  it("separates same-name user failure from successful logs", async () => {
    api.uploadAttachment.mockImplementation(async (_auth, _key, filename) => {
      if (api.uploadAttachment.mock.calls.length === 2) throw Object.assign(new Error(), { status: 413 });
      return [{ id: "10001", filename }];
    });
    const result = await submit([logs, { ...user, filename: logs.filename }]);
    expect(resultFor(result, logs.id)?.delivery).toBe("attached");
    expect(resultFor(result, user.id)).toMatchObject({ delivery: "failed", failure: { code: "size-limit" } });
  });
  it.each([IMAGE_PLACEHOLDER, VIDEO_PLACEHOLDER])("never sends private marker %s even when all uploads and body update fail", async (marker) => {
    body.doc = doc(marker);
    api.uploadAttachment.mockRejectedValue(Object.assign(new Error(), { status: 413 }));
    api.updateIssueDescription.mockRejectedValue(new Error("PUT 500"));
    await submit([capture, video, logs]);
    for (const value of [api.createIssue.mock.calls[0][1], api.updateIssueDescription.mock.calls[0][2]]) {
      expect(JSON.stringify(value)).not.toContain(marker);
      expect(JSON.stringify(value)).toContain("file not attached");
    }
    expect(api.updateIssueDescription).toHaveBeenCalledOnce();
  });
  it("also updates an empty template safely after upload failure", async () => {
    api.uploadAttachment.mockRejectedValue(new Error("network"));
    await submit([video]);
    expect(api.updateIssueDescription).toHaveBeenCalledOnce();
    expect(api.updateIssueDescription.mock.calls[0][2]).toEqual(body.doc);
  });
  it.each([capture, video, logs, user])("keeps independent file outcome for $id", async (failed) => {
    const files = [capture, video, logs, user];
    api.uploadAttachment.mockImplementation(async (_auth, _key, filename) => {
      if (filename === failed.filename) throw Object.assign(new Error(), { status: 413 });
      return [{ id: "10001", filename, mediaApiFileId: "media" }];
    });
    const result = await submit(files);
    for (const f of files) expect(resultFor(result, f.id)?.delivery).toBe(f.id === failed.id ? "failed" : "attached");
  });
  it("creates before uploads and refreshes each message authentication", async () => {
    const result = await handleMessage({ type: "jira.createIssue", payload: { projectKey: "P", summary: "Title", issueTypeId: "1", bodyLocale: "en", description: doc(IMAGE_PLACEHOLDER) } }, {});
    expect(result).toMatchObject({ key: "BUG-42", siteId: AUTH.baseUrl });
    expect(api.uploadAttachment).not.toHaveBeenCalled();
    expect(api.ensureFreshAuth).toHaveBeenCalledOnce();
  });
  it("echoes distinct IDs for colliding upload names", async () => {
    for (const fileId of [capture.id, user.id]) {
      const result = await handleMessage({ type: "jira.uploadAttachment", issueKey: "BUG-42", attachment: { fileId, filename: capture.filename, dataUrl: capture.dataUrl, userAttachment: fileId === user.id } }, {});
      expect(result).toMatchObject({ fileId, ok: true });
    }
    expect(api.ensureFreshAuth).toHaveBeenCalledTimes(2);
  });
  it("rejects an empty upload response", async () => {
    api.uploadAttachment.mockResolvedValueOnce([]);
    const attachment: JiraAttachmentInput = { fileId: user.id, filename: user.filename, dataUrl: user.dataUrl, userAttachment: true };
    expect(await handleMessage({ type: "jira.uploadAttachment", issueKey: "BUG-42", attachment }, {})).toMatchObject({ fileId: user.id, ok: false });
  });
  it("refreshes description auth and honors its independent body locale", async () => {
    await handleMessage({ type: "jira.updateIssueDescription", issueKey: "BUG-42", bodyLocale: "en", description: doc(VIDEO_PLACEHOLDER), uploads: [] }, {});
    expect(api.ensureFreshAuth).toHaveBeenCalledOnce();
    expect(JSON.stringify(api.updateIssueDescription.mock.calls[0][2])).toContain("file not attached");
  });
});
