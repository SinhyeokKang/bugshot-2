import { beforeEach, describe, expect, it, vi } from "vitest";

const sendBg = vi.fn();
vi.mock("@/types/messages", () => ({ sendBg: (...a: unknown[]) => sendBg(...a) }));

vi.mock("../buildAsanaIssueBody", () => ({
  buildAsanaIssueBody: () => ({ body: "BODY_MD", attached: [] }),
}));
vi.mock("../markdownToAsanaHtml", () => ({
  markdownToAsanaHtml: (md: string) => `<body>${md}</body>`,
}));
vi.mock("../buildAiMetaAttachment", () => ({
  buildAiMetaAttachment: () => ({
    filename: "ai-meta.json",
    dataUrl: "data:application/json,{}",
  }),
}));
vi.mock("@/sidepanel/capture", () => ({
  loadImage: vi.fn().mockResolvedValue({ naturalWidth: 800, naturalHeight: 600 }),
}));

import { submitToAsana } from "../submitToAsana";
import type { MarkdownContext } from "../buildIssueMarkdown";

function makeCtx(overrides: Partial<MarkdownContext> = {}): MarkdownContext {
  return {
    captureMode: "element",
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
    ...overrides,
  };
}

const TASK = { gid: "TASK_GID", permalinkUrl: "https://app.asana.com/0/0/TASK_GID" };

beforeEach(() => {
  sendBg.mockReset();
});

describe("submitToAsana", () => {
  it("createTask(submitIssue) 먼저 → uploadFiles(parent=taskGid) 순서, 결과는 { key:gid, url:permalink }", async () => {
    const order: string[] = [];
    sendBg.mockImplementation(async (msg: { type: string }) => {
      order.push(msg.type);
      if (msg.type === "asana.submitIssue") return TASK;
      if (msg.type === "asana.uploadFiles")
        return [{ filename: "screenshot.png", gid: "att1" }];
      return undefined;
    });

    const res = await submitToAsana({
      ctx: makeCtx(),
      workspaceGid: "W",
      projectGid: "P",
      images: [{ filename: "screenshot.png", dataUrl: "data:," }],
    });

    // 이미지 업로드 후 GID로 본문 갱신 → create → upload → update 순.
    expect(order).toEqual([
      "asana.submitIssue",
      "asana.uploadFiles",
      "asana.updateTaskNotes",
    ]);
    expect(res).toEqual({ key: "TASK_GID", url: TASK.permalinkUrl });

    const submitCall = sendBg.mock.calls.find(
      ([m]) => m.type === "asana.submitIssue",
    )![0];
    expect(submitCall.payload.workspaceGid).toBe("W");
    expect(submitCall.payload.htmlNotes).toContain("BODY_MD");

    const uploadCall = sendBg.mock.calls.find(
      ([m]) => m.type === "asana.uploadFiles",
    )![0];
    expect(uploadCall.parent).toBe("TASK_GID");

    const updateCall = sendBg.mock.calls.find(
      ([m]) => m.type === "asana.updateTaskNotes",
    )![0];
    expect(updateCall.taskGid).toBe("TASK_GID");
    expect(updateCall.htmlNotes).toContain("BODY_MD");
  });

  it("이미지 GID가 없으면(영상/로그만) updateTaskNotes 미호출", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "asana.submitIssue") return TASK;
      if (msg.type === "asana.uploadFiles")
        return [{ filename: "recording.mp4", gid: "v1" }];
      return undefined;
    });

    await submitToAsana({
      ctx: makeCtx({ captureMode: "video" }),
      workspaceGid: "W",
      video: { filename: "recording.mp4", dataUrl: "data:," },
    });

    expect(
      sendBg.mock.calls.some(([m]) => m.type === "asana.updateTaskNotes"),
    ).toBe(false);
  });

  it("createTask 실패 시 attachment 미시도 + reject", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "asana.submitIssue") throw new Error("create failed");
      return undefined;
    });

    await expect(
      submitToAsana({
        ctx: makeCtx(),
        workspaceGid: "W",
        images: [{ filename: "a.png", dataUrl: "data:," }],
      }),
    ).rejects.toThrow();

    expect(
      sendBg.mock.calls.some(([m]) => m.type === "asana.uploadFiles"),
    ).toBe(false);
  });

  it("per-file 격리 — 개별 첨부 실패(gid null)여도 task는 보존되고 결과 반환", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "asana.submitIssue") return TASK;
      if (msg.type === "asana.uploadFiles")
        return [
          { filename: "a.png", gid: "att" },
          { filename: "b.png", gid: null },
        ];
      return undefined;
    });

    const res = await submitToAsana({
      ctx: makeCtx(),
      workspaceGid: "W",
      images: [
        { filename: "a.png", dataUrl: "data:," },
        { filename: "b.png", dataUrl: "data:," },
      ],
    });

    expect(res.key).toBe("TASK_GID");
    expect(res.url).toBe(TASK.permalinkUrl);
  });
});
