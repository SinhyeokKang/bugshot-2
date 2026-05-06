import { describe, it, expect } from "vitest";
import { expandShortHex, normalizeHexInput } from "../hexUtils";

describe("normalizeHexInput", () => {
  it("6자리에 # prefix 추가", () => {
    expect(normalizeHexInput("abcdef")).toBe("#abcdef");
    expect(normalizeHexInput("FFFFFF")).toBe("#FFFFFF");
  });
  it("8자리에 # prefix 추가", () => {
    expect(normalizeHexInput("abcdef12")).toBe("#abcdef12");
  });
  it("이미 #이면 그대로", () => {
    expect(normalizeHexInput("#abcdef")).toBe("#abcdef");
    expect(normalizeHexInput("#abc")).toBe("#abc");
  });
  it("2/3/4자리는 라이브에서 손대지 않음 (깜빡임 방지)", () => {
    expect(normalizeHexInput("ff")).toBe("ff");
    expect(normalizeHexInput("fff")).toBe("fff");
    expect(normalizeHexInput("f0a8")).toBe("f0a8");
  });
  it("앞뒤 공백 trim", () => {
    expect(normalizeHexInput("  abcdef  ")).toBe("#abcdef");
  });
  it("hex 외 입력은 그대로", () => {
    expect(normalizeHexInput("red")).toBe("red");
    expect(normalizeHexInput("rgba(0,0,0,0)")).toBe("rgba(0,0,0,0)");
  });
});

describe("expandShortHex", () => {
  describe("2자리 그레이스케일 확장", () => {
    it("ff → #ffffff", () => {
      expect(expandShortHex("ff")).toBe("#ffffff");
    });
    it("00 → #000000", () => {
      expect(expandShortHex("00")).toBe("#000000");
    });
    it("0a → #0a0a0a", () => {
      expect(expandShortHex("0a")).toBe("#0a0a0a");
    });
    it("# 포함도 허용", () => {
      expect(expandShortHex("#ff")).toBe("#ffffff");
    });
  });

  describe("3자리 단축 확장", () => {
    it("fff → #ffffff", () => {
      expect(expandShortHex("fff")).toBe("#ffffff");
    });
    it("abc → #aabbcc", () => {
      expect(expandShortHex("abc")).toBe("#aabbcc");
    });
    it("# 포함도 허용", () => {
      expect(expandShortHex("#fff")).toBe("#ffffff");
    });
  });

  describe("4자리 단축 확장 (alpha)", () => {
    it("f0a8 → #ff00aa88", () => {
      expect(expandShortHex("f0a8")).toBe("#ff00aa88");
    });
    it("# 포함도 허용", () => {
      expect(expandShortHex("#f0a8")).toBe("#ff00aa88");
    });
  });

  describe("미확장 케이스 → null", () => {
    it("1자리는 의도 모호 (확장 안 함)", () => {
      expect(expandShortHex("f")).toBeNull();
      expect(expandShortHex("#f")).toBeNull();
    });
    it("5/6/7/8자리는 풀어쓸 필요 없음", () => {
      expect(expandShortHex("abcde")).toBeNull();
      expect(expandShortHex("abcdef")).toBeNull();
      expect(expandShortHex("abcdefgh")).toBeNull();
    });
    it("hex 외 문자는 거부", () => {
      expect(expandShortHex("xx")).toBeNull();
      expect(expandShortHex("zzz")).toBeNull();
    });
    it("빈 문자열", () => {
      expect(expandShortHex("")).toBeNull();
    });
  });
});
