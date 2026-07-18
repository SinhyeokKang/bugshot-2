import { describe, it, expect } from "vitest";
import { mergeAiSectionsPreservingBlocks } from "../mergeAiDraftSections";

describe("mergeAiSectionsPreservingBlocks", () => {
  it("이미지 없는 섹션 → ai 텍스트로 전체 교체", () => {
    const result = mergeAiSectionsPreservingBlocks(
      { description: "기존 텍스트" },
      { description: "AI 새 텍스트" },
      ["description"],
    );
    expect(result).toEqual({ description: "AI 새 텍스트" });
  });

  it("이미지 1개 + ai 텍스트 → 이미지 위, 빈 줄 구분, 텍스트 아래", () => {
    const result = mergeAiSectionsPreservingBlocks(
      { description: "old ![](inline:a1)" },
      { description: "new text" },
      ["description"],
    );
    expect(result).toEqual({
      description: "![](inline:a1)\n\nnew text",
    });
  });

  it("이미지 N개 → 원본 순서대로 상단, 이미지끼리도 빈 줄 구분", () => {
    const result = mergeAiSectionsPreservingBlocks(
      { description: "![](inline:a1) mid ![b](inline:b2)" },
      { description: "new" },
      ["description"],
    );
    expect(result).toEqual({
      description: "![](inline:a1)\n\n![b](inline:b2)\n\nnew",
    });
  });

  it("ai 텍스트 빈 문자열 + 이미지 있음 → 이미지만(말미 빈 줄 없음)", () => {
    const result = mergeAiSectionsPreservingBlocks(
      { description: "![](inline:a1)" },
      { description: "" },
      ["description"],
    );
    expect(result).toEqual({ description: "![](inline:a1)" });
  });

  it("ai에 키 없음(undefined) + prev 이미지 → 이미지만 보존", () => {
    const result = mergeAiSectionsPreservingBlocks(
      { description: "![](inline:a1)" },
      {},
      ["description"],
    );
    expect(result).toEqual({ description: "![](inline:a1)" });
  });

  it("undefined와 빈 문자열을 동일 취급(이미지만)", () => {
    const undefinedCase = mergeAiSectionsPreservingBlocks(
      { description: "![](inline:a1)" },
      {},
      ["description"],
    );
    const emptyCase = mergeAiSectionsPreservingBlocks(
      { description: "![](inline:a1)" },
      { description: "" },
      ["description"],
    );
    expect(undefinedCase).toEqual(emptyCase);
  });

  it("ai에만 있는 새 섹션 → 그대로 채택", () => {
    const result = mergeAiSectionsPreservingBlocks(
      {},
      { notes: "추가 노트" },
      ["notes"],
    );
    expect(result).toEqual({ notes: "추가 노트" });
  });

  it("이미지 ref 없는 텍스트 섹션(orderedList 성격)도 텍스트 교체로 동작", () => {
    const result = mergeAiSectionsPreservingBlocks(
      { stepsToReproduce: "1단계\n2단계" },
      { stepsToReproduce: "접속\n클릭" },
      ["stepsToReproduce"],
    );
    expect(result).toEqual({ stepsToReproduce: "접속\n클릭" });
  });

  it("여러 섹션 혼합 — 이미지 보존/교체/신규를 각각 처리", () => {
    const result = mergeAiSectionsPreservingBlocks(
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
    const result = mergeAiSectionsPreservingBlocks(
      { description: "AI가 채운 현상", notes: "사용자가 쓴 메모" },
      { description: "AI 새 현상" },
      ["description", "notes"],
    );
    expect(result.notes).toBe("사용자가 쓴 메모");
  });

  it("이미지 있는 섹션에서 AI 키 누락 → 이미지 + 기존 텍스트 둘 다 보존", () => {
    const result = mergeAiSectionsPreservingBlocks(
      { notes: "메모 ![](inline:a1)" },
      {},
      ["notes"],
    );
    expect(result.notes).toContain("![](inline:a1)");
    expect(result.notes).toContain("메모");
  });

  it('AI가 ""를 반환 + 그 섹션이 프롬프트에 실림 → 비우기 의도로 인정', () => {
    const result = mergeAiSectionsPreservingBlocks(
      { notes: "사용자가 쓴 메모" },
      { notes: "" },
      ["notes"],
    );
    expect(result.notes).toBe("");
  });

  // 절삭×비우기 충돌: 나노는 responseConstraint가 모든 키를 강제하므로,
  // 절삭으로 못 본 섹션에도 ""를 채워 반환한다 → 삭제로 새면 안 된다.
  it('AI가 ""를 반환 + 그 섹션이 절삭돼 프롬프트에 없음 → 기존 텍스트 보존', () => {
    const result = mergeAiSectionsPreservingBlocks(
      { notes: "사용자가 쓴 메모" },
      { notes: "" },
      [],
    );
    expect(result.notes).toBe("사용자가 쓴 메모");
  });

  // 같은 절삭×덮어쓰기 충돌의 반대편: 못 본 섹션에 AI가 지어낸 텍스트를 채워 보내도
  // 그건 사용자 원문을 개선한 결과가 아니다. 원문이 있으면 손대지 않는다.
  it("절삭된 섹션 + prev에 사용자 원문 있음 → AI 텍스트를 무시하고 원문 보존", () => {
    const result = mergeAiSectionsPreservingBlocks(
      { notes: "사용자가 쓴 메모" },
      { notes: "AI가 지어낸 메모" },
      [],
    );
    expect(result.notes).toBe("사용자가 쓴 메모");
  });

  it("절삭된 섹션 + prev 원문의 inline 이미지도 그대로 보존", () => {
    const result = mergeAiSectionsPreservingBlocks(
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
    const result = mergeAiSectionsPreservingBlocks(
      { description: "![](inline:a1)" },
      { description: "AI 새 본문" },
      [],
    );
    expect(result.description).toBe("![](inline:a1)\n\nAI 새 본문");
  });

  it("프롬프트에 안 실렸지만 prev가 비어있으면(신규 섹션) AI 텍스트 채택", () => {
    const result = mergeAiSectionsPreservingBlocks(
      { notes: "   " },
      { notes: "AI 새 메모" },
      [],
    );
    expect(result.notes).toBe("AI 새 메모");
  });
});

// mergeAiSectionsPreservingImages → …PreservingBlocks 확장 계약.
// 코드블럭은 출처(수동 삽입/직접 타이핑) 무관하게 이미지와 같은 취급으로 보존된다.
describe("mergeAiSectionsPreservingBlocks — 코드블럭 보존", () => {
  const CODE = "```\nGET /api/pay → 500 Internal Server Error\n```";

  // 🔴 회귀 지뢰: 기존 images.length === 0 early-return이 남아 있으면
  // 이미지 없이 코드블럭만 있는 섹션(주 시나리오 — 수동 삽입 후 AI 재생성)에서 블록이 증발한다.
  it("이미지 없는 섹션의 코드블럭도 보존 — AI 산문 아래로", () => {
    const result = mergeAiSectionsPreservingBlocks(
      { description: `기존 산문\n\n${CODE}` },
      { description: "AI 새 산문" },
      ["description"],
    );
    expect(result.description).toBe(`AI 새 산문\n\n${CODE}`);
  });

  it("이미지 + 코드블럭 + AI 텍스트 → 이미지, AI 산문, 블록 순", () => {
    const result = mergeAiSectionsPreservingBlocks(
      { description: `![](inline:a1) 기존\n\n${CODE}` },
      { description: "AI 새 산문" },
      ["description"],
    );
    expect(result.description).toBe(`![](inline:a1)\n\nAI 새 산문\n\n${CODE}`);
  });

  it("코드블럭 N개 → 원본 순서대로 하단 보존", () => {
    const other = "```json\n{\"a\":1}\n```";
    const result = mergeAiSectionsPreservingBlocks(
      { description: `${CODE}\n\n중간 산문\n\n${other}` },
      { description: "AI 새 산문" },
      ["description"],
    );
    expect(result.description).toBe(`AI 새 산문\n\n${CODE}\n\n${other}`);
  });

  // "원문 있음" 판정이 코드블럭을 빼지 않으면, 블록만 있는 섹션이 "절삭된 원문"으로
  // 오인돼 AI 본문이 통째로 버려진다 — 이미지 전용 섹션과 같은 함정.
  it("코드블럭만 있고 산문 없는 섹션(미프롬프트) → AI 텍스트 채택 + 블록 보존", () => {
    const result = mergeAiSectionsPreservingBlocks(
      { description: CODE },
      { description: "AI 새 본문" },
      [],
    );
    expect(result.description).toBe(`AI 새 본문\n\n${CODE}`);
  });

  it("AI 키 누락 → 기존 산문·블록 전부 보존", () => {
    const prev = `사용자 산문\n\n${CODE}`;
    const result = mergeAiSectionsPreservingBlocks(
      { description: prev },
      {},
      ["description"],
    );
    expect(result.description).toBe(prev);
  });

  it("프롬프트 미포함 + prev에 산문 있음 → prev 우선 (기존 가드 유지)", () => {
    const prev = `사용자 산문\n\n${CODE}`;
    const result = mergeAiSectionsPreservingBlocks(
      { description: prev },
      { description: "AI가 지어낸 본문" },
      [],
    );
    expect(result.description).toBe(prev);
  });

  it('AI가 ""를 반환 + 프롬프트에 실림 → 비우기 인정하되 블록은 보존', () => {
    const result = mergeAiSectionsPreservingBlocks(
      { description: `산문\n\n${CODE}` },
      { description: "" },
      ["description"],
    );
    expect(result.description).toBe(CODE);
  });

  it("블록 없는 섹션은 기존 병합과 동일 (이미지 hoist·텍스트 교체 유지)", () => {
    const result = mergeAiSectionsPreservingBlocks(
      { description: "old ![](inline:a1)", notes: "그대로" },
      { description: "new text" },
      ["description"],
    );
    expect(result.description).toBe("![](inline:a1)\n\nnew text");
    expect(result.notes).toBe("그대로");
  });

  // 인젝션 방어: AI가 페이지 통제 문자열을 verbatim 인용하며 미닫힘 fence를 내면, 무해화가
  // 없으면 뒤 코드블럭의 여는 fence가 그 fence의 닫힘으로 해석돼 로그 원문이 산문으로 샌다.
  it("AI 산문의 미닫힘 fence는 4칸 무해화 → 뒤 블록을 삼키지 않음", () => {
    const result = mergeAiSectionsPreservingBlocks(
      { description: `기존\n\n${CODE}` },
      { description: "설명\n```\n페이지 통제 문자열" },
      ["description"],
    );
    expect(result.description).toContain("    ```");
    expect(result.description).toContain(CODE);
    // column-0 fence는 CODE의 열림/닫힘 2개뿐 — aiText fence는 들여쓰기로 fence가 아님.
    const fences = result.description.match(/^```/gm) ?? [];
    expect(fences).toHaveLength(2);
  });
});
