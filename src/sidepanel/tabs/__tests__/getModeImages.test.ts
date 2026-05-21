import { describe, it, expect } from "vitest";
import { getModeImages } from "../AiDraftDialog";

type ImageStore = {
  screenshotAnnotated: string | null;
  screenshotRaw: string | null;
  beforeImage: string | null;
  afterImage: string | null;
};

const EMPTY: ImageStore = {
  screenshotAnnotated: null,
  screenshotRaw: null,
  beforeImage: null,
  afterImage: null,
};

describe("getModeImages", () => {
  it("screenshot 모드 + screenshotAnnotated 있음 → [annotated] 반환 (raw 무시)", () => {
    const result = getModeImages(
      {
        ...EMPTY,
        screenshotAnnotated: "data:annotated",
        screenshotRaw: "data:raw",
      },
      "screenshot",
    );
    expect(result).toEqual(["data:annotated"]);
  });

  it("screenshot 모드 + annotated null + raw 있음 → [raw] 반환", () => {
    const result = getModeImages(
      { ...EMPTY, screenshotRaw: "data:raw" },
      "screenshot",
    );
    expect(result).toEqual(["data:raw"]);
  });

  it("screenshot 모드 + 둘 다 null → undefined", () => {
    const result = getModeImages(EMPTY, "screenshot");
    expect(result).toBeUndefined();
  });

  it("element 모드 + [null, null] → undefined", () => {
    const result = getModeImages(EMPTY, "element");
    expect(result).toBeUndefined();
  });

  it("element 모드 + [before, null] → [before]", () => {
    const result = getModeImages(
      { ...EMPTY, beforeImage: "data:before" },
      "element",
    );
    expect(result).toEqual(["data:before"]);
  });

  it("element 모드 + [null, after] → [after]", () => {
    const result = getModeImages(
      { ...EMPTY, afterImage: "data:after" },
      "element",
    );
    expect(result).toEqual(["data:after"]);
  });

  it("element 모드 + [before, after] → [before, after]", () => {
    const result = getModeImages(
      {
        ...EMPTY,
        beforeImage: "data:before",
        afterImage: "data:after",
      },
      "element",
    );
    expect(result).toEqual(["data:before", "data:after"]);
  });

  it("video 모드 → undefined (다른 모드 이미지 무시)", () => {
    const result = getModeImages(
      {
        screenshotAnnotated: "data:a",
        screenshotRaw: "data:r",
        beforeImage: "data:b",
        afterImage: "data:af",
      },
      "video",
    );
    expect(result).toBeUndefined();
  });

  it("freeform 모드 → undefined (다른 모드 이미지 무시)", () => {
    const result = getModeImages(
      {
        screenshotAnnotated: "data:a",
        screenshotRaw: "data:r",
        beforeImage: "data:b",
        afterImage: "data:af",
      },
      "freeform",
    );
    expect(result).toBeUndefined();
  });
});
