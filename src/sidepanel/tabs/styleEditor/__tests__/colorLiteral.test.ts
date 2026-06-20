import { describe, it, expect } from "vitest";
import { isRenderableColorLiteral } from "../colorLiteral";

describe("isRenderableColorLiteral", () => {
  describe("hex", () => {
    it("3자리", () => {
      expect(isRenderableColorLiteral("#abc")).toBe(true);
      expect(isRenderableColorLiteral("#000")).toBe(true);
      expect(isRenderableColorLiteral("#FFF")).toBe(true);
    });
    it("4자리 (alpha)", () => {
      expect(isRenderableColorLiteral("#abcd")).toBe(true);
      expect(isRenderableColorLiteral("#0000")).toBe(true);
    });
    it("6자리", () => {
      expect(isRenderableColorLiteral("#abcdef")).toBe(true);
      expect(isRenderableColorLiteral("#000000")).toBe(true);
      expect(isRenderableColorLiteral("#FFFFFF")).toBe(true);
    });
    it("8자리 (alpha)", () => {
      expect(isRenderableColorLiteral("#abcdef12")).toBe(true);
      expect(isRenderableColorLiteral("#00000000")).toBe(true);
    });
    it("# 빠지면 거부", () => {
      expect(isRenderableColorLiteral("abcdef")).toBe(false);
      expect(isRenderableColorLiteral("000")).toBe(false);
    });
    it("잘못된 길이 거부", () => {
      expect(isRenderableColorLiteral("#ab")).toBe(false);
      expect(isRenderableColorLiteral("#abcde")).toBe(false);
      expect(isRenderableColorLiteral("#abcdefg")).toBe(false);
      expect(isRenderableColorLiteral("#abcdefghi")).toBe(false);
    });
    it("hex 외 문자 거부", () => {
      expect(isRenderableColorLiteral("#xyz")).toBe(false);
      expect(isRenderableColorLiteral("#zzzzzz")).toBe(false);
    });
  });

  describe("rgb / rgba", () => {
    it("rgb 함수", () => {
      expect(isRenderableColorLiteral("rgb(0, 0, 0)")).toBe(true);
      expect(isRenderableColorLiteral("rgb(255,255,255)")).toBe(true);
      expect(isRenderableColorLiteral("RGB(10, 20, 30)")).toBe(true);
    });
    it("rgba 함수", () => {
      expect(isRenderableColorLiteral("rgba(0, 0, 0, 0.5)")).toBe(true);
      expect(isRenderableColorLiteral("rgba(255, 0, 0, 1)")).toBe(true);
    });
    it("공백 변형", () => {
      expect(isRenderableColorLiteral("rgb (0,0,0)")).toBe(true);
      expect(isRenderableColorLiteral("  rgba(0,0,0,0)  ")).toBe(true);
    });
    it("닫는 괄호 없는 미완성도 일단 true (브라우저가 backgroundColor에서 reject)", () => {
      // 정규식은 prefix만 검사. 사용자가 입력 중이거나 손상돼도 swatch는 빈 색으로 fallback.
      expect(isRenderableColorLiteral("rgb(0,0,0")).toBe(true);
    });
  });

  describe("함수형 색상 (hsl/hwb/oklch/lab/color 등 — 확대)", () => {
    it("hsl / hsla", () => {
      expect(isRenderableColorLiteral("hsl(0, 0%, 0%)")).toBe(true);
      expect(isRenderableColorLiteral("hsl(210 100% 50%)")).toBe(true);
      expect(isRenderableColorLiteral("hsla(0, 0%, 0%, 0.5)")).toBe(true);
    });
    it("hwb / lab / lch / oklab / oklch", () => {
      expect(isRenderableColorLiteral("hwb(0 0% 0%)")).toBe(true);
      expect(isRenderableColorLiteral("lab(50% 40 59.5)")).toBe(true);
      expect(isRenderableColorLiteral("lch(52.2% 72.2 50)")).toBe(true);
      expect(isRenderableColorLiteral("oklab(0.4 0.1 0.1)")).toBe(true);
      expect(isRenderableColorLiteral("oklch(0.7 0.15 180)")).toBe(true);
    });
    it("color() 함수", () => {
      expect(isRenderableColorLiteral("color(display-p3 1 0 0)")).toBe(true);
    });
    it("대소문자·선행 공백 무관", () => {
      expect(isRenderableColorLiteral("HSL(0 0% 0%)")).toBe(true);
      expect(isRenderableColorLiteral("  oklch(0.7 0.1 180)")).toBe(true);
    });
    it("color-mix()는 이번 스코프 제외 (false)", () => {
      expect(isRenderableColorLiteral("color-mix(in srgb, red, blue)")).toBe(false);
    });
  });

  describe("named color", () => {
    it("기본 색상", () => {
      expect(isRenderableColorLiteral("red")).toBe(true);
      expect(isRenderableColorLiteral("blue")).toBe(true);
      expect(isRenderableColorLiteral("white")).toBe(true);
    });
    it("transparent 포함", () => {
      expect(isRenderableColorLiteral("transparent")).toBe(true);
    });
    it("긴 이름", () => {
      expect(isRenderableColorLiteral("dodgerblue")).toBe(true);
      expect(isRenderableColorLiteral("rebeccapurple")).toBe(true);
      expect(isRenderableColorLiteral("lightgoldenrodyellow")).toBe(true);
    });
    it("대소문자 무관", () => {
      expect(isRenderableColorLiteral("RED")).toBe(true);
      expect(isRenderableColorLiteral("DodgerBlue")).toBe(true);
    });
    it("currentcolor 거부 (값 미해결)", () => {
      expect(isRenderableColorLiteral("currentcolor")).toBe(false);
      expect(isRenderableColorLiteral("currentColor")).toBe(false);
    });
    it("CSS-wide 키워드 거부", () => {
      expect(isRenderableColorLiteral("inherit")).toBe(false);
      expect(isRenderableColorLiteral("initial")).toBe(false);
      expect(isRenderableColorLiteral("unset")).toBe(false);
      expect(isRenderableColorLiteral("revert")).toBe(false);
      expect(isRenderableColorLiteral("revert-layer")).toBe(false);
    });
    it("알 수 없는 단어 거부", () => {
      expect(isRenderableColorLiteral("foo")).toBe(false);
      expect(isRenderableColorLiteral("bluish")).toBe(false);
    });
  });

  describe("토큰·기타 거부", () => {
    it("var() 토큰 form 거부", () => {
      expect(isRenderableColorLiteral("var(--color-primary)")).toBe(false);
      expect(isRenderableColorLiteral("var(--color, #fff)")).toBe(false);
    });
    it("빈 문자열 / 공백만 거부", () => {
      expect(isRenderableColorLiteral("")).toBe(false);
      expect(isRenderableColorLiteral("   ")).toBe(false);
    });
    it("숫자·길이 단위 거부", () => {
      expect(isRenderableColorLiteral("12px")).toBe(false);
      expect(isRenderableColorLiteral("0")).toBe(false);
    });
  });
});
