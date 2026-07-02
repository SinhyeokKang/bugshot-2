import { describe, it, expect } from "vitest";

import { normalizeSwatchColor } from "../ColorSwatch";

describe("normalizeSwatchColor — # 유무 흡수", () => {
  it("bare hex 6자리는 # prefix 부여 (github API 포맷)", () => {
    expect(normalizeSwatchColor("d73a4a")).toBe("#d73a4a");
  });

  it("bare hex 3자리·8자리도 # prefix 부여", () => {
    expect(normalizeSwatchColor("fff")).toBe("#fff");
    expect(normalizeSwatchColor("d73a4a80")).toBe("#d73a4a80");
  });

  it("이미 #가 있으면 그대로 (linear/gitlab API 포맷)", () => {
    expect(normalizeSwatchColor("#d73a4a")).toBe("#d73a4a");
  });

  it("대소문자 보존", () => {
    expect(normalizeSwatchColor("D73A4A")).toBe("#D73A4A");
  });

  it("hex가 아닌 CSS 색 표현은 변경 없이 통과 (기존 소비처 보호)", () => {
    expect(normalizeSwatchColor("rgb(255, 0, 0)")).toBe("rgb(255, 0, 0)");
    expect(normalizeSwatchColor("var(--primary)")).toBe("var(--primary)");
    expect(normalizeSwatchColor("transparent")).toBe("transparent");
  });

  it("빈 문자열은 빈 문자열", () => {
    expect(normalizeSwatchColor("")).toBe("");
  });
});
