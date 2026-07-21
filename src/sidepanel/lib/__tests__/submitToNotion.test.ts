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

// 본문에 붙여넣은 인라인 이미지는 별도 업로드 후 refId로 블록에 연결된다.
// github/gitlab은 공용 prepareUpload 경유(prepareUpload.test.ts가 커버)이고,
// bespoke 업로드 경로를 가진 4개(notion/slack/linear/clickup)는 각자 그물이 필요하다.
describe("submitToNotion — 인라인 이미지", () => {
  function mockUploadOk() {
    sendBg.mockImplementation(async (msg: { type: string; filename?: string }) => {
      if (msg.type === "notion.uploadFile") return { fileUploadId: `fu-${msg.filename}` };
      if (msg.type === "notion.submitPage") return PAGE;
      return undefined;
    });
  }

  it("inline-{refId}.webp 이름으로 image/webp를 업로드한다", async () => {
    attachments.mockReturnValue([]);
    mockUploadOk();

    await submitToNotion({
      ctx: makeCtx(),
      inlineImages: [{ refId: "r1", dataUrl: "data:IMG1" }],
      databaseId: "DB",
      titlePropertyName: "Name",
      selectValues: [],
    });

    expect(sendBg).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "notion.uploadFile",
        filename: "inline-r1.webp",
        contentType: "image/webp",
        dataUrl: "data:IMG1",
      }),
    );
  });

  // refId 목록이 빠지면 본문의 이미지 자리가 빈 채로 페이지가 만들어진다.
  it("업로드한 refId를 본문 빌더에 넘긴다", async () => {
    attachments.mockReturnValue([]);
    mockUploadOk();

    await submitToNotion({
      ctx: makeCtx(),
      inlineImages: [
        { refId: "r1", dataUrl: "data:IMG1" },
        { refId: "r2", dataUrl: "data:IMG2" },
      ],
      databaseId: "DB",
      titlePropertyName: "Name",
      selectValues: [],
    });

    const page = sendBg.mock.calls.find((c) => c[0].type === "notion.submitPage")![0];
    expect(
      page.payload.attachments.map((u: { placeholderId: string }) => u.placeholderId),
    ).toEqual(["inline-r1", "inline-r2"]);
  });

  it("인라인 업로드는 image 카테고리로 실려 strict 처리된다", async () => {
    attachments.mockReturnValue([]);
    mockUploadOk();

    await submitToNotion({
      ctx: makeCtx(),
      inlineImages: [{ refId: "r1", dataUrl: "data:IMG1" }],
      databaseId: "DB",
      titlePropertyName: "Name",
      selectValues: [],
    });

    const page = sendBg.mock.calls.find((c) => c[0].type === "notion.submitPage")![0];
    expect(page.payload.attachments[0].category).toBe("image");
  });

  // 인라인 이미지는 본문 핵심이라 실패를 삼키면 안 된다 — 깨진 ref로 페이지가 나가는 것을 막는다.
  it("인라인 업로드가 실패하면 페이지를 만들지 않고 throw한다", async () => {
    attachments.mockReturnValue([]);
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "notion.uploadFile") throw new Error("upload failed");
      if (msg.type === "notion.submitPage") return PAGE;
      return undefined;
    });

    await expect(
      submitToNotion({
        ctx: makeCtx(),
        inlineImages: [{ refId: "r1", dataUrl: "data:IMG1" }],
        databaseId: "DB",
        titlePropertyName: "Name",
        selectValues: [],
      }),
    ).rejects.toThrow();
    expect(sendBg.mock.calls.some((c) => c[0].type === "notion.submitPage")).toBe(false);
  });

  it("인라인 이미지가 없으면 업로드를 시도하지 않는다", async () => {
    attachments.mockReturnValue([]);
    mockUploadOk();

    await submitToNotion({
      ctx: makeCtx(),
      databaseId: "DB",
      titlePropertyName: "Name",
      selectValues: [],
    });

    expect(sendBg.mock.calls.some((c) => c[0].type === "notion.uploadFile")).toBe(false);
  });
});
