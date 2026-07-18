import { describe, it, expect } from "vitest";
import {
  extractCodeBlocks,
  stripCodeBlocks,
  stripPreservedContent,
} from "../markdownBlocks";

describe("extractCodeBlocks", () => {
  it("들여쓰기 0의 fenced block을 등장 순서대로 추출", () => {
    const md = "산문 A\n\n```\ncode 1\n```\n\n산문 B\n\n```json\n{\"a\":1}\n```";
    expect(extractCodeBlocks(md)).toEqual([
      "```\ncode 1\n```",
      '```json\n{"a":1}\n```',
    ]);
  });

  it("코드블럭 없는 마크다운 → 빈 배열", () => {
    expect(extractCodeBlocks("그냥 산문")).toEqual([]);
  });

  it("4칸 들여쓴 내부 fence는 추출하지 않음 (neutralizeFences 산출물)", () => {
    const md = "```\nbody\n    ```\n    inner\n    ```\nrest\n```";
    const blocks = extractCodeBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toBe(md);
  });

  it("미닫힘 fence는 블록으로 추출하지 않음 (텍스트 취급)", () => {
    expect(extractCodeBlocks("산문\n\n```\n열려만 있음")).toEqual([]);
  });
});

describe("stripCodeBlocks", () => {
  it("코드블럭을 제거하고 산문은 남긴다", () => {
    const md = "산문 A\n\n```\ncode\n```\n\n산문 B";
    const out = stripCodeBlocks(md);
    expect(out).toContain("산문 A");
    expect(out).toContain("산문 B");
    expect(out).not.toContain("code");
    expect(out).not.toContain("```");
  });
});

describe("stripPreservedContent", () => {
  it("이미지 ref + 코드블럭을 모두 제거한 산문만 남긴다", () => {
    const md = "![](inline:a1)\n\n사용자 산문\n\n```\nGET /api → 500\n```";
    expect(stripPreservedContent(md)).toBe("사용자 산문");
  });

  // .trim() 계약: selectDraftSections가 truthy로만 판정하므로 "\n\n"을 남기면
  // 빈 섹션이 프롬프트에 실리고 merge 보호 가드가 풀린다.
  it("코드블럭만 있는 섹션 → 빈 문자열 (\"\\n\\n\" 아님)", () => {
    expect(stripPreservedContent("```\ncode only\n```")).toBe("");
  });

  it("이미지만 있는 섹션 → 빈 문자열", () => {
    expect(stripPreservedContent("![](inline:a1)")).toBe("");
  });

  it("이미지 + 코드블럭만 있는 섹션 → 빈 문자열", () => {
    expect(stripPreservedContent("![](inline:a1)\n\n```\ncode\n```")).toBe("");
  });

  it("연속 빈 줄은 2개로 접힌다 (stripInlineImageRefs 계약 상속)", () => {
    const md = "위 산문\n\n```\ncode\n```\n\n아래 산문";
    expect(stripPreservedContent(md)).toBe("위 산문\n\n아래 산문");
  });
});
