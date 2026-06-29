import { beforeEach, describe, expect, it, vi } from "vitest";

const sendBg = vi.fn();
vi.mock("@/types/messages", () => ({ sendBg: (...a: unknown[]) => sendBg(...a) }));

// url이 채워지면 다른 본문을 반환 → 2차 갱신(updateTaskMarkdown) 트리거 검증용.
const buildBody = vi.fn(
  (input: { images?: Array<{ url?: string }>; cc?: string[] }) => ({
    body: input.images?.[0]?.url ? "WITH_URL" : "NO_URL",
    attached: [],
  }),
);
vi.mock("../buildClickupIssueBody", () => ({
  buildClickupIssueBody: (...a: unknown[]) => buildBody(...(a as [never])),
}));
vi.mock("../resolveInlineImages", () => ({
  replaceInlineRefs: (s: string) => s,
}));
const injectIssueUrl = vi.fn();
vi.mock("@/lib/inject-issue-url", () => ({
  injectIssueUrl: (...a: unknown[]) => injectIssueUrl(...a),
}));

import { submitToClickup } from "../submitToClickup";
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

const TASK = { id: "t1", url: "https://app.clickup.com/t/t1" };

beforeEach(() => {
  sendBg.mockReset();
  injectIssueUrl.mockReset();
  buildBody.mockClear();
});

describe("submitToClickup CC 멘션", () => {
  it("CC는 본문 빌더에 id가 아닌 이름으로 넘어간다 (name 없으면 id 폴백)", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) =>
      msg.type === "clickup.submitIssue" ? TASK : undefined,
    );

    await submitToClickup({
      ctx: makeCtx(),
      listId: "l1",
      cc: [{ id: "1", name: "Alice" }, { id: "2" }],
    });

    expect(buildBody.mock.calls[0][0]).toMatchObject({ cc: ["Alice", "2"] });
  });
});

describe("submitToClickup 제출 순서", () => {
  it("create(submitIssue) → upload → updateTaskMarkdown 순서로 호출", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "clickup.submitIssue") return TASK;
      if (msg.type === "clickup.uploadFile")
        return [{ filename: "screenshot.png", url: "https://att/screenshot.png" }];
      return undefined;
    });

    const res = await submitToClickup({
      ctx: makeCtx(),
      images: [{ filename: "screenshot.png", dataUrl: "data:IMG" }],
      listId: "l1",
    });

    const types = sendBg.mock.calls.map(([m]) => m.type);
    expect(types).toEqual([
      "clickup.submitIssue",
      "clickup.uploadFile",
      "clickup.updateTaskMarkdown",
    ]);

    // create는 url 없는 본문, update는 url 채워진 본문.
    const create = sendBg.mock.calls.find(([m]) => m.type === "clickup.submitIssue")![0];
    expect(create.payload.markdownContent).toBe("NO_URL");
    expect(create.payload.listId).toBe("l1");
    const update = sendBg.mock.calls.find(([m]) => m.type === "clickup.updateTaskMarkdown")![0];
    expect(update.markdownContent).toBe("WITH_URL");

    expect(res).toEqual({ key: "t1", url: TASK.url, logsDropped: false });
  });

  it("첨부가 없으면 업로드·2차 갱신을 건너뛴다", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "clickup.submitIssue") return TASK;
      return undefined;
    });

    await submitToClickup({ ctx: makeCtx(), listId: "l1" });

    expect(sendBg.mock.calls.map(([m]) => m.type)).toEqual(["clickup.submitIssue"]);
  });
});

describe("submitToClickup logsDropped", () => {
  it("logs.html 업로드가 null이면 logsDropped: true", async () => {
    injectIssueUrl.mockResolvedValue("data:aug");
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "clickup.submitIssue") return TASK;
      if (msg.type === "clickup.uploadFile")
        return [{ filename: "logs.html", url: null }];
      return undefined;
    });

    const res = await submitToClickup({
      ctx: makeCtx(),
      logs: [{ filename: "logs.html", dataUrl: "data:LOGS" }],
      listId: "l1",
    });

    expect(res.logsDropped).toBe(true);
  });
});
