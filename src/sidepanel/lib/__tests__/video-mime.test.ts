import { describe, expect, it } from "vitest";
import {
  pickVideoRecorderMime,
  recordingFilename,
  videoMimeToExt,
} from "../video-mime";

describe("videoMimeToExt", () => {
  it("video/mp4 → .mp4", () => {
    expect(videoMimeToExt("video/mp4")).toBe(".mp4");
  });

  it("video/mp4 with codecs → .mp4", () => {
    expect(videoMimeToExt('video/mp4;codecs="avc1.42E01E,mp4a.40.2"')).toBe(".mp4");
  });

  it("video/webm → .webm", () => {
    expect(videoMimeToExt("video/webm")).toBe(".webm");
  });

  it("video/webm with codecs → .webm", () => {
    expect(videoMimeToExt("video/webm;codecs=vp9")).toBe(".webm");
  });

  it("empty mime defaults to .webm (legacy blobs)", () => {
    expect(videoMimeToExt("")).toBe(".webm");
  });

  it("unknown mime defaults to .webm", () => {
    expect(videoMimeToExt("video/x-matroska")).toBe(".webm");
  });

  it("case-insensitive", () => {
    expect(videoMimeToExt("VIDEO/MP4")).toBe(".mp4");
    expect(videoMimeToExt("Video/Webm;Codecs=Vp9")).toBe(".webm");
  });
});

describe("recordingFilename", () => {
  it("derives filename from mp4 mime", () => {
    expect(recordingFilename("video/mp4")).toBe("recording.mp4");
  });

  it("derives filename from webm mime", () => {
    expect(recordingFilename("video/webm;codecs=vp9")).toBe("recording.webm");
  });

  it("defaults to recording.webm for empty mime (legacy)", () => {
    expect(recordingFilename("")).toBe("recording.webm");
  });
});

describe("pickVideoRecorderMime", () => {
  const supported = (whitelist: string[]) => (mime: string) =>
    whitelist.includes(mime);

  it("picks mp4 first when supported", () => {
    expect(
      pickVideoRecorderMime(
        supported([
          'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
          "video/webm;codecs=vp9",
          "video/webm",
        ]),
      ),
    ).toBe('video/mp4;codecs="avc1.42E01E,mp4a.40.2"');
  });

  it("falls back to plain video/mp4 when codec-specific not supported", () => {
    expect(
      pickVideoRecorderMime(
        supported(["video/mp4", "video/webm"]),
      ),
    ).toBe("video/mp4");
  });

  it("falls back to webm when mp4 not supported", () => {
    expect(
      pickVideoRecorderMime(
        supported(["video/webm;codecs=vp9", "video/webm"]),
      ),
    ).toBe("video/webm;codecs=vp9");
  });

  it("returns empty string when nothing supported", () => {
    expect(pickVideoRecorderMime(() => false)).toBe("");
  });

  it("respects priority order: mp4 codec-specific > mp4 bare > webm vp9 > webm vp8 > webm bare", () => {
    // Only the last two supported: should prefer vp9 over vp8 (priority order).
    expect(
      pickVideoRecorderMime(
        supported(["video/webm;codecs=vp9", "video/webm;codecs=vp8"]),
      ),
    ).toBe("video/webm;codecs=vp9");
  });
});
