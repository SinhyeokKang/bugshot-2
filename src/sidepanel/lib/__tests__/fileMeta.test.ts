import { describe, expect, it } from "vitest";
import { fileCategory, fileExtLabel } from "../fileMeta";

describe("fileCategory — MIME 우선 분류", () => {
  it("image/* → image", () => {
    expect(fileCategory("image/png", "a.png")).toBe("image");
  });

  it("video/* → video", () => {
    expect(fileCategory("video/mp4", "a.mp4")).toBe("video");
  });

  it("audio/* → audio", () => {
    expect(fileCategory("audio/mpeg", "a.mp3")).toBe("audio");
  });

  it("application/pdf → pdf", () => {
    expect(fileCategory("application/pdf", "a.pdf")).toBe("pdf");
  });

  it("application/zip → archive", () => {
    expect(fileCategory("application/zip", "a.zip")).toBe("archive");
  });

  it("text/* → text", () => {
    expect(fileCategory("text/plain", "a.txt")).toBe("text");
  });

  it("미상 MIME + 확장자 없음 → file", () => {
    expect(fileCategory("application/octet-stream", "blob")).toBe("file");
  });
});

describe("fileCategory — contentType 비면 확장자 폴백", () => {
  it("빈 contentType + .pdf → pdf", () => {
    expect(fileCategory("", "report.pdf")).toBe("pdf");
  });

  it("빈 contentType + .zip → archive", () => {
    expect(fileCategory("", "bundle.zip")).toBe("archive");
  });

  it("빈 contentType + 확장자 없음 → file", () => {
    expect(fileCategory("", "README")).toBe("file");
  });
});

describe("fileExtLabel — 확장자 라벨", () => {
  it("확장자를 대문자로", () => {
    expect(fileExtLabel("report.pdf", "application/pdf")).toBe("PDF");
  });

  it("대소문자 섞여도 대문자 정규화", () => {
    expect(fileExtLabel("photo.JPeg", "image/jpeg")).toBe("JPEG");
  });

  it("복합 확장자는 마지막 조각", () => {
    expect(fileExtLabel("archive.tar.gz", "application/gzip")).toBe("GZ");
  });

  it("확장자 없으면 FILE 폴백", () => {
    expect(fileExtLabel("README", "text/plain")).toBe("FILE");
  });
});
