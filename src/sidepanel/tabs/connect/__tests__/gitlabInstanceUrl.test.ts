import { describe, expect, it } from "vitest";
import { normalizeInstanceUrl } from "../gitlabInstanceUrl";

describe("normalizeInstanceUrl", () => {
  it("빈 값 / 공백 → https://gitlab.com 폴백", () => {
    expect(normalizeInstanceUrl("")).toBe("https://gitlab.com");
    expect(normalizeInstanceUrl("   ")).toBe("https://gitlab.com");
  });

  it("trailing slash 제거", () => {
    expect(normalizeInstanceUrl("https://gitlab.com/")).toBe(
      "https://gitlab.com",
    );
    expect(normalizeInstanceUrl("https://gitlab.example.com///")).toBe(
      "https://gitlab.example.com",
    );
  });

  it("스킴 없는 입력은 https:// 부착", () => {
    expect(normalizeInstanceUrl("gitlab.example.com")).toBe(
      "https://gitlab.example.com",
    );
  });

  it("gitlab.com 변형들은 동일한 canonical 값으로 정규화 (gitlab.com 판별)", () => {
    const canonical = "https://gitlab.com";
    expect(normalizeInstanceUrl("gitlab.com")).toBe(canonical);
    expect(normalizeInstanceUrl("https://gitlab.com")).toBe(canonical);
    expect(normalizeInstanceUrl("https://gitlab.com/")).toBe(canonical);
  });

  it("앞뒤 공백은 trim", () => {
    expect(normalizeInstanceUrl("  https://gitlab.example.com  ")).toBe(
      "https://gitlab.example.com",
    );
  });

  it("호스트 없는 무효 입력은 throw (폼이 catch)", () => {
    expect(() => normalizeInstanceUrl("https://")).toThrow();
  });
});
