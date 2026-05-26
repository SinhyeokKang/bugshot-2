import { describe, expect, it, vi } from "vitest";
import type { ConsoleLog } from "@/types/console";
import type { NetworkLog } from "@/types/network";

vi.stubGlobal("chrome", {
  runtime: { getManifest: () => ({ version: "1.0.0" }) },
});

vi.mock("@/store/blob-db", () => ({
  blobToDataUrl: (blob: Blob) =>
    Promise.resolve(`data:${blob.type || "application/octet-stream"};base64,FAKE`),
}));

import { buildCaptureFiles } from "../buildCaptureFiles";

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

  it("screenshot + networkLog + consoleLog → logs 둘 다", async () => {
    const out = await buildCaptureFiles({
      captureMode: "screenshot",
      screenshotImage: "data:x",
      networkLog,
      consoleLog,
    });
    expect(out.logs.map((l) => l.filename)).toEqual([
      "network-log.har",
      "console-log.json",
    ]);
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

  it("video + networkLog + consoleLog → logs 둘 다", async () => {
    const out = await buildCaptureFiles({
      captureMode: "video",
      networkLog,
      consoleLog,
    });
    expect(out.logs.map((l) => l.filename)).toEqual([
      "network-log.har",
      "console-log.json",
    ]);
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

describe("buildCaptureFiles — freeform mode", () => {
  it("freeform은 video 무시 (logs만)", async () => {
    const blob = new Blob([new Uint8Array([0])], { type: "video/mp4" });
    const out = await buildCaptureFiles({
      captureMode: "freeform",
      videoBlob: blob,
      networkLog,
    });
    expect(out.video).toBeUndefined();
    expect(out.logs.map((l) => l.filename)).toEqual(["network-log.har"]);
  });

  it("freeform + consoleLog만", async () => {
    const out = await buildCaptureFiles({
      captureMode: "freeform",
      consoleLog,
    });
    expect(out.logs.map((l) => l.filename)).toEqual(["console-log.json"]);
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
