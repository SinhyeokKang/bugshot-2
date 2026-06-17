import { describe, it, expect } from "vitest";
import { mergeAiSectionsPreservingImages } from "../mergeAiDraftSections";

describe("mergeAiSectionsPreservingImages", () => {
  it("이미지 없는 섹션 → ai 텍스트로 전체 교체", () => {
    const result = mergeAiSectionsPreservingImages(
      { description: "기존 텍스트" },
      { description: "AI 새 텍스트" },
    );
    expect(result).toEqual({ description: "AI 새 텍스트" });
  });

  it("이미지 1개 + ai 텍스트 → 이미지 위, 빈 줄 구분, 텍스트 아래", () => {
    const result = mergeAiSectionsPreservingImages(
      { description: "old ![](inline:a1)" },
      { description: "new text" },
    );
    expect(result).toEqual({
      description: "![](inline:a1)\n\nnew text",
    });
  });

  it("이미지 N개 → 원본 순서대로 상단, 이미지끼리도 빈 줄 구분", () => {
    const result = mergeAiSectionsPreservingImages(
      { description: "![](inline:a1) mid ![b](inline:b2)" },
      { description: "new" },
    );
    expect(result).toEqual({
      description: "![](inline:a1)\n\n![b](inline:b2)\n\nnew",
    });
  });

  it("ai 텍스트 빈 문자열 + 이미지 있음 → 이미지만(말미 빈 줄 없음)", () => {
    const result = mergeAiSectionsPreservingImages(
      { description: "![](inline:a1)" },
      { description: "" },
    );
    expect(result).toEqual({ description: "![](inline:a1)" });
  });

  it("ai에 키 없음(undefined) + prev 이미지 → 이미지만 보존", () => {
    const result = mergeAiSectionsPreservingImages(
      { description: "![](inline:a1)" },
      {},
    );
    expect(result).toEqual({ description: "![](inline:a1)" });
  });

  it("undefined와 빈 문자열을 동일 취급(이미지만)", () => {
    const undefinedCase = mergeAiSectionsPreservingImages(
      { description: "![](inline:a1)" },
      {},
    );
    const emptyCase = mergeAiSectionsPreservingImages(
      { description: "![](inline:a1)" },
      { description: "" },
    );
    expect(undefinedCase).toEqual(emptyCase);
  });

  it("ai에만 있는 새 섹션 → 그대로 채택", () => {
    const result = mergeAiSectionsPreservingImages(
      {},
      { notes: "추가 노트" },
    );
    expect(result).toEqual({ notes: "추가 노트" });
  });

  it("이미지 ref 없는 텍스트 섹션(orderedList 성격)도 텍스트 교체로 동작", () => {
    const result = mergeAiSectionsPreservingImages(
      { stepsToReproduce: "1단계\n2단계" },
      { stepsToReproduce: "접속\n클릭" },
    );
    expect(result).toEqual({ stepsToReproduce: "접속\n클릭" });
  });

  it("여러 섹션 혼합 — 이미지 보존/교체/신규를 각각 처리", () => {
    const result = mergeAiSectionsPreservingImages(
      {
        description: "old ![](inline:a1)",
        expectedResult: "old expected",
      },
      {
        description: "new desc",
        expectedResult: "new expected",
        notes: "new notes",
      },
    );
    expect(result).toEqual({
      description: "![](inline:a1)\n\nnew desc",
      expectedResult: "new expected",
      notes: "new notes",
    });
  });
});
