import { describe, it, expect } from "vitest";
import { mergeAiSectionsPreservingBlocks } from "../mergeAiDraftSections";

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
});
