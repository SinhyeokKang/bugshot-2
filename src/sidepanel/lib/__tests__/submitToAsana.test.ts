import { beforeEach, describe, expect, it, vi } from "vitest";

const sendBg = vi.fn();
vi.mock("@/types/messages", () => ({ sendBg: (...a: unknown[]) => sendBg(...a) }));

vi.mock("@/i18n", () => ({
  t: (key: string) => key,
  dateBcp47: () => "en-US",
}));
vi.mock("@/store/settings-ui-store", () => ({
  POST_MEDIA_SECTION_IDS: new Set(["expectedResult", "notes"]),
  sectionMdLabelKey: (id: string) => `md.section.${id}`,
}));

vi.mock("../buildAsanaIssueBody", () => ({
  buildAsanaIssueBody: () => ({ body: "BODY_MD", attached: [] }),
}));
const markdownToAsanaHtml = vi.fn(
  (md: string, _refs?: Record<string, unknown>) => `<body>${md}</body>`,
);
vi.mock("../markdownToAsanaHtml", () => ({
  markdownToAsanaHtml: (...a: unknown[]) =>
    markdownToAsanaHtml(...(a as [string, Record<string, unknown>?])),
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
const injectIssueUrl = vi.fn(
  async (dataUrl: string, url: string, key?: string) => `${dataUrl}#${url}#${key}`,
);
vi.mock("@/lib/inject-issue-url", () => ({
  injectIssueUrl: (...a: unknown[]) =>
    injectIssueUrl(...(a as [string, string, string?])),
}));

import { renameStyleElementFilenames, submitToAsana } from "../submitToAsana";
import type { MarkdownContext, StyleElementContext } from "../buildIssueMarkdown";

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
  markdownToAsanaHtml.mockClear();
  injectIssueUrl.mockClear();
});

function styleElement(i: number): StyleElementContext {
  return {
    selector: `#el${i}`,
    tagName: "div",
    classListBefore: [],
    classListAfter: [],
    specifiedStyles: {},
    diffs: [{ prop: "color", asIs: "#000", toBe: "#fff" }],
    beforeFilename: `before-${i}.webp`,
    afterFilename: `after-${i}.webp`,
  };
}

describe("renameStyleElementFilenames", () => {
  it("webp→jpg 리네임 맵을 styleElements의 before/after 파일명에 반영한다", () => {
    const ctx = makeCtx({ styleElements: [styleElement(0), styleElement(1)] });
    const renames = new Map([
      ["before-0.webp", "before-0.jpg"],
      ["after-1.webp", "after-1.jpg"],
    ]);

    const next = renameStyleElementFilenames(ctx, renames);

    expect(next.styleElements?.[0].beforeFilename).toBe("before-0.jpg");
    expect(next.styleElements?.[0].afterFilename).toBe("after-0.webp");
    expect(next.styleElements?.[1].afterFilename).toBe("after-1.jpg");
    // 입력 ctx는 변형하지 않는다.
    expect(ctx.styleElements?.[0].beforeFilename).toBe("before-0.webp");
  });

  it("리네임이 없으면 ctx를 그대로 반환한다", () => {
    const ctx = makeCtx({ styleElements: [styleElement(0)] });
    expect(renameStyleElementFilenames(ctx, new Map())).toBe(ctx);
  });

  it("styleElements가 없는 레거시 ctx는 diffs에서 정규화된 배열에 리네임을 적용한다", () => {
    const ctx = makeCtx({
      diffs: [{ prop: "color", asIs: "#000", toBe: "#fff" }],
    });
    const next = renameStyleElementFilenames(
      ctx,
      new Map([["before-0.webp", "before-0.jpg"]]),
    );

    expect(next.styleElements?.[0].beforeFilename).toBe("before-0.jpg");
    expect(next.styleElements?.[0].afterFilename).toBe("after-0.webp");
  });

  it("element 항목이 0개면 ctx를 그대로 반환한다", () => {
    const ctx = makeCtx();
    const renames = new Map([["before-0.webp", "before-0.jpg"]]);
    expect(renameStyleElementFilenames(ctx, renames)).toBe(ctx);
  });
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
    expect(res).toEqual({ key: "TASK_GID", url: TASK.permalinkUrl, logsDropped: false });

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

  it("logs.html은 업로드 전 task permalinkUrl을 백링크로 주입", async () => {
    const uploaded: Array<{ filename: string; dataUrl: string }> = [];
    sendBg.mockImplementation(
      async (msg: { type: string; files?: Array<{ filename: string; dataUrl: string }> }) => {
        if (msg.type === "asana.submitIssue") return TASK;
        if (msg.type === "asana.uploadFiles") {
          uploaded.push(...(msg.files ?? []));
          return (msg.files ?? []).map((f) => ({ filename: f.filename, gid: null }));
        }
        return undefined;
      },
    );

    await submitToAsana({
      ctx: makeCtx({ captureMode: "screenshot" }),
      workspaceGid: "W",
      logs: [{ filename: "logs.html", dataUrl: "data:LOGS" }],
    });

    expect(injectIssueUrl).toHaveBeenCalledWith("data:LOGS", TASK.permalinkUrl, TASK.gid);
    const logsEntry = uploaded.find((f) => f.filename === "logs.html");
    expect(logsEntry?.dataUrl).toBe(`data:LOGS#${TASK.permalinkUrl}#${TASK.gid}`);
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

  it("본문 인라인 이미지(inlineImages)도 업로드 → inline:refId 키로 본문 갱신", async () => {
    sendBg.mockImplementation(
      async (msg: { type: string; files?: Array<{ filename: string }> }) => {
        if (msg.type === "asana.submitIssue") return TASK;
        if (msg.type === "asana.uploadFiles")
          return (msg.files ?? []).map((f) => ({
            filename: f.filename,
            gid: `gid-${f.filename}`,
            viewUrl: `url-${f.filename}`,
          }));
        return undefined;
      },
    );

    const res = await submitToAsana({
      ctx: makeCtx(),
      workspaceGid: "W",
      inlineImages: [{ refId: "REF1", dataUrl: "data:image/png;base64,AAA" }],
    });

    // 인라인 이미지가 refId 기반 파일명으로 업로드 대상에 포함된다.
    const uploadCall = sendBg.mock.calls.find(
      ([m]) => m.type === "asana.uploadFiles",
    )![0];
    expect(
      uploadCall.files.some(
        (f: { filename: string }) => f.filename === "inline-REF1.png",
      ),
    ).toBe(true);

    // updateTaskNotes 호출 시 imageRefs에 본문 src 키(inline:REF1)가 매핑된다.
    const refsArg = markdownToAsanaHtml.mock.calls.at(-1)![1] as Record<
      string,
      { viewUrl?: string }
    >;
    expect(refsArg["inline:REF1"]).toBeDefined();
    expect(refsArg["inline:REF1"]?.viewUrl).toBe("url-inline-REF1.png");
    expect(res.key).toBe("TASK_GID");
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

  it("logs.html 첨부 실패(gid null)면 logsDropped: true", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "asana.submitIssue") return TASK;
      if (msg.type === "asana.uploadFiles")
        return [
          { filename: "logs.html", gid: null },
          { filename: "ai-meta.json", gid: "ok" },
        ];
      return undefined;
    });

    const res = await submitToAsana({
      ctx: makeCtx({ captureMode: "screenshot" }),
      workspaceGid: "W",
      logs: [{ filename: "logs.html", dataUrl: "data:LOGS" }],
    });

    expect(res.logsDropped).toBe(true);
  });

  it("logs.html 첨부 성공이면 logsDropped: false", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "asana.submitIssue") return TASK;
      if (msg.type === "asana.uploadFiles")
        return [
          { filename: "logs.html", gid: "lg" },
          { filename: "ai-meta.json", gid: "ok" },
        ];
      return undefined;
    });

    const res = await submitToAsana({
      ctx: makeCtx({ captureMode: "screenshot" }),
      workspaceGid: "W",
      logs: [{ filename: "logs.html", dataUrl: "data:LOGS" }],
    });

    expect(res.logsDropped).toBe(false);
  });
});
