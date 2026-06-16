import { beforeEach, describe, expect, it, vi } from "vitest";

const sendBg = vi.fn();
vi.mock("@/types/messages", () => ({ sendBg: (...a: unknown[]) => sendBg(...a) }));

vi.mock("../buildLinearIssueBody", () => ({
  buildLinearIssueBody: () => ({ body: "BODY" }),
}));
vi.mock("../resolveInlineImages", () => ({
  replaceInlineRefs: (s: string) => s,
}));
vi.mock("@/lib/inject-issue-url", () => ({
  injectIssueUrl: async (dataUrl: string) => dataUrl,
}));

import { submitToLinear } from "../submitToLinear";
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

const ISSUE = { id: "ISSUE_ID", identifier: "ENG-1", url: "https://linear.app/x/issue/ENG-1" };

beforeEach(() => {
  sendBg.mockReset();
});

describe("submitToLinear logsDropped", () => {
  it("logs.html 업로드 실패 시 logsDropped: true (이슈는 생성)", async () => {
    sendBg.mockImplementation(async (msg: { type: string; filename?: string }) => {
      if (msg.type === "linear.submitIssue") return ISSUE;
      if (msg.type === "linear.uploadFile") {
        if (msg.filename === "logs.html") throw new Error("too large");
        return { assetUrl: `asset-${msg.filename}` };
      }
      if (msg.type === "linear.createAttachment") return { ok: true };
      return undefined;
    });

    const res = await submitToLinear({
      ctx: makeCtx(),
      teamId: "T",
      logs: [{ filename: "logs.html", dataUrl: "data:LOGS" }],
    });

    expect(res).toEqual({
      key: "ENG-1",
      url: ISSUE.url,
      logsDropped: true,
    });
  });

  it("logs.html 업로드 성공이면 logsDropped: false", async () => {
    sendBg.mockImplementation(async (msg: { type: string; filename?: string }) => {
      if (msg.type === "linear.submitIssue") return ISSUE;
      if (msg.type === "linear.uploadFile") return { assetUrl: `asset-${msg.filename}` };
      if (msg.type === "linear.createAttachment") return { ok: true };
      return undefined;
    });

    const res = await submitToLinear({
      ctx: makeCtx(),
      teamId: "T",
      logs: [{ filename: "logs.html", dataUrl: "data:LOGS" }],
    });

    expect(res.logsDropped).toBe(false);
  });

  it("이미지 업로드 실패는 격리 대상 아님 — 전체 reject", async () => {
    sendBg.mockImplementation(async (msg: { type: string; filename?: string }) => {
      if (msg.type === "linear.uploadFile") {
        if (msg.filename === "screenshot.webp") throw new Error("img fail");
        return { assetUrl: `asset-${msg.filename}` };
      }
      if (msg.type === "linear.submitIssue") return ISSUE;
      return undefined;
    });

    await expect(
      submitToLinear({
        ctx: makeCtx(),
        teamId: "T",
        images: [{ filename: "screenshot.webp", dataUrl: "data:IMG" }],
      }),
    ).rejects.toThrow();
  });
});

describe("submitToLinear attachment 격리", () => {
  it("createAttachment 실패해도 제출은 성공으로 보고된다 (이슈는 이미 생성)", async () => {
    sendBg.mockImplementation(async (msg: { type: string; filename?: string }) => {
      if (msg.type === "linear.submitIssue") return ISSUE;
      if (msg.type === "linear.uploadFile") return { assetUrl: `asset-${msg.filename}` };
      if (msg.type === "linear.createAttachment") throw new Error("attach fail");
      return undefined;
    });

    const res = await submitToLinear({
      ctx: makeCtx(),
      teamId: "T",
      logs: [{ filename: "logs.html", dataUrl: "data:LOGS" }],
    });

    expect(res.key).toBe("ENG-1");
  });
});
