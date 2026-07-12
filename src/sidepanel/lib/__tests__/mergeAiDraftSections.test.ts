import { describe, it, expect } from "vitest";
import { mergeAiSectionsPreservingImages } from "../mergeAiDraftSections";

describe("mergeAiSectionsPreservingImages", () => {
  it("이미지 없는 섹션 → ai 텍스트로 전체 교체", () => {
    const result = mergeAiSectionsPreservingImages(
      { description: "기존 텍스트" },
      { description: "AI 새 텍스트" },
      ["description"],
    );
    expect(result).toEqual({ description: "AI 새 텍스트" });
  });

  it("이미지 1개 + ai 텍스트 → 이미지 위, 빈 줄 구분, 텍스트 아래", () => {
    const result = mergeAiSectionsPreservingImages(
      { description: "old ![](inline:a1)" },
      { description: "new text" },
      ["description"],
    );
    expect(result).toEqual({
      description: "![](inline:a1)\n\nnew text",
    });
  });

  it("이미지 N개 → 원본 순서대로 상단, 이미지끼리도 빈 줄 구분", () => {
    const result = mergeAiSectionsPreservingImages(
      { description: "![](inline:a1) mid ![b](inline:b2)" },
      { description: "new" },
      ["description"],
    );
    expect(result).toEqual({
      description: "![](inline:a1)\n\n![b](inline:b2)\n\nnew",
    });
  });

  it("ai 텍스트 빈 문자열 + 이미지 있음 → 이미지만(말미 빈 줄 없음)", () => {
    const result = mergeAiSectionsPreservingImages(
      { description: "![](inline:a1)" },
      { description: "" },
      ["description"],
    );
    expect(result).toEqual({ description: "![](inline:a1)" });
  });

  it("ai에 키 없음(undefined) + prev 이미지 → 이미지만 보존", () => {
    const result = mergeAiSectionsPreservingImages(
      { description: "![](inline:a1)" },
      {},
      ["description"],
    );
    expect(result).toEqual({ description: "![](inline:a1)" });
  });

  it("undefined와 빈 문자열을 동일 취급(이미지만)", () => {
    const undefinedCase = mergeAiSectionsPreservingImages(
      { description: "![](inline:a1)" },
      {},
      ["description"],
    );
    const emptyCase = mergeAiSectionsPreservingImages(
      { description: "![](inline:a1)" },
      { description: "" },
      ["description"],
    );
    expect(undefinedCase).toEqual(emptyCase);
  });

  it("ai에만 있는 새 섹션 → 그대로 채택", () => {
    const result = mergeAiSectionsPreservingImages(
      {},
      { notes: "추가 노트" },
      ["notes"],
    );
    expect(result).toEqual({ notes: "추가 노트" });
  });

  it("이미지 ref 없는 텍스트 섹션(orderedList 성격)도 텍스트 교체로 동작", () => {
    const result = mergeAiSectionsPreservingImages(
      { stepsToReproduce: "1단계\n2단계" },
      { stepsToReproduce: "접속\n클릭" },
      ["stepsToReproduce"],
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
      ["description", "expectedResult", "notes"],
    );
    expect(result).toEqual({
      description: "![](inline:a1)\n\nnew desc",
      expectedResult: "new expected",
      notes: "new notes",
    });
  });

  // 회귀 재현: AI가 섹션 키를 누락하면 setDraft가 사용자 텍스트를 통째로 날렸다.
  it("AI가 키를 누락한 섹션 → 기존 텍스트 보존 (무고지 삭제 방지)", () => {
    const result = mergeAiSectionsPreservingImages(
      { description: "AI가 채운 현상", notes: "사용자가 쓴 메모" },
      { description: "AI 새 현상" },
      ["description", "notes"],
    );
    expect(result.notes).toBe("사용자가 쓴 메모");
  });

  it("이미지 있는 섹션에서 AI 키 누락 → 이미지 + 기존 텍스트 둘 다 보존", () => {
    const result = mergeAiSectionsPreservingImages(
      { notes: "메모 ![](inline:a1)" },
      {},
      ["notes"],
    );
    expect(result.notes).toContain("![](inline:a1)");
    expect(result.notes).toContain("메모");
  });

  it('AI가 ""를 반환 + 그 섹션이 프롬프트에 실림 → 비우기 의도로 인정', () => {
    const result = mergeAiSectionsPreservingImages(
      { notes: "사용자가 쓴 메모" },
      { notes: "" },
      ["notes"],
    );
    expect(result.notes).toBe("");
  });

  // 절삭×비우기 충돌: 나노는 responseConstraint가 모든 키를 강제하므로,
  // 절삭으로 못 본 섹션에도 ""를 채워 반환한다 → 삭제로 새면 안 된다.
  it('AI가 ""를 반환 + 그 섹션이 절삭돼 프롬프트에 없음 → 기존 텍스트 보존', () => {
    const result = mergeAiSectionsPreservingImages(
      { notes: "사용자가 쓴 메모" },
      { notes: "" },
      [],
    );
    expect(result.notes).toBe("사용자가 쓴 메모");
  });

  // 같은 절삭×덮어쓰기 충돌의 반대편: 못 본 섹션에 AI가 지어낸 텍스트를 채워 보내도
  // 그건 사용자 원문을 개선한 결과가 아니다. 원문이 있으면 손대지 않는다.
  it("절삭된 섹션 + prev에 사용자 원문 있음 → AI 텍스트를 무시하고 원문 보존", () => {
    const result = mergeAiSectionsPreservingImages(
      { notes: "사용자가 쓴 메모" },
      { notes: "AI가 지어낸 메모" },
      [],
    );
    expect(result.notes).toBe("사용자가 쓴 메모");
  });

  it("절삭된 섹션 + prev 원문의 inline 이미지도 그대로 보존", () => {
    const result = mergeAiSectionsPreservingImages(
      { notes: "메모 ![](inline:a1)" },
      { notes: "AI가 지어낸 메모" },
      [],
    );
    expect(result.notes).toBe("메모 ![](inline:a1)");
  });

  // 회귀: "실린 섹션" 판정은 stripInlineImageRefs 후 기준이라, 이미지만 있고 텍스트가
  // 없는 섹션은 프롬프트에 안 실린다. 원문 보호 가드가 이걸 "절삭된 원문"으로 오인하면
  // AI가 새로 써준 본문을 통째로 버린다 — 이미지 전용 섹션은 정상 병합 경로여야 한다.
  it("이미지만 있고 텍스트 없는 섹션 → 이미지 보존 + AI 텍스트 채택", () => {
    const result = mergeAiSectionsPreservingImages(
      { description: "![](inline:a1)" },
      { description: "AI 새 본문" },
      [],
    );
    expect(result.description).toBe("![](inline:a1)\n\nAI 새 본문");
  });

  it("프롬프트에 안 실렸지만 prev가 비어있으면(신규 섹션) AI 텍스트 채택", () => {
    const result = mergeAiSectionsPreservingImages(
      { notes: "   " },
      { notes: "AI 새 메모" },
      [],
    );
    expect(result.notes).toBe("AI 새 메모");
  });
});
