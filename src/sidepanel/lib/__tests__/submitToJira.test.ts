import { beforeEach, describe, expect, it, vi } from "vitest";

const sendBg = vi.fn();
vi.mock("@/types/messages", () => ({ sendBg: (...a: unknown[]) => sendBg(...a) }));

vi.mock("../buildIssueAdf", () => ({
  buildIssueAdf: () => ({ type: "doc", content: [] }),
}));
// 첨부 치수 보강은 pass-through로 목킹 — 조립 순서·파일명만 검증한다.
vi.mock("../attachmentDimensions", () => ({
  annotateAttachmentDimensions: async (a: unknown[]) => a,
}));

import { submitToJira } from "../submitToJira";
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

const RESULT = { key: "BUG-1", url: "https://x.atlassian.net/browse/BUG-1", logsDropped: false };

beforeEach(() => {
  sendBg.mockReset();
  sendBg.mockResolvedValue(RESULT);
});

function attachmentFilenames(): string[] {
  const arg = sendBg.mock.calls[0][0] as { attachments: { filename: string }[] };
  return arg.attachments.map((a) => a.filename);
}

describe("submitToJira", () => {
  it("결과를 NormalizedSubmitResult로 매핑 (key/url/logsDropped)", async () => {
    sendBg.mockResolvedValue({ ...RESULT, logsDropped: true });
    const res = await submitToJira({
      ctx: makeCtx(),
      projectKey: "P",
      summary: "s",
      issueTypeId: "1",
    });
    expect(res).toEqual({ key: "BUG-1", url: RESULT.url, logsDropped: true });
  });

  it("images/video/logs 순서로 첨부 조립", async () => {
    await submitToJira({
      ctx: makeCtx(),
      projectKey: "P",
      summary: "s",
      issueTypeId: "1",
      images: [{ filename: "before.webp", dataUrl: "d" }],
      video: { filename: "rec.mp4", dataUrl: "d" },
      logs: [{ filename: "logs.html", dataUrl: "d" }],
    });
    expect(attachmentFilenames()).toEqual(["before.webp", "rec.mp4", "logs.html"]);
  });

  it("inline 이미지는 inline-${refId}.webp로 첨부에 합류", async () => {
    await submitToJira({
      ctx: makeCtx(),
      projectKey: "P",
      summary: "s",
      issueTypeId: "1",
      inlineImages: [{ refId: "abc", dataUrl: "data:IMG" }],
    });
    expect(attachmentFilenames()).toContain("inline-abc.webp");
  });

  it("사용자 첨부는 displayName을 파일명으로 사용", async () => {
    await submitToJira({
      ctx: makeCtx(),
      projectKey: "P",
      summary: "s",
      issueTypeId: "1",
      attachments: [{ filename: "raw.bin", dataUrl: "data:X", displayName: "이름.png" }],
    });
    expect(attachmentFilenames()).toContain("이름.png");
  });
});
