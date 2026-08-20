import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendBg = vi.fn();
vi.mock("@/lib/bg-client", () => ({ sendBg: (...a: unknown[]) => sendBg(...a) }));

vi.mock("@/i18n", () => ({
  t: (key: string) => key,
  dateBcp47: () => "en-US",
}));
vi.mock("@/store/settings-ui-store", () => ({
  sectionMdLabelKey: (id: string) => `md.section.${id}`,
}));

const buildAsanaIssueBody = vi.fn((_input: unknown) => ({
  body: "BODY_MD",
  attached: [],
}));
vi.mock("../buildAsanaIssueBody", () => ({
  buildAsanaIssueBody: (input: unknown) => buildAsanaIssueBody(input),
}));
const markdownToAsanaHtml = vi.fn(
  (md: string, _refs?: Record<string, unknown>) => `<body>${md}</body>`,
);
vi.mock("../markdownToAsanaHtml", () => ({
  markdownToAsanaHtml: (...a: unknown[]) =>
    markdownToAsanaHtml(...(a as [string, Record<string, unknown>?])),
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

import { loadImage } from "@/sidepanel/capture";
import { renameStyleElementFilenames, submitToAsana } from "../submitToAsana";
import type { MarkdownContext, StyleElementContext } from "../buildIssueMarkdown";

function makeCtx(overrides: Partial<MarkdownContext> = {}): MarkdownContext {
  return {
    bodyLocale: "ko",
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
  buildAsanaIssueBody.mockClear();
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
        return [{ ok: true, filename: "screenshot.png", gid: "att1" }];
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
          return (msg.files ?? []).map((f) => ({ ok: false, filename: f.filename }));
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
        return [{ ok: true, filename: "recording.mp4", gid: "v1" }];
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
            ok: true,
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
          { ok: true, filename: "a.png", gid: "att" },
          { ok: false, filename: "b.png" },
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
        return [{ ok: false, filename: "logs.html" }];
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
        return [{ ok: true, filename: "logs.html", gid: "lg" }];
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

describe("submitToAsana 업로드 판별자", () => {
  // asana도 gid를 직접 읽어 판별자 도입 전후로 동작이 같다(핸들러 반환 형태 변경의
  // 회귀 가드). 실패분이 본문 갱신 대상에 안 들어가는 것만 고정한다.
  it("실패분만 있으면 본문 갱신을 호출하지 않는다", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "asana.submitIssue") return TASK;
      if (msg.type === "asana.uploadFiles")
        return [{ ok: false, filename: "screenshot.png" }];
      return undefined;
    });

    await submitToAsana({
      ctx: makeCtx(),
      workspaceGid: "W",
      projectGid: "P",
      images: [{ filename: "screenshot.png", dataUrl: "data:," }],
    });

    expect(
      sendBg.mock.calls.some(
        ([m]) => (m as { type: string }).type === "asana.updateTaskNotes",
      ),
    ).toBe(false);
  });

  it("성공분이 있으면 본문 갱신을 호출한다", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "asana.submitIssue") return TASK;
      if (msg.type === "asana.uploadFiles")
        return [
          { ok: true, filename: "screenshot.png", gid: "att1" },
          { ok: false, filename: "logs.html" },
        ];
      return undefined;
    });

    await submitToAsana({
      ctx: makeCtx(),
      workspaceGid: "W",
      projectGid: "P",
      images: [{ filename: "screenshot.png", dataUrl: "data:," }],
      logs: [{ filename: "logs.html", dataUrl: "data:LOGS" }],
    });

    expect(
      sendBg.mock.calls.some(
        ([m]) => (m as { type: string }).type === "asana.updateTaskNotes",
      ),
    ).toBe(true);
    // 값 축 — 성공분의 gid가 실제로 본문 조립에 실린다(htmlNotes는 목이라 gid가 안 남는다).
    expect(markdownToAsanaHtml).toHaveBeenCalledWith(
      "BODY_MD",
      expect.objectContaining({
        "screenshot.png": expect.objectContaining({ gid: "att1" }),
      }),
    );
  });
});

describe("renameStyleElementFilenames — 파일명이 없는 항목", () => {
  // before/after 중 한쪽만 있는 element(캡처 실패·부분 캡처)에서 falsy 가지를 탄다.
  // 리네임 맵에 키가 있어도 undefined를 문자열로 바꾸지 않는다.
  it("beforeFilename이 없으면 undefined를 유지하고 afterFilename만 리네임한다", () => {
    const ctx = makeCtx({
      styleElements: [{ ...styleElement(0), beforeFilename: undefined }],
    });
    const next = renameStyleElementFilenames(
      ctx,
      new Map([
        ["before-0.webp", "before-0.jpg"],
        ["after-0.webp", "after-0.jpg"],
      ]),
    );
    expect(next.styleElements?.[0].beforeFilename).toBeUndefined();
    expect(next.styleElements?.[0].afterFilename).toBe("after-0.jpg");
  });

  it("afterFilename이 없으면 undefined를 유지하고 beforeFilename만 리네임한다", () => {
    const ctx = makeCtx({
      styleElements: [{ ...styleElement(0), afterFilename: undefined }],
    });
    const next = renameStyleElementFilenames(
      ctx,
      new Map([["before-0.webp", "before-0.jpg"]]),
    );
    expect(next.styleElements?.[0].beforeFilename).toBe("before-0.jpg");
    expect(next.styleElements?.[0].afterFilename).toBeUndefined();
  });

  it("맵에 없는 파일명은 원본을 유지한다", () => {
    const ctx = makeCtx({ styleElements: [styleElement(0)] });
    const next = renameStyleElementFilenames(
      ctx,
      new Map([["다른-파일.webp", "다른-파일.jpg"]]),
    );
    expect(next.styleElements?.[0].beforeFilename).toBe("before-0.webp");
    expect(next.styleElements?.[0].afterFilename).toBe("after-0.webp");
  });
});

describe("submitToAsana webp→jpeg 변환", () => {
  // node 환경엔 document/canvas가 없다 → webpToJpeg의 try가 ReferenceError로 떨어지고
  // catch 폴백이 원본을 그대로 돌려준다. 변환 성공 경로는 아래 describe에서 canvas를 stub한다.
  it("canvas가 없는 환경이면 원본 webp 파일명을 그대로 유지한다 (graceful)", async () => {
    sendBg.mockImplementation(
      async (msg: { type: string; files?: Array<{ filename: string }> }) => {
        if (msg.type === "asana.submitIssue") return TASK;
        if (msg.type === "asana.uploadFiles")
          return (msg.files ?? []).map((f) => ({
            ok: true,
            filename: f.filename,
            gid: `gid-${f.filename}`,
          }));
        return undefined;
      },
    );

    await submitToAsana({
      ctx: makeCtx({ styleElements: [styleElement(0)] }),
      workspaceGid: "W",
      images: [{ filename: "before-0.webp", dataUrl: "data:image/webp;base64,AAA" }],
    });

    const uploadCall = sendBg.mock.calls.find(([m]) => m.type === "asana.uploadFiles")![0];
    expect(uploadCall.files.map((f: { filename: string }) => f.filename)).toEqual([
      "before-0.webp",
    ]);
    // 리네임이 없으니 styleElements도 손대지 않는다.
    const ctxArg = buildAsanaIssueBody.mock.calls[0][0] as {
      ctx: MarkdownContext;
    };
    expect(ctxArg.ctx.styleElements?.[0].beforeFilename).toBe("before-0.webp");
  });
});

describe("submitToAsana webp→jpeg 변환 (canvas stub)", () => {
  beforeEach(() => {
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          fillStyle: "",
          fillRect: () => {},
          drawImage: () => {},
        }),
        toDataURL: () => "data:image/jpeg;base64,JPEG",
      }),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("webp 이미지는 .jpg로 변환되고 styleElements의 before/after 파일명도 함께 리네임된다", async () => {
    sendBg.mockImplementation(
      async (msg: { type: string; files?: Array<{ filename: string }> }) => {
        if (msg.type === "asana.submitIssue") return TASK;
        if (msg.type === "asana.uploadFiles")
          return (msg.files ?? []).map((f) => ({
            ok: true,
            filename: f.filename,
            gid: `gid-${f.filename}`,
          }));
        return undefined;
      },
    );

    await submitToAsana({
      ctx: makeCtx({ styleElements: [styleElement(0)] }),
      workspaceGid: "W",
      images: [
        { filename: "before-0.webp", dataUrl: "data:image/webp;base64,AAA" },
        { filename: "after-0.webp", dataUrl: "data:image/webp;base64,BBB" },
      ],
    });

    const uploadCall = sendBg.mock.calls.find(([m]) => m.type === "asana.uploadFiles")![0];
    expect(uploadCall.files.map((f: { filename: string }) => f.filename)).toEqual([
      "before-0.jpg",
      "after-0.jpg",
    ]);
    // 리네임 맵이 본문 ctx까지 전파돼야 As is/To be 섹션의 filename 매칭이 안 깨진다.
    const ctxArg = buildAsanaIssueBody.mock.calls[0][0] as { ctx: MarkdownContext };
    expect(ctxArg.ctx.styleElements?.[0].beforeFilename).toBe("before-0.jpg");
    expect(ctxArg.ctx.styleElements?.[0].afterFilename).toBe("after-0.jpg");
  });

  it("png 이미지는 변환 대상이 아니라 리네임이 발생하지 않는다", async () => {
    sendBg.mockImplementation(
      async (msg: { type: string; files?: Array<{ filename: string }> }) => {
        if (msg.type === "asana.submitIssue") return TASK;
        if (msg.type === "asana.uploadFiles")
          return (msg.files ?? []).map((f) => ({
            ok: true,
            filename: f.filename,
            gid: `gid-${f.filename}`,
          }));
        return undefined;
      },
    );

    await submitToAsana({
      ctx: makeCtx({ styleElements: [styleElement(0)] }),
      workspaceGid: "W",
      images: [{ filename: "shot.png", dataUrl: "data:image/png;base64,AAA" }],
    });

    const uploadCall = sendBg.mock.calls.find(([m]) => m.type === "asana.uploadFiles")![0];
    expect(uploadCall.files.map((f: { filename: string }) => f.filename)).toEqual([
      "shot.png",
    ]);
    const ctxArg = buildAsanaIssueBody.mock.calls[0][0] as { ctx: MarkdownContext };
    expect(ctxArg.ctx.styleElements?.[0].beforeFilename).toBe("before-0.webp");
  });
});

describe("submitToAsana 사용자 첨부", () => {
  it("표시명(displayName)으로 업로드되고 본문 인라인(imageRefs) 대상에서 제외된다", async () => {
    sendBg.mockImplementation(
      async (msg: { type: string; files?: Array<{ filename: string }> }) => {
        if (msg.type === "asana.submitIssue") return TASK;
        if (msg.type === "asana.uploadFiles")
          return (msg.files ?? []).map((f) => ({
            ok: true,
            filename: f.filename,
            gid: `gid-${f.filename}`,
            viewUrl: `url-${f.filename}`,
          }));
        return undefined;
      },
    );

    await submitToAsana({
      ctx: makeCtx(),
      workspaceGid: "W",
      images: [{ filename: "screenshot.png", dataUrl: "data:," }],
      attachments: [
        { filename: "user-1.png", dataUrl: "data:P", displayName: "보고서.png" },
        { filename: "user-2.pdf", dataUrl: "data:Q" },
      ],
    });

    const uploadCall = sendBg.mock.calls.find(([m]) => m.type === "asana.uploadFiles")![0];
    // displayName이 있으면 표시명, 없으면 filename 폴백.
    expect(uploadCall.files.map((f: { filename: string }) => f.filename)).toEqual([
      "screenshot.png",
      "보고서.png",
      "user-2.pdf",
    ]);

    // 사용자 첨부는 byName에서 제외 — imageRefs 매칭 오염 방지(캡처 이미지만 인라인).
    const refs = markdownToAsanaHtml.mock.calls.at(-1)![1] as Record<string, unknown>;
    expect(Object.keys(refs)).toEqual(["screenshot.png"]);
  });
});

// ── 2차 본문 갱신 실패 시 graceful degradation — 전수 표 (asana 행) ──────────────
// 표 전체 설명·플랫폼 목록·정직성 주의는 submitToClickup.test.ts의 동명 블록 참조.
// asana 관용구: try {} catch {} (submitToAsana.ts:215-225).
describe("submitToAsana — 2차 본문 갱신 실패 (전수 표 asana 행)", () => {
  it("updateTaskNotes가 reject해도 제출은 성공하고 task·첨부가 보존된다", async () => {
    sendBg.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "asana.submitIssue") return TASK;
      if (msg.type === "asana.uploadFiles")
        return [
          { ok: true, filename: "screenshot.png", gid: "att1" },
          { ok: true, filename: "logs.html", gid: "lg" },
        ];
      if (msg.type === "asana.updateTaskNotes") throw new Error("PUT 500");
      return undefined;
    });

    const res = await submitToAsana({
      ctx: makeCtx({ captureMode: "screenshot" }),
      workspaceGid: "W",
      images: [{ filename: "screenshot.png", dataUrl: "data:," }],
      logs: [{ filename: "logs.html", dataUrl: "data:LOGS" }],
    });

    // ①② 완전 성공 경로와 동일한 반환값.
    expect(res).toEqual({ key: "TASK_GID", url: TASK.permalinkUrl, logsDropped: false });
    // ③ 생성·업로드는 그대로.
    expect(sendBg.mock.calls.map(([m]) => m.type)).toEqual([
      "asana.submitIssue",
      "asana.uploadFiles",
      "asana.updateTaskNotes",
    ]);
    const uploadCall = sendBg.mock.calls.find(([m]) => m.type === "asana.uploadFiles")![0];
    expect(uploadCall.files.map((f: { filename: string }) => f.filename)).toEqual([
      "screenshot.png",
      "logs.html",
    ]);
  });
});

describe("submitToAsana 인라인 ref 크기 측정", () => {
  function mockUploadOk() {
    sendBg.mockImplementation(
      async (msg: { type: string; files?: Array<{ filename: string }> }) => {
        if (msg.type === "asana.submitIssue") return TASK;
        if (msg.type === "asana.uploadFiles")
          return (msg.files ?? []).map((f) => ({
            ok: true,
            filename: f.filename,
            gid: `gid-${f.filename}`,
            viewUrl: `url-${f.filename}`,
          }));
        return undefined;
      },
    );
  }

  it("측정 성공이면 원본 픽셀 크기를 ref에 박는다", async () => {
    mockUploadOk();
    await submitToAsana({
      ctx: makeCtx(),
      workspaceGid: "W",
      images: [{ filename: "shot.png", dataUrl: "data:," }],
    });
    const refs = markdownToAsanaHtml.mock.calls.at(-1)![1] as Record<string, unknown>;
    expect(refs["shot.png"]).toEqual({
      gid: "gid-shot.png",
      viewUrl: "url-shot.png",
      width: 800,
      height: 600,
    });
  });

  // loadImage 실패는 인라인을 포기할 이유가 아니다 — gid만으로도 Asana가 렌더한다(graceful).
  // png라 webpToJpeg가 :67에서 조기 반환하므로 여기서 소비되는 loadImage 호출은 buildInlineRef뿐.
  it("측정 실패면 크기 없이 gid만으로 인라인한다", async () => {
    vi.mocked(loadImage).mockRejectedValueOnce(new Error("decode failed"));
    mockUploadOk();
    await submitToAsana({
      ctx: makeCtx(),
      workspaceGid: "W",
      images: [{ filename: "shot.png", dataUrl: "data:," }],
    });
    const refs = markdownToAsanaHtml.mock.calls.at(-1)![1] as Record<string, unknown>;
    expect(refs["shot.png"]).toEqual({ gid: "gid-shot.png", viewUrl: "url-shot.png" });
  });
});

// ── Task 8-1 재현: 사용자 첨부 파일명이 캡처 파일명과 충돌 ────────────────────────
// userAttachmentNames(submitToAsana.ts:138)는 "이름"을 축으로 캡처/사용자 첨부를 가른다.
// 사용자 첨부 표시명은 원본 파일명 그대로(buildCaptureFiles.ts:139 `displayName: meta.filename`)라
// 캡처가 쓰는 이름(before-{i}.jpg·logs.html …)과 우연히 같아질 수 있고, 그때 :194 가드가
// 캡처 업로드 결과까지 byName에서 떨어뜨린다. 아래 두 케이스가 그 낙진이다.
describe("submitToAsana 사용자 첨부 파일명 충돌 (Task 8-1 재현)", () => {
  beforeEach(() => {
    // element 모드 캡처는 before-0.webp로 나가고 asana에서 before-0.jpg로 변환된다 →
    // 사용자가 before-0.jpg를 첨부하면 변환 후 이름이 겹친다. 변환 경로엔 canvas가 필요하다.
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          fillStyle: "",
          fillRect: () => {},
          drawImage: () => {},
        }),
        toDataURL: () => "data:image/jpeg;base64,JPEG",
      }),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("동명의 사용자 첨부가 있어도 캡처 이미지는 본문 인라인(imageRefs)에 남는다", async () => {
    // 업로드 결과의 gid를 인덱스로 구분한다 — 같은 이름의 두 파일 중 어느 쪽이 본문에
    // 실렸는지 봐야 하기 때문(allFiles 순서: 캡처 0, 사용자 첨부 1).
    sendBg.mockImplementation(
      async (msg: { type: string; files?: Array<{ filename: string }> }) => {
        if (msg.type === "asana.submitIssue") return TASK;
        if (msg.type === "asana.uploadFiles")
          return (msg.files ?? []).map((f, i) => ({
            ok: true,
            filename: f.filename,
            gid: `gid-${i}-${f.filename}`,
            viewUrl: `url-${i}-${f.filename}`,
          }));
        return undefined;
      },
    );

    await submitToAsana({
      ctx: makeCtx({ styleElements: [styleElement(0)] }),
      workspaceGid: "W",
      images: [{ filename: "before-0.webp", dataUrl: "data:image/webp;base64,AAA" }],
      attachments: [
        { filename: "u1__before-0.jpg", dataUrl: "data:USER", displayName: "before-0.jpg" },
      ],
    });

    // 두 파일 모두 업로드는 된다(이름이 겹쳐도 업로드 축은 멀쩡하다).
    const uploadCall = sendBg.mock.calls.find(([m]) => m.type === "asana.uploadFiles")![0];
    expect(uploadCall.files.map((f: { filename: string }) => f.filename)).toEqual([
      "before-0.jpg",
      "before-0.jpg",
    ]);

    // 본문 갱신이 일어나고, before-0.jpg 참조가 "캡처 업로드"(인덱스 0)를 가리켜야 한다.
    expect(
      sendBg.mock.calls.some(([m]) => m.type === "asana.updateTaskNotes"),
      "imageRefs가 비면 2차 write 자체가 없다 = 본문에서 스크린샷이 사라진 상태",
    ).toBe(true);
    const refs = (markdownToAsanaHtml.mock.calls.at(-1)![1] ?? {}) as Record<
      string,
      unknown
    >;
    expect(refs["before-0.jpg"]).toEqual({
      gid: "gid-0-before-0.jpg",
      viewUrl: "url-0-before-0.jpg",
      width: 800,
      height: 600,
    });
  });

  it("사용자가 logs.html과 동명의 파일을 첨부해도 logsDropped는 false로 남는다", async () => {
    sendBg.mockImplementation(
      async (msg: { type: string; files?: Array<{ filename: string }> }) => {
        if (msg.type === "asana.submitIssue") return TASK;
        if (msg.type === "asana.uploadFiles")
          return (msg.files ?? []).map((f, i) => ({
            ok: true,
            filename: f.filename,
            gid: `gid-${i}-${f.filename}`,
            viewUrl: `url-${i}-${f.filename}`,
          }));
        return undefined;
      },
    );

    const res = await submitToAsana({
      ctx: makeCtx({ captureMode: "screenshot" }),
      workspaceGid: "W",
      logs: [{ filename: "logs.html", dataUrl: "data:LOGS" }],
      attachments: [
        { filename: "u1__logs.html", dataUrl: "data:USER", displayName: "logs.html" },
      ],
    });

    // 로그 첨부는 성공했으므로 "용량 초과로 누락" 경고가 뜨면 안 된다.
    expect(res).toEqual({ key: "TASK_GID", url: TASK.permalinkUrl, logsDropped: false });
  });
});
