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

describe("buildCaptureFiles — element mode", () => {
  it("before·after 모두 있으면 둘 다 images에", async () => {
    const out = await buildCaptureFiles({
      captureMode: "element",
      beforeImage: "data:image/webp;base64,BEFORE",
      afterImage: "data:image/webp;base64,AFTER",
    });
    expect(out.images).toEqual([
      { filename: "before.webp", dataUrl: "data:image/webp;base64,BEFORE" },
      { filename: "after.webp", dataUrl: "data:image/webp;base64,AFTER" },
    ]);
    expect(out.video).toBeUndefined();
    expect(out.logs).toEqual([]);
  });

  it("before만 있으면 before만", async () => {
    const out = await buildCaptureFiles({
      captureMode: "element",
      beforeImage: "data:image/webp;base64,BEFORE",
    });
    expect(out.images).toEqual([
      { filename: "before.webp", dataUrl: "data:image/webp;base64,BEFORE" },
    ]);
  });

  it("element는 networkLog/consoleLog 무시", async () => {
    const out = await buildCaptureFiles({
      captureMode: "element",
      beforeImage: "data:image/webp;base64,BEFORE",
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
      beforeImage: "data:x",
      screenshotImage: "data:y",
      networkLog,
    });
    expect(out.images).toEqual([]);
  });
});

describe("buildCaptureFiles — actionLog video-only 스코핑", () => {
  it("video + actionLog → action-log.json 주입", async () => {
    const out = await buildCaptureFiles({
      captureMode: "video",
      actionLog,
      pageUrl: "https://example.com",
    });
    expect(out.logs.map((l) => l.filename)).toEqual(["logs.html"]);
    expect(out.jsonLogs.map((l) => l.filename)).toContain("action-log.json");
  });

  it("freeform + actionLog → action-log.json 없음 (logs.html도 없음)", async () => {
    const out = await buildCaptureFiles({
      captureMode: "freeform",
      actionLog,
      pageUrl: "https://example.com",
    });
    expect(out.jsonLogs.map((l) => l.filename)).not.toContain("action-log.json");
    expect(out.logs).toEqual([]);
  });

  it("screenshot + actionLog → action-log.json 없음", async () => {
    const out = await buildCaptureFiles({
      captureMode: "screenshot",
      screenshotImage: "data:x",
      actionLog,
      pageUrl: "https://example.com",
    });
    expect(out.jsonLogs.map((l) => l.filename)).not.toContain("action-log.json");
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
