import { describe, it, expect } from "vitest";
import {
  applyMultiplier,
  finalizeLiveValue,
  finalizeValue,
  rightHintText,
} from "../valueFormat";

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

  describe("unitless length prop carve-out", () => {
    it("line-height unitless는 px 부착 안 함", () => {
      expect(finalizeValue("length", "1.5", "line-height")).toBe("1.5");
      expect(finalizeValue("length", "2", "line-height")).toBe("2");
    });
    it("line-height에 단위 있으면 그대로", () => {
      expect(finalizeValue("length", "24px", "line-height")).toBe("24px");
    });
    it("일반 length prop은 여전히 px 부착", () => {
      expect(finalizeValue("length", "16", "padding-top")).toBe("16px");
      expect(finalizeValue("length", "16")).toBe("16px");
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

describe("finalizeLiveValue", () => {
  it("color 단축 hex(2/3/4자리)는 라이브에서 확장하지 않음(깜빡임 방지)", () => {
    expect(finalizeLiveValue("color", "ab")).toBe("ab");
    expect(finalizeLiveValue("color", "abc")).toBe("abc");
    expect(finalizeLiveValue("color", "f0a8")).toBe("f0a8");
  });
  it("color 6/8자리 hex는 라이브에서도 # 부착", () => {
    expect(finalizeLiveValue("color", "abcdef")).toBe("#abcdef");
  });
  it("commit용 finalizeValue는 단축 hex 확장(대조)", () => {
    expect(finalizeValue("color", "abc")).toBe("#aabbcc");
  });
  it("length는 라이브에서도 finalizeValue와 동일(px 부착)", () => {
    expect(finalizeLiveValue("length", "16")).toBe("16px");
    expect(finalizeLiveValue("length", "1.5", "line-height")).toBe("1.5");
  });
});

describe("applyMultiplier", () => {
  it("단위값에 multiplier를 곱한다", () => {
    expect(applyMultiplier("8px", 2)).toBe("16px");
    expect(applyMultiplier("1.5rem", 2)).toBe("3rem");
    expect(applyMultiplier("10", 3)).toBe("30");
  });
  it("multiplier 없으면 raw 그대로", () => {
    expect(applyMultiplier("8px", undefined)).toBe("8px");
  });
  it("raw 없으면 undefined", () => {
    expect(applyMultiplier(undefined, 2)).toBeUndefined();
  });
  it("비단순값(calc 등)은 그대로", () => {
    expect(applyMultiplier("calc(100% - 8px)", 2)).toBe("calc(100% - 8px)");
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

  describe("length/number 직접값 — computed 유지", () => {
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

  describe("length/number 토큰 — 원시값 우선(stale computed 회귀 방지)", () => {
    // computed(selection.computedStyles)는 편집 전 baseline에 고정돼 토큰 변경 시
    // stale하다. 토큰 참조가 있으면 토큰 정의값을 보여줘 즉시 갱신되게 한다.
    it("length 토큰 원시값 표시 (stale computed 무시)", () => {
      expect(rightHintText("length", "8px", "24px", false)).toBe("24px");
    });
    it("length 토큰 compact는 px 축약", () => {
      expect(rightHintText("length", "8px", "24px", true)).toBe("24");
    });
    it("number 토큰 원시값", () => {
      expect(rightHintText("number", "1", "2", false)).toBe("2");
    });
    it("토큰값 미해결(undefined)이면 computed 폴백", () => {
      expect(rightHintText("length", "8px", undefined, false)).toBe("8px");
    });
  });

  it("카테고리 없으면 null", () => {
    expect(rightHintText(undefined, "x", undefined, false)).toBeNull();
  });
});
