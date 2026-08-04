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

  it("element 모드 + 복수 styleElements → 요소별 before/after 순서로 반환", () => {
    const result = getModeImages(EMPTY, "element", [
      {
        selector: "button.cta",
        tagName: "button",
        frameId: 0,
        diffs: [],
        beforeImage: "data:before-button",
        afterImage: "data:after-button",
      },
      {
        selector: "div.card",
        tagName: "div",
        frameId: 0,
        diffs: [],
        beforeImage: "data:before-card",
        afterImage: "data:after-card",
      },
    ]);

    expect(result).toEqual([
      "data:before-button",
      "data:after-button",
      "data:before-card",
      "data:after-card",
    ]);
  });

  it("element 모드 legacy 경로는 store before/after로 폴백", () => {
    expect(
      getModeImages(
        {
          ...EMPTY,
          beforeImage: "data:before",
          afterImage: "data:after",
        },
        "element",
        undefined,
      ),
    ).toEqual(["data:before", "data:after"]);
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

// AI 초안에도 주석본이 나가야 한다 — 사용자가 손으로 지목한 곳을 모델이 못 보면 초안 품질이 떨어진다.
// screenshot 분기는 이미 annotated ?? raw이고, element 분기만 규칙이 갈려 있었다.
describe("getModeImages — element 주석본(annotated ?? raw)", () => {
  const EMPTY_ANN = {
    ...EMPTY,
    beforeAnnotated: null,
    afterAnnotated: null,
  };

  it("store 폴백 경로에서 주석이 있으면 주석본을 반환한다", () => {
    expect(
      getModeImages(
        {
          ...EMPTY_ANN,
          beforeImage: "data:before",
          afterImage: "data:after",
          beforeAnnotated: "data:before-ann",
          afterAnnotated: "data:after-ann",
        },
        "element",
      ),
    ).toEqual(["data:before-ann", "data:after-ann"]);
  });

  it("한쪽만 주석이면 그쪽만 주석본이다", () => {
    expect(
      getModeImages(
        {
          ...EMPTY_ANN,
          beforeImage: "data:before",
          afterImage: "data:after",
          afterAnnotated: "data:after-ann",
        },
        "element",
      ),
    ).toEqual(["data:before", "data:after-ann"]);
  });

  it("raw가 없고 주석만 있어도 반환한다", () => {
    expect(
      getModeImages({ ...EMPTY_ANN, beforeAnnotated: "data:only-ann" }, "element"),
    ).toEqual(["data:only-ann"]);
  });

  it("주석이 없으면 원본을 반환한다 (기존 동작 불변)", () => {
    expect(
      getModeImages(
        { ...EMPTY_ANN, beforeImage: "data:before", afterImage: "data:after" },
        "element",
      ),
    ).toEqual(["data:before", "data:after"]);
  });

  it("screenshot 모드는 element 주석 필드를 무시한다", () => {
    expect(
      getModeImages(
        { ...EMPTY_ANN, beforeAnnotated: "data:before-ann" },
        "screenshot",
      ),
    ).toBeUndefined();
  });
});
