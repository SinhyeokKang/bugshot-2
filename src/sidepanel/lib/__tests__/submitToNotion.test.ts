import { beforeEach, describe, expect, it, vi } from "vitest";

const sendBg = vi.fn();
vi.mock("@/types/messages", () => ({ sendBg: (...a: unknown[]) => sendBg(...a) }));

const attachments = vi.fn();
vi.mock("../buildNotionIssueBody", () => ({
  buildNotionIssueBody: () => ({ blocks: [], attachments: attachments() }),
}));
vi.mock("../zipLogsHtml", () => ({
  zipLogsHtml: async (filename: string) => ({
    filename: `${filename}.zip`,
    contentType: "application/zip",
    dataUrl: "data:zip",
  }),
}));
vi.mock("../uploadMime", () => ({
  guessUploadMime: (f: string) => (f.endsWith(".html") ? "text/html" : "application/octet-stream"),
}));

import { submitToNotion } from "../submitToNotion";
import type { MarkdownContext } from "../buildIssueMarkdown";

function makeCtx(): MarkdownContext {
  return {
    captureMode: "screenshot",
    title: "Test",
    sections: { description: "본문" },
    sectionConfig: [
      { id: "description", enabled: true, renderAs: "paragraph", builtIn: true },
    ],
    url: "https://example.com",
    selector: "div",
    tagName: "div",
    classListBefore: [],
    classListAfter: [],
    specifiedStyles: {},
    tokens: [],
    viewport: { width: 1024, height: 768 },
    capturedAt: 1700000000000,
    diffs: [],
    environment: [],
  };
}

const PAGE = { pageId: "abcdef1234567890", url: "https://notion.so/abcdef" };

beforeEach(() => {
  sendBg.mockReset();
  attachments.mockReset();
});

describe("submitToNotion logsDropped", () => {
  it("로그 첨부 업로드 실패(용량 초과) 시 logsDropped: true (페이지는 생성)", async () => {
    attachments.mockReturnValue([
      { placeholderId: "log-0", filename: "logs.html.zip", contentType: "application/zip", dataUrl: "data:zip", category: "log" },
    ]);
    sendBg.mockImplementation(async (msg: { type: string; filename?: string }) => {
      if (msg.type === "notion.uploadFile") {
        if (msg.filename === "logs.html.zip") throw new Error("entity too large");
        return { fileUploadId: `fu-${msg.filename}` };
      }
      if (msg.type === "notion.submitPage") return PAGE;
      return undefined;
    });

    const res = await submitToNotion({
      ctx: makeCtx(),
      logs: [{ filename: "logs.html", dataUrl: "data:LOGS" }],
      databaseId: "DB",
      titlePropertyName: "Name",
      selectValues: [],
    });

    expect(res.logsDropped).toBe(true);
    expect(res.url).toBe(PAGE.url);
  });

  it("로그 첨부 성공이면 logsDropped: false", async () => {
    attachments.mockReturnValue([
      { placeholderId: "log-0", filename: "logs.html.zip", contentType: "application/zip", dataUrl: "data:zip", category: "log" },
    ]);
    sendBg.mockImplementation(async (msg: { type: string; filename?: string }) => {
      if (msg.type === "notion.uploadFile") return { fileUploadId: `fu-${msg.filename}` };
      if (msg.type === "notion.submitPage") return PAGE;
      return undefined;
    });

    const res = await submitToNotion({
      ctx: makeCtx(),
      logs: [{ filename: "logs.html", dataUrl: "data:LOGS" }],
      databaseId: "DB",
      titlePropertyName: "Name",
      selectValues: [],
    });

    expect(res.logsDropped).toBe(false);
  });

  it("requireMediaUpload면 사용자 첨부(other) 실패도 throw — submitPage 미호출", async () => {
    attachments.mockReturnValue([
      { placeholderId: "att-0", filename: "doc.pdf", contentType: "application/octet-stream", dataUrl: "data:pdf", category: "other" },
    ]);
    sendBg.mockImplementation(async (msg: { type: string; filename?: string }) => {
      if (msg.type === "notion.uploadFile") {
        if (msg.filename === "doc.pdf") throw new Error("att fail");
        return { fileUploadId: "fu" };
      }
      if (msg.type === "notion.submitPage") return PAGE;
      return undefined;
    });

    await expect(
      submitToNotion({
        ctx: makeCtx(),
        attachments: [{ filename: "doc.pdf", dataUrl: "data:pdf" }],
        databaseId: "DB",
        titlePropertyName: "Name",
        selectValues: [],
        requireMediaUpload: true,
      }),
    ).rejects.toThrow();

    expect(
      sendBg.mock.calls.filter(([m]) => m.type === "notion.submitPage").length,
    ).toBe(0);
  });

  it("requireMediaUpload여도 로그 실패는 best-effort(throw 안 함)", async () => {
    attachments.mockReturnValue([
      { placeholderId: "log-0", filename: "logs.html.zip", contentType: "application/zip", dataUrl: "data:zip", category: "log" },
    ]);
    sendBg.mockImplementation(async (msg: { type: string; filename?: string }) => {
      if (msg.type === "notion.uploadFile") {
        if (msg.filename === "logs.html.zip") throw new Error("too large");
        return { fileUploadId: "fu" };
      }
      if (msg.type === "notion.submitPage") return PAGE;
      return undefined;
    });

    const res = await submitToNotion({
      ctx: makeCtx(),
      logs: [{ filename: "logs.html", dataUrl: "data:LOGS" }],
      databaseId: "DB",
      titlePropertyName: "Name",
      selectValues: [],
      requireMediaUpload: true,
    });

    expect(res.logsDropped).toBe(true);
  });

  it("이미지 첨부 실패는 격리 대상 아님 — 전체 reject", async () => {
    attachments.mockReturnValue([
      { placeholderId: "img-0", filename: "screenshot.webp", contentType: "image/webp", dataUrl: "data:img", category: "image" },
    ]);
    sendBg.mockImplementation(async (msg: { type: string; filename?: string }) => {
      if (msg.type === "notion.uploadFile") {
        if (msg.filename === "screenshot.webp") throw new Error("img fail");
        return { fileUploadId: "fu" };
      }
      if (msg.type === "notion.submitPage") return PAGE;
      return undefined;
    });

    await expect(
      submitToNotion({
        ctx: makeCtx(),
        databaseId: "DB",
        titlePropertyName: "Name",
        selectValues: [],
      }),
    ).rejects.toThrow();
  });
});
