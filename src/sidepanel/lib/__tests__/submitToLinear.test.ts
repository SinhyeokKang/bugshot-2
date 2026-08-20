import { beforeEach, describe, expect, it, vi } from "vitest";

const sendBg = vi.fn();
vi.mock("@/lib/bg-client", () => ({ sendBg: (...a: unknown[]) => sendBg(...a) }));

// 본문은 테스트별로 바꿀 수 있다 — 2차 갱신(updateIssueDescription)은 본문에 평문
// "logs.html" 토큰이 있어야만(injectLogsMarkdownLink가 실제로 바꿔야만) 호출된다.
let linearBody = "BODY";
vi.mock("../buildLinearIssueBody", () => ({
  buildLinearIssueBody: () => ({ body: linearBody }),
}));
const replaceInlineRefs = vi.fn((s: string, _map?: Map<string, string>) => s);
vi.mock("../resolveInlineImages", () => ({
  replaceInlineRefs: (s: string, map: Map<string, string>) => replaceInlineRefs(s, map),
}));
vi.mock("@/lib/inject-issue-url", () => ({
  injectIssueUrl: async (dataUrl: string) => dataUrl,
}));

import { submitToLinear } from "../submitToLinear";
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

const ISSUE = { id: "ISSUE_ID", identifier: "ENG-1", url: "https://linear.app/x/issue/ENG-1" };

beforeEach(() => {
  sendBg.mockReset();
  replaceInlineRefs.mockClear();
  linearBody = "BODY";
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

// 본문 붙여넣기 이미지는 업로드 후 assetUrl로 `inline:refId`를 치환한다.
// bespoke 업로드 경로를 가진 어댑터(notion/slack/linear/clickup) 중 linear가 미커버였다.
describe("submitToLinear — 인라인 이미지", () => {
  function mockOk() {
    sendBg.mockImplementation(async (msg: { type: string; filename?: string }) => {
      if (msg.type === "linear.submitIssue") return ISSUE;
      if (msg.type === "linear.uploadFile") return { assetUrl: `asset-${msg.filename}` };
      if (msg.type === "linear.createAttachment") return { ok: true };
      return undefined;
    });
  }

  it("inline-{refId}.webp 이름으로 업로드한다", async () => {
    mockOk();
    await submitToLinear({
      ctx: makeCtx(),
      teamId: "T",
      inlineImages: [{ refId: "r1", dataUrl: "data:IMG1" }],
    } as never);
    expect(sendBg).toHaveBeenCalledWith(
      expect.objectContaining({ type: "linear.uploadFile", filename: "inline-r1.webp" }),
    );
  });

  it("업로드한 assetUrl로 본문의 ref를 치환한다", async () => {
    mockOk();
    await submitToLinear({
      ctx: makeCtx(),
      teamId: "T",
      inlineImages: [{ refId: "r1", dataUrl: "data:IMG1" }],
    } as never);
    const map = replaceInlineRefs.mock.calls[0][1]!;
    expect(map.get("r1")).toBe("asset-inline-r1.webp");
  });

  // assetUrl이 안 오면 치환할 게 없다 — 깨진 ref로 본문이 나가지 않도록 map에 넣지 않는다.
  it("assetUrl이 없으면 치환 맵에 넣지 않는다", async () => {
    sendBg.mockImplementation(async (msg: { type: string; filename?: string }) => {
      if (msg.type === "linear.submitIssue") return ISSUE;
      if (msg.type === "linear.uploadFile") return { assetUrl: null };
      if (msg.type === "linear.createAttachment") return { ok: true };
      return undefined;
    });
    await submitToLinear({
      ctx: makeCtx(),
      teamId: "T",
      inlineImages: [{ refId: "r1", dataUrl: "data:IMG1" }],
    } as never);
    expect(replaceInlineRefs).not.toHaveBeenCalled();
  });

  it("인라인 이미지가 없으면 업로드하지 않는다", async () => {
    mockOk();
    await submitToLinear({ ctx: makeCtx(), teamId: "T" } as never);
    const uploads = sendBg.mock.calls.filter((c) => c[0].type === "linear.uploadFile");
    expect(uploads).toHaveLength(0);
  });
});

// ── 2차 본문 갱신 실패 시 graceful degradation — 전수 표 (linear 행) ─────────────
// 표 전체 설명·플랫폼 목록·정직성 주의는 submitToClickup.test.ts의 동명 블록 참조.
// linear 관용구: `.catch(() => null)` (submitToLinear.ts:140-144) — try/catch가 아니라
// 프로미스 체인에 붙어 있어, 리팩터로 await를 앞으로 빼면 격리가 조용히 사라진다.
describe("submitToLinear — 2차 본문 갱신 실패 (전수 표 linear 행)", () => {
  it("updateIssueDescription이 reject해도 제출은 성공하고 이슈·첨부가 보존된다", async () => {
    linearBody = "로그는 logs.html 참조";
    sendBg.mockImplementation(async (msg: { type: string; filename?: string }) => {
      if (msg.type === "linear.submitIssue") return ISSUE;
      if (msg.type === "linear.uploadFile") return { assetUrl: `asset-${msg.filename}` };
      if (msg.type === "linear.createAttachment") return { ok: true };
      if (msg.type === "linear.updateIssueDescription") throw new Error("mutation failed");
      return undefined;
    });

    const res = await submitToLinear({
      ctx: makeCtx(),
      teamId: "T",
      logs: [{ filename: "logs.html", dataUrl: "data:LOGS" }],
      attachments: [
        { filename: "user-1.pdf", dataUrl: "data:A", displayName: "보고서.pdf" },
      ],
    });

    // ①② 완전 성공 경로와 동일한 반환값.
    expect(res).toEqual({ key: "ENG-1", url: ISSUE.url, logsDropped: false });
    // 2차 갱신을 시도는 했다(격리가 호출 자체를 없앤 게 아니다).
    const types = sendBg.mock.calls.map(([m]) => m.type);
    expect(types).toContain("linear.updateIssueDescription");
    // ③ 첨부 보존 — 로그·사용자 첨부가 모두 attachment로 등록된다.
    const titles = sendBg.mock.calls
      .filter(([m]) => m.type === "linear.createAttachment")
      .map(([m]) => m.title);
    expect(titles).toEqual(["logs.html", "보고서.pdf"]);
  });

  it("본문에 평문 logs.html 토큰이 없으면 2차 갱신 자체를 건너뛴다", async () => {
    sendBg.mockImplementation(async (msg: { type: string; filename?: string }) => {
      if (msg.type === "linear.submitIssue") return ISSUE;
      if (msg.type === "linear.uploadFile") return { assetUrl: `asset-${msg.filename}` };
      if (msg.type === "linear.createAttachment") return { ok: true };
      return undefined;
    });

    await submitToLinear({
      ctx: makeCtx(),
      teamId: "T",
      logs: [{ filename: "logs.html", dataUrl: "data:LOGS" }],
    });

    expect(
      sendBg.mock.calls.some(([m]) => m.type === "linear.updateIssueDescription"),
    ).toBe(false);
  });

  it("2차 갱신 성공 시 description의 평문 logs.html이 첨부 링크로 바뀐다", async () => {
    linearBody = "로그는 logs.html 참조";
    sendBg.mockImplementation(async (msg: { type: string; filename?: string }) => {
      if (msg.type === "linear.submitIssue") return ISSUE;
      if (msg.type === "linear.uploadFile") return { assetUrl: `asset-${msg.filename}` };
      if (msg.type === "linear.createAttachment") return { ok: true };
      return undefined;
    });

    await submitToLinear({
      ctx: makeCtx(),
      teamId: "T",
      logs: [{ filename: "logs.html", dataUrl: "data:LOGS" }],
    });

    const update = sendBg.mock.calls.find(
      ([m]) => m.type === "linear.updateIssueDescription",
    )![0];
    expect(update.issueId).toBe("ISSUE_ID");
    expect(update.description).toBe("로그는 [logs.html](asset-logs.html) 참조");
  });
});

describe("submitToLinear 사용자 첨부", () => {
  it("표시명(displayName)으로 등록하고, 업로드 실패분은 격리되어 제출을 깨지 않는다", async () => {
    sendBg.mockImplementation(async (msg: { type: string; filename?: string }) => {
      if (msg.type === "linear.submitIssue") return ISSUE;
      if (msg.type === "linear.uploadFile") {
        if (msg.filename === "user-2.pdf") throw new Error("too large");
        return { assetUrl: `asset-${msg.filename}` };
      }
      if (msg.type === "linear.createAttachment") return { ok: true };
      return undefined;
    });

    const res = await submitToLinear({
      ctx: makeCtx(),
      teamId: "T",
      attachments: [
        { filename: "user-1.pdf", dataUrl: "data:A", displayName: "보고서.pdf" },
        { filename: "user-2.pdf", dataUrl: "data:B", displayName: "실패.pdf" },
        { filename: "user-3.pdf", dataUrl: "data:C" },
      ],
    });

    expect(res.key).toBe("ENG-1");
    const titles = sendBg.mock.calls
      .filter(([m]) => m.type === "linear.createAttachment")
      .map(([m]) => m.title);
    // displayName 우선, 없으면 filename 폴백. 업로드 실패분(실패.pdf)은 빠진다.
    expect(titles).toEqual(["보고서.pdf", "user-3.pdf"]);
  });
});
