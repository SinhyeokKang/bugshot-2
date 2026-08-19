import { beforeEach, describe, expect, it, vi } from "vitest";

const sendBg = vi.fn();
vi.mock("@/lib/bg-client", () => ({ sendBg: (...a: unknown[]) => sendBg(...a) }));

vi.mock("../buildGithubIssueBody", () => ({
  buildGithubIssueBody: () => ({ body: "BODY" }),
}));
vi.mock("../resolveInlineImages", () => ({
  replaceInlineRefs: (s: string) => s,
}));

import { someUploadMissing } from "../prepareUpload";
import { submitToGithub } from "../submitToGithub";
import type { MarkdownContext } from "../buildIssueMarkdown";

function makeCtx(): MarkdownContext {
  return {
    bodyLocale: "ko",
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
        return [{ ok: false, filename: "logs.html" }];
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
        return [{ ok: true, filename: "logs.html", href: "LOGS_HREF" }];
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

describe("someUploadMissing", () => {
  it("기대 파일이 모두 href 있으면 false", () => {
    const map = new Map<string, string | null>([
      ["a.webp", "HREF_A"],
      ["b.webp", "HREF_B"],
    ]);
    expect(someUploadMissing(["a.webp", "b.webp"], map)).toBe(false);
  });

  it("하나라도 href null이면 true", () => {
    const map = new Map<string, string | null>([
      ["a.webp", "HREF_A"],
      ["b.webp", null],
    ]);
    expect(someUploadMissing(["a.webp", "b.webp"], map)).toBe(true);
  });

  it("맵에 아예 없는 파일이면 true", () => {
    const map = new Map<string, string | null>([["a.webp", "HREF_A"]]);
    expect(someUploadMissing(["a.webp", "missing.webp"], map)).toBe(true);
  });

  it("빈 목록이면 false", () => {
    expect(someUploadMissing([], new Map())).toBe(false);
  });
});

describe("submitToGithub requireMediaUpload (승격 보호)", () => {
  function submitCallCount(): number {
    return sendBg.mock.calls.filter(
      (c) => (c[0] as { type: string }).type === "github.submitIssue",
    ).length;
  }

  it("이미지 업로드가 href:null이면 throw하고 submitIssue를 호출하지 않는다", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "github.uploadFiles")
        return [{ ok: false, filename: "shot.webp" }];
      if (msg.type === "github.submitIssue") return ISSUE;
      return undefined;
    });

    await expect(
      submitToGithub({
        ctx: makeCtx(),
        owner: "o",
        repo: "r",
        images: [{ filename: "shot.webp", dataUrl: "data:IMG" }],
        requireMediaUpload: true,
      }),
    ).rejects.toThrow();

    expect(submitCallCount()).toBe(0);
  });

  it("모든 미디어 업로드 성공이면 정상 등록한다", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "github.uploadFiles")
        return [{ ok: true, filename: "shot.webp", href: "IMG_HREF" }];
      if (msg.type === "github.submitIssue") return ISSUE;
      return undefined;
    });

    const res = await submitToGithub({
      ctx: makeCtx(),
      owner: "o",
      repo: "r",
      images: [{ filename: "shot.webp", dataUrl: "data:IMG" }],
      requireMediaUpload: true,
    });

    expect(res.key).toBe("#7");
    expect(submitCallCount()).toBe(1);
  });

  it("미디어는 성공하고 logs만 실패하면 throw하지 않는다(로그는 best-effort)", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "github.uploadFiles")
        return [
          { ok: true, filename: "shot.webp", href: "IMG_HREF" },
          { ok: false, filename: "logs.html" },
        ];
      if (msg.type === "github.submitIssue") return ISSUE;
      return undefined;
    });

    const res = await submitToGithub({
      ctx: makeCtx(),
      owner: "o",
      repo: "r",
      images: [{ filename: "shot.webp", dataUrl: "data:IMG" }],
      logs: [{ filename: "logs.html", dataUrl: "data:LOGS" }],
      requireMediaUpload: true,
    });

    expect(res.logsDropped).toBe(true);
    expect(submitCallCount()).toBe(1);
  });

  it("requireMediaUpload 미지정(일반 제출)이면 이미지 실패해도 throw하지 않는다", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "github.uploadFiles")
        return [{ ok: false, filename: "shot.webp" }];
      if (msg.type === "github.submitIssue") return ISSUE;
      return undefined;
    });

    const res = await submitToGithub({
      ctx: makeCtx(),
      owner: "o",
      repo: "r",
      images: [{ filename: "shot.webp", dataUrl: "data:IMG" }],
    });

    expect(res.key).toBe("#7");
    expect(submitCallCount()).toBe(1);
  });
});


// 업로드 결과가 판별자 없이 nullable 필드 truthiness로 성공/실패를 갈랐다. 네 플랫폼이
// 필드명도 제각각(href/url/gid)이라 소비처가 조용히 틀릴 수 있다 — { ok } 판별자로 통일한다.
// github은 이미 href를 직접 읽어 이 케이스가 지금도 green이다(핸들러 반환 형태 변경의
// 회귀 가드로 둔다 — ok:false에 href를 실어 보내는 실수를 잡는다).
describe("submitToGithub 업로드 판별자", () => {
  it("판별자 형태에서 1건 실패해도 나머지가 첨부되고 실패분만 실패로 판정된다", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "github.uploadFiles")
        return [
          { ok: true, filename: "shot.webp", href: "IMG_HREF" },
          { ok: false, filename: "logs.html" },
        ];
      if (msg.type === "github.submitIssue") return ISSUE;
      return undefined;
    });

    const res = await submitToGithub({
      ctx: makeCtx(),
      owner: "o",
      repo: "r",
      images: [{ filename: "shot.webp", dataUrl: "data:IMG" }],
      logs: [{ filename: "logs.html", dataUrl: "data:LOGS" }],
    });

    expect(res.logsDropped).toBe(true);
  });

  it("판별자 형태에서 전부 성공이면 logsDropped: false", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "github.uploadFiles")
        return [{ ok: true, filename: "logs.html", href: "LOGS_HREF" }];
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
