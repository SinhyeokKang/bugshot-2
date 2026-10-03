import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttachmentBodyPlan, SubmissionFile } from "@/types/attachment";
import type { MarkdownContext } from "../buildIssueMarkdown";
import type { SubmissionProgress } from "../submissionRecovery";
import { planAttachmentBodyPatch } from "../attachmentBodyPatch";
import { submitToGithub } from "../submitToGithub";
import { submitToGitlab } from "../submitToGitlab";
import { submitToJira } from "../submitToJira";
import { submitToLinear } from "../submitToLinear";
import { submitToAsana } from "../submitToAsana";
import { submitToClickup } from "../submitToClickup";

// Option (a): the initial submission records, next to the body it actually wrote, where each
// unfinished file belongs. The proof is end to end — filling the recorded slots of the partial
// body must give exactly the body the same adapter writes when every upload succeeds.
const sendBg = vi.hoisted(() => vi.fn());
vi.mock("@/lib/bg-client", () => ({ sendBg }));

const ctx: MarkdownContext = { bodyLocale: "en", captureMode: "screenshot", title: "Title", sections: { steps: "1. open" }, sectionConfig: [{ id: "steps", enabled: true, renderAs: "paragraph" } as never], url: "https://example.com", selector: "", tagName: "", classListBefore: [], classListAfter: [], specifiedStyles: {}, tokens: [], viewport: { width: 100, height: 100 }, capturedAt: 1, diffs: [], environment: [], actionLogCaptured: 1 };
const file = (id: string, kind: SubmissionFile["kind"], filename: string): SubmissionFile => ({ id, kind, filename, contentType: kind === "logs" ? "text/html" : kind === "user" ? "application/pdf" : "image/webp", dataUrl: `data:application/octet-stream;base64,${Buffer.from(id).toString("base64")}` });
const capture = file("capture:screenshot", "capture", "screenshot.webp");
const logs = file("logs", "logs", "logs.html");
const user = file("user:a", "user", "a.pdf");

let slots: Array<{ lastWritten: string; replacements: AttachmentBodyPlan["replacements"] }>;
let progress: SubmissionProgress;
beforeEach(() => {
  vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "1" }) } });
  sendBg.mockReset();
  slots = [];
  progress = {
    attemptId: "a",
    beforeCreate: vi.fn(async () => {}),
    created: vi.fn(async () => {}),
    fileCheckpoint: vi.fn(async () => {}),
    bodyWritten: vi.fn(async () => {}),
    bodySlots: vi.fn(async (lastWritten: string, replacements: AttachmentBodyPlan["replacements"]) => { slots.push({ lastWritten, replacements }); }),
  };
});
function rpc(handlers: Record<string, (msg: any) => unknown>) {
  sendBg.mockImplementation(async (msg) => {
    const handler = handlers[msg.type];
    if (!handler) throw new Error(`unexpected ${msg.type}`);
    return handler(msg);
  });
}
const sent = (type: string) => sendBg.mock.calls.map(([m]) => m).filter((m) => m.type === type);
const fill = (format: AttachmentBodyPlan["format"], ready: Record<string, string>, targets: string[]) => {
  expect(slots).toHaveLength(1);
  const plan: AttachmentBodyPlan = { format, lastWritten: slots[0].lastWritten, replacements: slots[0].replacements };
  return planAttachmentBodyPatch(plan, slots[0].lastWritten, new Map(Object.entries(ready)), targets);
};
const href = (f: { filename: string }) => `https://github.com/user-attachments/files/9/${f.filename}`;

describe("markdown adapters record fillable slots for unfinished files", () => {
  it("GitHub: filling the failed screenshot and user file reproduces the all-success body", async () => {
    const files = [capture, logs, user];
    const input = () => ({ ctx, owner: "o", repo: "r", images: [{ filename: "screenshot.webp", dataUrl: "x" }], logs: [{ filename: "logs.html", dataUrl: "x" }], attachments: [{ filename: "a.pdf", dataUrl: "x" }], submissionFiles: files, progress });
    rpc({
      "github.uploadFiles": (msg) => msg.files.map((f: any) => f.fileId === "logs" ? { fileId: f.fileId, filename: f.filename, ok: true, href: href(f) } : { fileId: f.fileId, filename: f.filename, ok: false, failure: { stage: "upload", code: "unknown" } }),
      "github.submitIssue": () => ({ number: 1, url: "https://github.com/o/r/issues/1" }),
    });
    await submitToGithub(input());
    const partialBody = sent("github.submitIssue")[0].payload.body;
    expect(slots[0].lastWritten).toBe(partialBody);
    const result = fill("markdown", { [capture.id]: href(capture), [user.id]: href(user) }, [capture.id, user.id]);

    sendBg.mockReset();
    slots = [];
    rpc({
      "github.uploadFiles": (msg) => msg.files.map((f: any) => ({ fileId: f.fileId, filename: f.filename, ok: true, href: href(f) })),
      "github.submitIssue": () => ({ number: 1, url: "https://github.com/o/r/issues/1" }),
    });
    await submitToGithub(input());
    expect(result.body).toBe(sent("github.submitIssue")[0].payload.body);
    expect(result.conflict).toEqual([]);
    expect(slots).toEqual([]);
  });

  it("GitHub records no slot for a file its body never references, so retry offers the download", async () => {
    const orphan = file("inline:zzz", "inline", "inline-zzz.webp");
    rpc({
      "github.uploadFiles": (msg) => msg.files.map((f: any) => ({ fileId: f.fileId, filename: f.filename, ok: false, failure: { stage: "upload", code: "unknown" } })),
      "github.submitIssue": () => ({ number: 1, url: "https://github.com/o/r/issues/1" }),
    });
    await submitToGithub({ ctx, owner: "o", repo: "r", inlineImages: [{ refId: "zzz", dataUrl: "x" }], submissionFiles: [orphan], progress });
    expect(slots).toHaveLength(1);
    expect(slots[0].replacements.filter((r) => r.fileId === orphan.id)).toEqual([]);
  });

  it("GitLab: a failed upload is fillable with its project-relative path", async () => {
    const input = () => ({ ctx, projectId: 4, images: [{ filename: "screenshot.webp", dataUrl: "x" }], submissionFiles: [capture], progress });
    rpc({
      "gitlab.uploadFiles": (msg) => msg.files.map((f: any) => ({ fileId: f.fileId, filename: f.filename, ok: false, failure: { stage: "upload", code: "permission", httpStatus: 403 } })),
      "gitlab.submitIssue": () => ({ iid: 3, url: "https://gitlab.com/o/r/-/issues/3" }),
    });
    await submitToGitlab(input());
    const result = fill("markdown", { [capture.id]: "/uploads/abc/screenshot.webp" }, [capture.id]);
    sendBg.mockReset();
    rpc({
      "gitlab.uploadFiles": (msg) => msg.files.map((f: any) => ({ fileId: f.fileId, filename: f.filename, ok: true, href: "/uploads/abc/screenshot.webp" })),
      "gitlab.submitIssue": () => ({ iid: 3, url: "https://gitlab.com/o/r/-/issues/3" }),
    });
    await submitToGitlab(input());
    expect(result.body).toBe(sent("gitlab.submitIssue")[0].payload.description);
  });

  it("GitLab: slots are recorded against the description after the logs backlink swap", async () => {
    const html = `data:text/html;base64,${Buffer.from("<html><body></body></html>").toString("base64")}`;
    const logsFile = { ...logs, dataUrl: html };
    const input = () => ({ ctx, projectId: 4, images: [{ filename: "screenshot.webp", dataUrl: "x" }], logs: [{ filename: "logs.html", dataUrl: html }], submissionFiles: [capture, logsFile], progress });
    let reuploads = 0;
    const handlers = (captureOk: boolean) => ({
      "gitlab.uploadFiles": (msg: any) => msg.files.map((f: any) => f.fileId === "logs"
        ? { fileId: f.fileId, filename: f.filename, ok: true, href: `/uploads/${++reuploads}/logs.html` }
        : captureOk ? { fileId: f.fileId, filename: f.filename, ok: true, href: "/uploads/c/screenshot.webp" } : { fileId: f.fileId, filename: f.filename, ok: false, failure: { stage: "upload", code: "permission", httpStatus: 403 } }),
      "gitlab.submitIssue": () => ({ iid: 3, url: "https://gitlab.com/o/r/-/issues/3" }),
      "gitlab.updateIssueDescription": () => ({}),
    });
    rpc(handlers(false));
    await submitToGitlab(input());
    expect(slots[0].lastWritten).toBe(sent("gitlab.updateIssueDescription")[0].description);
    const result = fill("markdown", { [capture.id]: "/uploads/c/screenshot.webp" }, [capture.id]);
    sendBg.mockReset();
    slots = [];
    reuploads = 0;
    rpc(handlers(true));
    await submitToGitlab(input());
    expect(result.body).toBe(sent("gitlab.updateIssueDescription")[0].description);
  });

  it("ClickUp: a failed second markdown write leaves every referenced file fillable from the first body", async () => {
    const input = () => ({ ctx, listId: "l", images: [{ filename: "screenshot.webp", dataUrl: "x" }], logs: [{ filename: "logs.html", dataUrl: "x" }], submissionFiles: [capture, logs], progress });
    const clickupHref = (f: { filename: string }) => `https://t1.p.clickup-attachments.com/t1/${f.filename}`;
    rpc({
      "clickup.submitIssue": () => ({ id: "task", url: "https://app.clickup.com/t/task" }),
      "clickup.uploadFile": (msg) => msg.files.map((f: any) => ({ fileId: f.fileId, filename: f.filename, ok: true, href: clickupHref(f) })),
      "clickup.updateTaskMarkdown": () => { throw Object.assign(new Error("server"), { status: 500 }); },
    });
    await submitToClickup(input());
    expect(slots[0].lastWritten).toBe(sent("clickup.submitIssue")[0].payload.markdownContent);
    const result = fill("markdown", { [capture.id]: clickupHref(capture), [logs.id]: clickupHref(logs) }, [capture.id, logs.id]);
    sendBg.mockReset();
    slots = [];
    rpc({
      "clickup.submitIssue": () => ({ id: "task", url: "https://app.clickup.com/t/task" }),
      "clickup.uploadFile": (msg) => msg.files.map((f: any) => ({ fileId: f.fileId, filename: f.filename, ok: true, href: clickupHref(f) })),
      "clickup.updateTaskMarkdown": () => ({}),
    });
    await submitToClickup(input());
    expect(result.body).toBe(sent("clickup.updateTaskMarkdown")[0].markdownContent);
  });

  it("Linear: an unlinked logs file is fillable with its asset URL", async () => {
    const input = () => ({ ctx, teamId: "t", logs: [{ filename: "logs.html", dataUrl: "x" }], submissionFiles: [logs], progress });
    rpc({
      "linear.submitIssue": () => ({ id: "issue", identifier: "L-1", url: "https://linear.app/issue/L-1" }),
      "linear.uploadFile": (msg) => ({ fileId: msg.fileId, assetUrl: "https://uploads.linear.app/logs" }),
      "linear.createAttachment": () => { throw Object.assign(new Error("bad"), { status: 400 }); },
      "linear.updateIssueDescription": () => { throw Object.assign(new Error("bad"), { status: 400 }); },
    });
    await submitToLinear(input());
    const result = fill("markdown", { [logs.id]: "https://uploads.linear.app/logs" }, [logs.id]);
    sendBg.mockReset();
    slots = [];
    rpc({
      "linear.submitIssue": () => ({ id: "issue", identifier: "L-1", url: "https://linear.app/issue/L-1" }),
      "linear.uploadFile": (msg) => ({ fileId: msg.fileId, assetUrl: "https://uploads.linear.app/logs" }),
      "linear.createAttachment": () => ({ ok: true }),
      "linear.updateIssueDescription": () => ({ ok: true }),
    });
    await submitToLinear(input());
    expect(result.body).toBe(sent("linear.updateIssueDescription")[0].description);
  });

  it("Asana: a failed second notes write leaves the logs confirmation fillable", async () => {
    const input = () => ({ ctx, workspaceGid: "w", logs: [{ filename: "logs.html", dataUrl: "x" }], submissionFiles: [logs], progress });
    rpc({
      "asana.submitIssue": () => ({ gid: "task", permalinkUrl: "https://app.asana.com/0/0/task" }),
      "asana.uploadFiles": (msg) => msg.files.map((f: any) => ({ fileId: f.fileId, filename: f.filename, ok: true, gid: "g-logs" })),
      "asana.updateTaskNotes": () => { throw Object.assign(new Error("bad"), { status: 400 }); },
    });
    await submitToAsana(input());
    const result = fill("asana-html", { [logs.id]: "g-logs" }, [logs.id]);
    sendBg.mockReset();
    slots = [];
    rpc({
      "asana.submitIssue": () => ({ gid: "task", permalinkUrl: "https://app.asana.com/0/0/task" }),
      "asana.uploadFiles": (msg) => msg.files.map((f: any) => ({ fileId: f.fileId, filename: f.filename, ok: true, gid: "g-logs" })),
      "asana.updateTaskNotes": () => ({}),
    });
    await submitToAsana(input());
    expect(result.body).toBe(sent("asana.updateTaskNotes")[0].htmlNotes);
  });
});

describe("Jira records ADF slots against the safe body it actually wrote", () => {
  it("restores the image placeholder of a failed screenshot and nothing else", async () => {
    const safe = (doc: any) => ({ ...doc, content: doc.content.map((n: any) => n.content?.[0]?.text === "__BUGSHOT_IMAGE__" ? { type: "paragraph", content: [{ type: "text", text: "Attachment dropped" }] } : n) });
    rpc({
      "jira.createIssue": (msg) => ({ key: "BUG-1", url: "https://acme.atlassian.net/browse/BUG-1", siteId: "cloud", description: safe(msg.payload.description) }),
      "jira.uploadAttachment": (msg) => ({ fileId: msg.attachment.fileId, filename: msg.attachment.filename, ok: false, failure: { stage: "upload", code: "permission", httpStatus: 403 } }),
      "jira.updateIssueDescription": (msg) => ({ ok: true, description: safe(msg.description) }),
    });
    await submitToJira({ ctx, projectKey: "BUG", summary: "s", issueTypeId: "1", images: [{ filename: "screenshot.webp", dataUrl: "x" }], submissionFiles: [capture], progress });
    const template = sent("jira.createIssue")[0].payload.description;
    const slot = template.content.findIndex((n: any) => n.content?.[0]?.text === "__BUGSHOT_IMAGE__");
    expect(slot).toBeGreaterThanOrEqual(0);
    const written = JSON.parse(slots[0].lastWritten);
    const result = fill("adf", { [capture.id]: "media-1" }, [capture.id]);
    const patched = JSON.parse(result.body!).content;
    expect(patched).toHaveLength(written.content.length);
    expect(patched[slot]).toEqual(template.content[slot]);
    expect(patched.filter((_: unknown, i: number) => i !== slot)).toEqual(written.content.filter((_: unknown, i: number) => i !== slot));
  });

  it("records no slot for a user file, whose native attachment needs no body", async () => {
    rpc({
      "jira.createIssue": (msg) => ({ key: "BUG-1", url: "u", siteId: "cloud", description: msg.payload.description }),
      "jira.uploadAttachment": (msg) => ({ fileId: msg.attachment.fileId, filename: msg.attachment.filename, ok: false, failure: { stage: "upload", code: "permission", httpStatus: 403 } }),
      "jira.updateIssueDescription": (msg) => ({ ok: true, description: msg.description }),
    });
    await submitToJira({ ctx: { ...ctx, captureMode: "freeform" }, projectKey: "BUG", summary: "s", issueTypeId: "1", attachments: [{ filename: "a.pdf", dataUrl: "x" }], submissionFiles: [user], progress });
    expect(slots.flatMap((s) => s.replacements)).toEqual([]);
  });
});
