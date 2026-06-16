import { describe, expect, it } from "vitest";
import { guessUploadMime } from "../uploadMime";

describe("guessUploadMime", () => {
  it("이미지 타입", () => {
    expect(guessUploadMime("a.webp")).toBe("image/webp");
    expect(guessUploadMime("a.png")).toBe("image/png");
    expect(guessUploadMime("a.jpg")).toBe("image/jpeg");
    expect(guessUploadMime("a.jpeg")).toBe("image/jpeg");
  });
  it("영상 타입", () => {
    expect(guessUploadMime("a.webm")).toBe("video/webm");
    expect(guessUploadMime("a.mp4")).toBe("video/mp4");
  });
  it("문서 타입", () => {
    expect(guessUploadMime("logs.html")).toBe("text/html");
    expect(guessUploadMime("a.md")).toBe("text/markdown");
  });
  it("미지원 확장자는 octet-stream", () => {
    expect(guessUploadMime("a.bin")).toBe("application/octet-stream");
  });
});
