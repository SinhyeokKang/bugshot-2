import { describe, it, expect } from "vitest";
import { finalizeValue, rightHintText } from "../valueFormat";

describe("finalizeValue", () => {
  describe("color", () => {
    it("3자리 단축 hex 확장", () => {
      expect(finalizeValue("color", "abc")).toBe("#aabbcc");
      expect(finalizeValue("color", "#abc")).toBe("#aabbcc");
    });
    it("4자리 단축 hex(alpha) 확장", () => {
      expect(finalizeValue("color", "f0a8")).toBe("#ff00aa88");
    });
    it("6/8자리 hex는 # 부착만", () => {
      expect(finalizeValue("color", "abcdef")).toBe("#abcdef");
      expect(finalizeValue("color", "#abcdef")).toBe("#abcdef");
    });
    it("함수형 색상은 통과", () => {
      expect(finalizeValue("color", "hsl(0 0% 0%)")).toBe("hsl(0 0% 0%)");
      expect(finalizeValue("color", "rgb(0,0,0)")).toBe("rgb(0,0,0)");
    });
  });

  describe("length 자동 px", () => {
    it("정수 → px", () => {
      expect(finalizeValue("length", "16")).toBe("16px");
    });
    it("음수 → px", () => {
      expect(finalizeValue("length", "-8")).toBe("-8px");
    });
    it("선행점 소수(.5) → px", () => {
      expect(finalizeValue("length", ".5")).toBe(".5px");
    });
    it("0 → 0px", () => {
      expect(finalizeValue("length", "0")).toBe("0px");
    });
    it("이미 px면 이중 부착 안 함", () => {
      expect(finalizeValue("length", "16px")).toBe("16px");
    });
    it("calc()는 통과(px 오염 금지)", () => {
      expect(finalizeValue("length", "calc(1px + 2px)")).toBe("calc(1px + 2px)");
    });
    it("var()는 통과(px 오염 금지)", () => {
      expect(finalizeValue("length", "var(--x)")).toBe("var(--x)");
    });
    it("부분 입력(끝점)은 그대로 통과", () => {
      expect(finalizeValue("length", "1.")).toBe("1.");
    });
  });

  describe("기타", () => {
    it("카테고리 없으면 그대로", () => {
      expect(finalizeValue(undefined, "block")).toBe("block");
    });
    it("빈 문자열은 그대로", () => {
      expect(finalizeValue("length", "")).toBe("");
      expect(finalizeValue("color", "")).toBe("");
    });
  });
});

describe("rightHintText", () => {
  describe("color/image 토큰 — 원시값", () => {
    it("color 토큰 원시값 표시 (비-compact)", () => {
      expect(rightHintText("color", "", "hsl(0 0% 0%)", false)).toBe(
        "hsl(0 0% 0%)",
      );
    });
    it("color 토큰 원시값 표시 (compact 포함 항상)", () => {
      expect(rightHintText("color", "", "hsl(0 0% 0%)", true)).toBe(
        "hsl(0 0% 0%)",
      );
    });
    it("image 토큰 원시값", () => {
      expect(rightHintText("image", "", "url(a.png)", false)).toBe("url(a.png)");
    });
    it("토큰값 미해결(undefined)이면 null", () => {
      expect(rightHintText("color", "", undefined, false)).toBeNull();
    });
  });

  describe("length/number — computed 유지", () => {
    it("length computed 표시", () => {
      expect(rightHintText("length", "16px", undefined, false)).toBe("16px");
    });
    it("length compact는 px 축약", () => {
      expect(rightHintText("length", "16px", undefined, true)).toBe("16");
    });
    it("number computed 표시", () => {
      expect(rightHintText("number", "1.5", undefined, false)).toBe("1.5");
    });
    it("computed 비면 null", () => {
      expect(rightHintText("length", "", undefined, false)).toBeNull();
    });
    it("computed가 토큰값이면 null", () => {
      expect(rightHintText("length", "var(--x)", undefined, false)).toBeNull();
    });
  });

  it("카테고리 없으면 null", () => {
    expect(rightHintText(undefined, "x", undefined, false)).toBeNull();
  });
});
