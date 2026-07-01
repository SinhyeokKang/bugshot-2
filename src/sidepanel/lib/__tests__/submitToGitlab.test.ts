import { beforeEach, describe, expect, it, vi } from "vitest";

const sendBg = vi.fn();
vi.mock("@/types/messages", () => ({ sendBg: (...a: unknown[]) => sendBg(...a) }));

vi.mock("../buildGitlabIssueBody", () => ({
  buildGitlabIssueBody: () => ({ body: "see OLD_URL in logs" }),
}));
vi.mock("../resolveInlineImages", () => ({
  replaceInlineRefs: (s: string) => s,
}));
const injectIssueUrl = vi.fn();
vi.mock("@/lib/inject-issue-url", () => ({
  injectIssueUrl: (...a: unknown[]) => injectIssueUrl(...a),
}));

import { submitToGitlab } from "../submitToGitlab";
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

const ISSUE = { iid: 42, url: "https://gitlab.com/p/-/issues/42" };

beforeEach(() => {
  sendBg.mockReset();
  injectIssueUrl.mockReset();
});

describe("submitToGitlab 역링크 보강", () => {
  it("생성 후 logs.html을 이슈 URL 주입해 재업로드 + description의 URL 교체", async () => {
    let uploadCount = 0;
    sendBg.mockImplementation(
      async (msg: { type: string; files?: Array<{ filename: string }> }) => {
        if (msg.type === "gitlab.uploadFiles") {
          uploadCount += 1;
          if (uploadCount === 1)
            return [{ filename: "logs.html", url: "OLD_URL" }];
          return [{ filename: "logs.html", url: "NEW_URL" }];
        }
        if (msg.type === "gitlab.submitIssue") return ISSUE;
        return undefined;
      },
    );
    injectIssueUrl.mockResolvedValue("data:LOGSHTML+url");

    const res = await submitToGitlab({
      ctx: makeCtx(),
      projectId: 7,
      logs: [{ filename: "logs.html", dataUrl: "data:LOGSHTML" }],
    });

    // 순서: 업로드 → 생성 → 재업로드 → description 갱신
    const types = sendBg.mock.calls.map(([m]) => m.type);
    expect(types).toEqual([
      "gitlab.uploadFiles",
      "gitlab.submitIssue",
      "gitlab.uploadFiles",
      "gitlab.updateIssueDescription",
    ]);

    // injectIssueUrl은 원본 logs.html dataUrl + 이슈 URL + #iid로 호출
    expect(injectIssueUrl).toHaveBeenCalledWith("data:LOGSHTML", ISSUE.url, "#42");

    // description의 OLD_URL이 NEW_URL로 치환
    const updateCall = sendBg.mock.calls.find(
      ([m]) => m.type === "gitlab.updateIssueDescription",
    )![0];
    expect(updateCall.description).toBe("see NEW_URL in logs");
    expect(updateCall.iid).toBe(42);

    expect(res).toEqual({ key: "#42", url: ISSUE.url, logsDropped: false });
  });

  it("보강(주입/재업로드) 실패는 격리 — 이슈는 생성되고 결과 반환", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "gitlab.uploadFiles")
        return [{ filename: "logs.html", url: "OLD_URL" }];
      if (msg.type === "gitlab.submitIssue") return ISSUE;
      return undefined;
    });
    injectIssueUrl.mockRejectedValue(new Error("inject failed"));

    const res = await submitToGitlab({
      ctx: makeCtx(),
      projectId: 7,
      logs: [{ filename: "logs.html", dataUrl: "data:LOGSHTML" }],
    });

    expect(
      sendBg.mock.calls.some(
        ([m]) => m.type === "gitlab.updateIssueDescription",
      ),
    ).toBe(false);
    expect(res).toEqual({ key: "#42", url: ISSUE.url, logsDropped: false });
  });
});

describe("submitToGitlab requireMediaUpload (승격 보호)", () => {
  function submitCallCount(): number {
    return sendBg.mock.calls.filter(
      (c) => (c[0] as { type: string }).type === "gitlab.submitIssue",
    ).length;
  }

  it("이미지 업로드가 url:null이면 throw하고 submitIssue를 호출하지 않는다", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "gitlab.uploadFiles")
        return [{ filename: "shot.webp", url: null }];
      if (msg.type === "gitlab.submitIssue") return ISSUE;
      return undefined;
    });

    await expect(
      submitToGitlab({
        ctx: makeCtx(),
        projectId: 7,
        images: [{ filename: "shot.webp", dataUrl: "data:IMG" }],
        requireMediaUpload: true,
      }),
    ).rejects.toThrow();

    expect(submitCallCount()).toBe(0);
  });

  it("모든 미디어 업로드 성공이면 정상 등록한다", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "gitlab.uploadFiles")
        return [{ filename: "shot.webp", url: "IMG_URL" }];
      if (msg.type === "gitlab.submitIssue") return ISSUE;
      return undefined;
    });

    const res = await submitToGitlab({
      ctx: makeCtx(),
      projectId: 7,
      images: [{ filename: "shot.webp", dataUrl: "data:IMG" }],
      requireMediaUpload: true,
    });

    expect(res.key).toBe("#42");
    expect(submitCallCount()).toBe(1);
  });

  it("미디어는 성공하고 logs만 실패하면 throw하지 않는다(로그는 best-effort)", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "gitlab.uploadFiles")
        return [
          { filename: "shot.webp", url: "IMG_URL" },
          { filename: "logs.html", url: null },
        ];
      if (msg.type === "gitlab.submitIssue") return ISSUE;
      return undefined;
    });

    const res = await submitToGitlab({
      ctx: makeCtx(),
      projectId: 7,
      images: [{ filename: "shot.webp", dataUrl: "data:IMG" }],
      logs: [{ filename: "logs.html", dataUrl: "data:LOGS" }],
      requireMediaUpload: true,
    });

    expect(res.logsDropped).toBe(true);
    expect(submitCallCount()).toBe(1);
  });

  it("requireMediaUpload 미지정(일반 제출)이면 이미지 실패해도 throw하지 않는다", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "gitlab.uploadFiles")
        return [{ filename: "shot.webp", url: null }];
      if (msg.type === "gitlab.submitIssue") return ISSUE;
      return undefined;
    });

    const res = await submitToGitlab({
      ctx: makeCtx(),
      projectId: 7,
      images: [{ filename: "shot.webp", dataUrl: "data:IMG" }],
    });

    expect(res.key).toBe("#42");
    expect(submitCallCount()).toBe(1);
  });
});

describe("submitToGitlab logsDropped", () => {
  it("logs.html 업로드가 null(용량 초과)이면 logsDropped: true", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "gitlab.uploadFiles")
        return [{ filename: "logs.html", url: null }];
      if (msg.type === "gitlab.submitIssue") return ISSUE;
      return undefined;
    });

    const res = await submitToGitlab({
      ctx: makeCtx(),
      projectId: 7,
      logs: [{ filename: "logs.html", dataUrl: "data:LOGSHTML" }],
    });

    expect(res.logsDropped).toBe(true);
    // 업로드 실패 시 역링크 보강(재업로드)도 시도하지 않음.
    expect(
      sendBg.mock.calls.filter(([m]) => m.type === "gitlab.uploadFiles").length,
    ).toBe(1);
  });

  it("logs.html 업로드 성공이면 logsDropped: false", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "gitlab.uploadFiles")
        return [{ filename: "logs.html", url: "OK_URL" }];
      if (msg.type === "gitlab.submitIssue") return ISSUE;
      return undefined;
    });
    injectIssueUrl.mockResolvedValue("data:aug");

    const res = await submitToGitlab({
      ctx: makeCtx(),
      projectId: 7,
      logs: [{ filename: "logs.html", dataUrl: "data:LOGSHTML" }],
    });

    expect(res.logsDropped).toBe(false);
  });
});
