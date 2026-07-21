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
const replaceInlineRefs = vi.fn((s: string, _map?: Map<string, string>) => s);
vi.mock("../resolveInlineImages", () => ({
  replaceInlineRefs: (s: string, map: Map<string, string>) => replaceInlineRefs(s, map),
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
  replaceInlineRefs.mockClear();
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

// bespoke 업로드 경로를 가진 어댑터(notion/slack/linear/clickup) 중 clickup이 미커버였다.
describe("submitToClickup — 인라인 이미지", () => {
  const TASK = { id: "T1", url: "https://app.clickup.com/t/T1" };

  function mockUpload(results: Array<{ filename: string; url: string | null }>) {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "clickup.submitIssue") return TASK;
      if (msg.type === "clickup.uploadFile") return results;
      return undefined;
    });
  }

  it("inline-{refId}.webp 이름으로 업로드 목록에 넣는다", async () => {
    mockUpload([{ filename: "inline-r1.webp", url: "https://att/r1.webp" }]);
    await submitToClickup({
      ctx: makeCtx(),
      listId: "L",
      inlineImages: [{ refId: "r1", dataUrl: "data:IMG1" }],
    } as never);
    const upload = sendBg.mock.calls.find((c) => c[0].type === "clickup.uploadFile")![0];
    expect(upload.files.map((f: { filename: string }) => f.filename)).toContain("inline-r1.webp");
  });

  it("업로드 URL로 본문의 ref를 치환한다", async () => {
    mockUpload([{ filename: "inline-r1.webp", url: "https://att/r1.webp" }]);
    await submitToClickup({
      ctx: makeCtx(),
      listId: "L",
      inlineImages: [{ refId: "r1", dataUrl: "data:IMG1" }],
    } as never);
    const map = replaceInlineRefs.mock.calls[0][1]!;
    expect(map.get("r1")).toBe("https://att/r1.webp");
  });

  // url이 null이면 치환할 게 없다 — 깨진 ref로 본문을 갱신하지 않는다.
  it("업로드 url이 null이면 치환하지 않는다", async () => {
    mockUpload([{ filename: "inline-r1.webp", url: null }]);
    await submitToClickup({
      ctx: makeCtx(),
      listId: "L",
      inlineImages: [{ refId: "r1", dataUrl: "data:IMG1" }],
    } as never);
    expect(replaceInlineRefs).not.toHaveBeenCalled();
  });
});
