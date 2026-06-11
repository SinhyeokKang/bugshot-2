import { beforeEach, describe, expect, it, vi } from "vitest";

const sendBg = vi.fn();
vi.mock("@/types/messages", () => ({ sendBg: (...a: unknown[]) => sendBg(...a) }));

const attachments = vi.fn();
vi.mock("../buildNotionIssueBody", () => ({
  buildNotionIssueBody: () => ({ blocks: [], attachments: attachments() }),
}));
vi.mock("../buildAiMetaAttachment", () => ({
  buildAiMetaAttachment: () => ({ filename: "bugshot.md", dataUrl: "data:md" }),
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

describe("submitToNotion aiMeta 격리", () => {
  it("aiMeta(bugshot.md) 업로드 실패해도 페이지는 생성되고 첨부에서만 빠진다", async () => {
    attachments.mockReturnValue([]);
    let submitAttachments: Array<{ filename: string }> | undefined;
    sendBg.mockImplementation(
      async (msg: {
        type: string;
        filename?: string;
        payload?: { attachments?: Array<{ filename: string }> };
      }) => {
        if (msg.type === "notion.uploadFile") {
          if (msg.filename === "bugshot.md") throw new Error("meta fail");
          return { fileUploadId: `fu-${msg.filename}` };
        }
        if (msg.type === "notion.submitPage") {
          submitAttachments = msg.payload?.attachments;
          return PAGE;
        }
        return undefined;
      },
    );

    const res = await submitToNotion({
      ctx: makeCtx(),
      databaseId: "DB",
      titlePropertyName: "Name",
      selectValues: [],
    });

    expect(res.url).toBe(PAGE.url);
    expect(submitAttachments?.some((a) => a.filename === "bugshot.md")).toBe(false);
  });
});
