import { describe, expect, it } from "vitest";
import { imageExtFromDataUrl } from "../downloadCapture";

describe("imageExtFromDataUrl", () => {
  it("webp dataURL → webp", () => {
    expect(imageExtFromDataUrl("data:image/webp;base64,AAAA")).toBe("webp");
  });

  it("png dataURL → png", () => {
    expect(imageExtFromDataUrl("data:image/png;base64,AAAA")).toBe("png");
  });

  it("jpeg → jpg", () => {
    expect(imageExtFromDataUrl("data:image/jpeg;base64,AAAA")).toBe("jpg");
  });

  it("svg+xml → svg", () => {
    expect(imageExtFromDataUrl("data:image/svg+xml,<svg/>")).toBe("svg");
  });

  it("non-image or malformed dataURL falls back to webp", () => {
    expect(imageExtFromDataUrl("not-a-data-url")).toBe("webp");
    expect(imageExtFromDataUrl("data:text/plain,hi")).toBe("webp");
  });

  it("is case-insensitive on the mime subtype", () => {
    expect(imageExtFromDataUrl("data:image/PNG;base64,AAAA")).toBe("png");
  });
});
