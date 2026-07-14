import { describe, expect, it, vi } from "vitest";
import type { ConsoleLog } from "@/types/console";
import type { NetworkLog } from "@/types/network";
import type { ActionLog } from "@/types/action";

vi.stubGlobal("chrome", {
  runtime: { getManifest: () => ({ version: "1.0.0" }) },
});

vi.mock("@/store/blob-db", () => ({
  blobToDataUrl: (blob: Blob) =>
    Promise.resolve(`data:${blob.type || "application/octet-stream"};base64,FAKE`),
}));

// buildLogsHtml은 자체 테스트(buildLogsHtml.test.ts)로 video 임베드를 검증. 여기선 video 인자가
// 올바르게 전달되는지(임베드/null)만 spy로 확인한다. 실제 escaping·주입은 그쪽 책임.
const buildLogsHtmlSpy = vi.hoisted(() =>
  vi.fn((..._args: unknown[]) => "<html>logs</html>"),
);
vi.mock("../buildLogsHtml", () => ({ buildLogsHtml: buildLogsHtmlSpy }));

import { buildCaptureFiles } from "../buildCaptureFiles";

function lastVideoArg(): unknown {
  const call = buildLogsHtmlSpy.mock.calls.at(-1);
  return call ? call[3] : undefined;
}

// screenshot 임베드는 video(call[3]) 바로 뒤 5번째 인자(call[4]). Task 4(프로덕션 인자 삽입) 전엔
// call[4]가 아직 pageUrl이라 신규 케이스가 red.
function lastScreenshotArg(): unknown {
  const call = buildLogsHtmlSpy.mock.calls.at(-1);
  return call ? call[4] : undefined;
}

const networkLog: NetworkLog = {
  id: "net-1",
  startedAt: 0,
  endedAt: 1000,
  totalSeen: 1,
  captured: 1,
  requests: [],
  warnings: [],
};

const consoleLog: ConsoleLog = {
  id: "con-1",
  startedAt: 0,
  endedAt: 1000,
  totalSeen: 1,
  captured: 1,
  entries: [],
};

const actionLog: ActionLog = {
  id: "act-1",
  startedAt: 0,
  endedAt: 1000,
  totalSeen: 1,
  captured: 1,
  entries: [
    { id: "ae-1", kind: "click", timestamp: 500, pageUrl: "https://example.com", target: "Btn" },
  ],
};

describe("buildCaptureFiles — element mode (복수 element 배열)", () => {
  it("단일 element: beforeImages/afterImages [1] → before-0/after-0", async () => {
    const out = await buildCaptureFiles({
      captureMode: "element",
      beforeImages: ["data:image/webp;base64,BEFORE"],
      afterImages: ["data:image/webp;base64,AFTER"],
    });
    expect(out.images).toEqual([
      { filename: "before-0.webp", dataUrl: "data:image/webp;base64,BEFORE" },
      { filename: "after-0.webp", dataUrl: "data:image/webp;base64,AFTER" },
    ]);
    expect(out.video).toBeUndefined();
    expect(out.logs).toEqual([]);
  });

  it("복수 element: element별 before-${i}/after-${i} (element 묶음 순서)", async () => {
    const out = await buildCaptureFiles({
      captureMode: "element",
      beforeImages: ["data:B0", "data:B1"],
      afterImages: ["data:A0", "data:A1"],
    });
    expect(out.images).toEqual([
      { filename: "before-0.webp", dataUrl: "data:B0" },
      { filename: "after-0.webp", dataUrl: "data:A0" },
      { filename: "before-1.webp", dataUrl: "data:B1" },
      { filename: "after-1.webp", dataUrl: "data:A1" },
    ]);
  });

  it("after가 null인 항목은 before만 (인덱스 유지)", async () => {
    const out = await buildCaptureFiles({
      captureMode: "element",
      beforeImages: ["data:B0"],
      afterImages: [null],
    });
    expect(out.images).toEqual([
      { filename: "before-0.webp", dataUrl: "data:B0" },
    ]);
  });

  it("중간 before가 null이면 skip하되 인덱스는 배열 위치 기준 유지", async () => {
    const out = await buildCaptureFiles({
      captureMode: "element",
      beforeImages: ["data:B0", null],
      afterImages: ["data:A0", "data:A1"],
    });
    expect(out.images).toEqual([
      { filename: "before-0.webp", dataUrl: "data:B0" },
      { filename: "after-0.webp", dataUrl: "data:A0" },
      { filename: "after-1.webp", dataUrl: "data:A1" },
    ]);
  });

  it("빈 배열이면 images 빈", async () => {
    const out = await buildCaptureFiles({
      captureMode: "element",
      beforeImages: [],
      afterImages: [],
    });
    expect(out.images).toEqual([]);
  });

  it("element는 networkLog/consoleLog 무시", async () => {
    const out = await buildCaptureFiles({
      captureMode: "element",
      beforeImages: ["data:image/webp;base64,BEFORE"],
      networkLog,
      consoleLog,
    });
    expect(out.logs).toEqual([]);
  });
});

describe("buildCaptureFiles — screenshot mode", () => {
  it("screenshotImage → screenshot.webp 단일", async () => {
    const out = await buildCaptureFiles({
      captureMode: "screenshot",
      screenshotImage: "data:image/webp;base64,SHOT",
    });
    expect(out.images).toEqual([
      { filename: "screenshot.webp", dataUrl: "data:image/webp;base64,SHOT" },
    ]);
  });

  it("screenshotImage 없으면 images 빈", async () => {
    const out = await buildCaptureFiles({ captureMode: "screenshot" });
    expect(out.images).toEqual([]);
  });

  it("screenshot + networkLog + consoleLog → logs.html", async () => {
    const out = await buildCaptureFiles({
      captureMode: "screenshot",
      screenshotImage: "data:x",
      networkLog,
      consoleLog,
      pageUrl: "https://example.com",
    });
    expect(out.logs.map((l) => l.filename)).toEqual(["logs.html"]);
  });

  it("screenshot + null log → logs 빈", async () => {
    const out = await buildCaptureFiles({
      captureMode: "screenshot",
      screenshotImage: "data:x",
      networkLog: null,
      consoleLog: null,
    });
    expect(out.logs).toEqual([]);
  });
});

describe("buildCaptureFiles — video mode", () => {
  it("videoBlob → mime 기반 filename", async () => {
    const blob = new Blob([new Uint8Array([0])], { type: "video/mp4" });
    const out = await buildCaptureFiles({ captureMode: "video", videoBlob: blob });
    expect(out.video).toEqual({
      filename: "recording.mp4",
      dataUrl: "data:video/mp4;base64,FAKE",
    });
  });

  it("video + networkLog + consoleLog → logs.html", async () => {
    const out = await buildCaptureFiles({
      captureMode: "video",
      networkLog,
      consoleLog,
      pageUrl: "https://example.com",
    });
    expect(out.logs.map((l) => l.filename)).toEqual(["logs.html"]);
  });

  it("video + null log → logs 빈", async () => {
    const out = await buildCaptureFiles({
      captureMode: "video",
      networkLog: null,
      consoleLog: null,
    });
    expect(out.logs).toEqual([]);
  });
});

describe("buildCaptureFiles — video 임베드 (logs.html)", () => {
  const blob = new Blob([new Uint8Array([0])], { type: "video/mp4" });

  it("video + blob + 앵커 → logs.html에 video 임베드 AND recording.mp4 인라인 유지", async () => {
    buildLogsHtmlSpy.mockClear();
    const out = await buildCaptureFiles({
      captureMode: "video",
      videoBlob: blob,
      networkLog,
      videoStartedAt: 1000,
      videoEndedAt: 5000,
      videoThumbnail: "data:image/webp;base64,THUMB",
      pageUrl: "https://example.com",
    });
    // 인라인 recording.mp4 유지(폐지 아님)
    expect(out.video).toEqual({ filename: "recording.mp4", dataUrl: "data:video/mp4;base64,FAKE" });
    expect(out.logs.map((l) => l.filename)).toEqual(["logs.html"]);
    // logs.html에 동기화 video 추가 임베드 (뷰어 미소비 필드 mime/endedAt/viewport 제거됨)
    expect(lastVideoArg()).toEqual({
      dataUrl: "data:video/mp4;base64,FAKE",
      startedAt: 1000,
      thumbnail: "data:image/webp;base64,THUMB",
    });
  });

  it("video + 앵커 없음 → logs.html video=null, recording.mp4는 존재 (graceful)", async () => {
    buildLogsHtmlSpy.mockClear();
    const out = await buildCaptureFiles({
      captureMode: "video",
      videoBlob: blob,
      networkLog,
      pageUrl: "https://example.com",
    });
    expect(out.video).toEqual({ filename: "recording.mp4", dataUrl: "data:video/mp4;base64,FAKE" });
    expect(lastVideoArg()).toBeNull();
  });

  it("freeform → video=null, recording.mp4 없음 (회귀)", async () => {
    buildLogsHtmlSpy.mockClear();
    const out = await buildCaptureFiles({
      captureMode: "freeform",
      videoBlob: blob,
      videoStartedAt: 1000,
      videoEndedAt: 5000,
      networkLog,
      pageUrl: "https://example.com",
    });
    expect(out.video).toBeUndefined();
    expect(lastVideoArg()).toBeNull();
  });

  it("screenshot → video=null, recording.mp4 없음 (회귀)", async () => {
    buildLogsHtmlSpy.mockClear();
    const out = await buildCaptureFiles({
      captureMode: "screenshot",
      screenshotImage: "data:x",
      networkLog,
      pageUrl: "https://example.com",
    });
    expect(out.video).toBeUndefined();
    expect(lastVideoArg()).toBeNull();
  });
});

describe("buildCaptureFiles — screenshot 임베드 (logs.html)", () => {
  it("screenshot + consoleLog + screenshotImage → logs.html에 screenshot 임베드", async () => {
    buildLogsHtmlSpy.mockClear();
    const out = await buildCaptureFiles({
      captureMode: "screenshot",
      screenshotImage: "data:image/webp;base64,SHOT",
      consoleLog,
      pageUrl: "https://example.com",
    });
    expect(out.logs.map((l) => l.filename)).toEqual(["logs.html"]);
    expect(lastScreenshotArg()).toEqual({ dataUrl: "data:image/webp;base64,SHOT" });
  });

  it("screenshot + 로그 없음 → logs 빈, buildLogsHtml 미호출 (게이팅 유지)", async () => {
    buildLogsHtmlSpy.mockClear();
    const out = await buildCaptureFiles({
      captureMode: "screenshot",
      screenshotImage: "data:image/webp;base64,SHOT",
      networkLog: null,
      consoleLog: null,
    });
    expect(out.logs).toEqual([]);
    expect(buildLogsHtmlSpy).not.toHaveBeenCalled();
  });

  it("screenshot + 로그 있음 + screenshotImage 없음 → screenshot 임베드 null (전폭 폴백)", async () => {
    buildLogsHtmlSpy.mockClear();
    const out = await buildCaptureFiles({
      captureMode: "screenshot",
      consoleLog,
      pageUrl: "https://example.com",
    });
    expect(out.logs.map((l) => l.filename)).toEqual(["logs.html"]);
    expect(lastScreenshotArg()).toBeNull();
  });

  it("video 모드 → screenshot 임베드 null (혼입 방지)", async () => {
    buildLogsHtmlSpy.mockClear();
    await buildCaptureFiles({
      captureMode: "video",
      networkLog,
      pageUrl: "https://example.com",
    });
    expect(lastScreenshotArg()).toBeNull();
  });
});

describe("buildCaptureFiles — freeform mode", () => {
  it("freeform은 video 무시 (logs만)", async () => {
    const blob = new Blob([new Uint8Array([0])], { type: "video/mp4" });
    const out = await buildCaptureFiles({
      captureMode: "freeform",
      videoBlob: blob,
      networkLog,
      pageUrl: "https://example.com",
    });
    expect(out.video).toBeUndefined();
    expect(out.logs.map((l) => l.filename)).toEqual(["logs.html"]);
  });

  it("freeform + consoleLog만", async () => {
    const out = await buildCaptureFiles({
      captureMode: "freeform",
      consoleLog,
      pageUrl: "https://example.com",
    });
    expect(out.logs.map((l) => l.filename)).toEqual(["logs.html"]);
  });

  it("freeform + 이미지 무시", async () => {
    const out = await buildCaptureFiles({
      captureMode: "freeform",
      beforeImages: ["data:x"],
      screenshotImage: "data:y",
      networkLog,
    });
    expect(out.images).toEqual([]);
  });
});

describe("buildCaptureFiles — actionLog 스코핑 (console/network와 동일 계약)", () => {
  // buildLogsHtml(network, console, action, ...) — action은 3번째 인자.
  function lastActionArg(): unknown {
    const call = buildLogsHtmlSpy.mock.calls.at(-1);
    return call ? call[2] : undefined;
  }

  it("video + actionLog → logs.html 생성 + action 전달", async () => {
    buildLogsHtmlSpy.mockClear();
    const out = await buildCaptureFiles({
      captureMode: "video",
      actionLog,
      pageUrl: "https://example.com",
    });
    expect(out.logs.map((l) => l.filename)).toEqual(["logs.html"]);
    expect(lastActionArg()).toBe(actionLog);
  });

  it("screenshot + actionLog만 → logs.html 생성 + action 전달 (계약 확장)", async () => {
    buildLogsHtmlSpy.mockClear();
    const out = await buildCaptureFiles({
      captureMode: "screenshot",
      screenshotImage: "data:x",
      actionLog,
      pageUrl: "https://example.com",
    });
    expect(out.logs.map((l) => l.filename)).toEqual(["logs.html"]);
    expect(lastActionArg()).toBe(actionLog);
  });

  it("freeform + actionLog만 → logs.html 생성 + action 전달 (계약 확장)", async () => {
    buildLogsHtmlSpy.mockClear();
    const out = await buildCaptureFiles({
      captureMode: "freeform",
      actionLog,
      pageUrl: "https://example.com",
    });
    expect(out.logs.map((l) => l.filename)).toEqual(["logs.html"]);
    expect(lastActionArg()).toBe(actionLog);
  });

  it("element + actionLog → logs 없음 (element는 로그 전무 — 회귀 가드)", async () => {
    buildLogsHtmlSpy.mockClear();
    const out = await buildCaptureFiles({
      captureMode: "element",
      beforeImages: ["data:B0"],
      actionLog,
      networkLog,
      consoleLog,
      pageUrl: "https://example.com",
    });
    expect(out.logs).toEqual([]);
    expect(buildLogsHtmlSpy).not.toHaveBeenCalled();
  });

  it("screenshot + actionLog=null → logs 빈 (로그 전무 게이팅 유지)", async () => {
    const out = await buildCaptureFiles({
      captureMode: "screenshot",
      screenshotImage: "data:x",
      actionLog: null,
      networkLog: null,
      consoleLog: null,
    });
    expect(out.logs).toEqual([]);
  });

  it("video + actionLog=null → logs 빈 (기존 video 동작 불변)", async () => {
    const out = await buildCaptureFiles({
      captureMode: "video",
      actionLog: null,
      networkLog: null,
      consoleLog: null,
    });
    expect(out.logs).toEqual([]);
  });
});

describe("buildCaptureFiles — userAttachments(사용자 첨부)", () => {
  it("userAttachments 없으면 attachments 빈 배열", async () => {
    const out = await buildCaptureFiles({
      captureMode: "screenshot",
      screenshotImage: "data:image/webp;base64,SHOT",
    });
    expect(out.attachments).toEqual([]);
  });

  it("filename은 ${id}__${원본}으로 고유화, displayName은 원본 유지", async () => {
    const out = await buildCaptureFiles({
      captureMode: "screenshot",
      screenshotImage: "data:x",
      userAttachments: [
        {
          meta: { id: "a1", filename: "doc.pdf", contentType: "application/pdf", size: 10 },
          blob: new Blob([new Uint8Array([1])], { type: "application/pdf" }),
        },
      ],
    });
    expect(out.attachments).toEqual([
      {
        filename: "a1__doc.pdf",
        displayName: "doc.pdf",
        dataUrl: "data:application/pdf;base64,FAKE",
      },
    ]);
  });

  it("동일 파일명 다중 첨부도 id prefix로 충돌 없이 분리", async () => {
    const blob = new Blob([new Uint8Array([1])], { type: "image/png" });
    const out = await buildCaptureFiles({
      captureMode: "screenshot",
      screenshotImage: "data:x",
      userAttachments: [
        { meta: { id: "a1", filename: "s.png", contentType: "image/png", size: 1 }, blob },
        { meta: { id: "a2", filename: "s.png", contentType: "image/png", size: 1 }, blob },
      ],
    });
    expect(out.attachments.map((a) => a.filename)).toEqual(["a1__s.png", "a2__s.png"]);
    expect(out.attachments.map((a) => a.displayName)).toEqual(["s.png", "s.png"]);
  });

  it("캡처 이미지/로그와 독립 — attachments만 채워지고 images는 캡처 그대로", async () => {
    const out = await buildCaptureFiles({
      captureMode: "screenshot",
      screenshotImage: "data:image/webp;base64,SHOT",
      userAttachments: [
        {
          meta: { id: "a1", filename: "notes.txt", contentType: "text/plain", size: 3 },
          blob: new Blob(["abc"], { type: "text/plain" }),
        },
      ],
    });
    expect(out.images).toEqual([
      { filename: "screenshot.webp", dataUrl: "data:image/webp;base64,SHOT" },
    ]);
    expect(out.attachments).toEqual([
      { filename: "a1__notes.txt", displayName: "notes.txt", dataUrl: "data:text/plain;base64,FAKE" },
    ]);
  });
});

describe("buildCaptureFiles — report 임베드 (logs.html)", () => {
  function lastReportArg(): unknown {
    const call = buildLogsHtmlSpy.mock.calls.at(-1);
    return call ? call[8] : undefined;
  }

  const reportCtx = {
    captureMode: "screenshot" as const,
    title: "T",
    sections: {},
    sectionConfig: [],
    url: "https://example.com",
    selector: "",
    tagName: "",
    classListBefore: [],
    classListAfter: [],
    specifiedStyles: {},
    tokens: [],
    viewport: { width: 0, height: 0 },
    capturedAt: 1_700_000_000_000,
    diffs: [],
    environment: [],
  };

  it("report 입력 + 로그 → buildLogsHtml 마지막 인자로 빌드된 report 전달", async () => {
    buildLogsHtmlSpy.mockClear();
    await buildCaptureFiles({
      captureMode: "screenshot",
      screenshotImage: "data:x",
      consoleLog,
      pageUrl: "https://example.com",
      report: {
        title: "리포트제목",
        sections: {},
        sectionConfig: [],
        envRows: [{ label: "OS", value: "macOS" }],
        markdownContext: reportCtx,
      },
    });
    const report = lastReportArg() as { title: string; env: unknown };
    expect(report).not.toBeNull();
    expect(report.title).toBe("리포트제목");
    expect(report.env).toEqual([{ label: "OS", value: "macOS" }]);
  });

  it("report 미전달 + 로그 → buildLogsHtml 마지막 인자 null", async () => {
    buildLogsHtmlSpy.mockClear();
    await buildCaptureFiles({
      captureMode: "screenshot",
      screenshotImage: "data:x",
      consoleLog,
      pageUrl: "https://example.com",
    });
    expect(lastReportArg()).toBeNull();
  });

  it("로그 없음 → report 입력이 있어도 buildLogsHtml 미호출 (게이팅 우선)", async () => {
    buildLogsHtmlSpy.mockClear();
    const out = await buildCaptureFiles({
      captureMode: "screenshot",
      screenshotImage: "data:x",
      networkLog: null,
      consoleLog: null,
      report: {
        title: "리포트제목",
        sections: {},
        sectionConfig: [],
        envRows: [],
        markdownContext: reportCtx,
      },
    });
    expect(out.logs).toEqual([]);
    expect(buildLogsHtmlSpy).not.toHaveBeenCalled();
  });
});
