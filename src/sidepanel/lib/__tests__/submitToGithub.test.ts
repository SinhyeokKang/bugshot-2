import { beforeEach, describe, expect, it, vi } from "vitest";

const sendBg = vi.fn();
vi.mock("@/types/messages", () => ({ sendBg: (...a: unknown[]) => sendBg(...a) }));

vi.mock("../buildGithubIssueBody", () => ({
  buildGithubIssueBody: () => ({ body: "BODY" }),
}));
vi.mock("../buildAiMetaAttachment", () => ({
  buildAiMetaAttachment: () => ({ filename: "bugshot.md", dataUrl: "data:md" }),
}));
vi.mock("../resolveInlineImages", () => ({
  replaceInlineRefs: (s: string) => s,
}));

import { submitToGithub } from "../submitToGithub";
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

const ISSUE = { number: 7, url: "https://github.com/o/r/issues/7" };

beforeEach(() => {
  sendBg.mockReset();
});

describe("submitToGithub logsDropped", () => {
  it("logs.html 업로드가 href:null(영상/용량 초과)이면 logsDropped: true", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "github.uploadFiles")
        return [
          { filename: "logs.html", href: null },
          { filename: "bugshot.md", href: "MD_HREF" },
        ];
      if (msg.type === "github.submitIssue") return ISSUE;
      return undefined;
    });

    const res = await submitToGithub({
      ctx: makeCtx(),
      owner: "o",
      repo: "r",
      logs: [{ filename: "logs.html", dataUrl: "data:LOGS" }],
    });

    expect(res).toEqual({ key: "#7", url: ISSUE.url, logsDropped: true });
  });

  it("logs.html 업로드 성공이면 logsDropped: false", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "github.uploadFiles")
        return [{ filename: "logs.html", href: "LOGS_HREF" }];
      if (msg.type === "github.submitIssue") return ISSUE;
      return undefined;
    });

    const res = await submitToGithub({
      ctx: makeCtx(),
      owner: "o",
      repo: "r",
      logs: [{ filename: "logs.html", dataUrl: "data:LOGS" }],
    });

    expect(res.logsDropped).toBe(false);
  });
});
