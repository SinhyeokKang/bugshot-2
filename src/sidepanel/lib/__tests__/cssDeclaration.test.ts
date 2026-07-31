import { describe, expect, it } from "vitest";
import { filterValidCssDeclarations } from "../cssDeclaration";

describe("filterValidCssDeclarations", () => {
  const supports = (prop: string, value: string) =>
    prop === "color" && value === "red";

  it("브라우저가 거부한 선언은 store 진입 전에 제거", () => {
    expect(
      filterValidCssDeclarations(
        { color: "red", width: "banana" },
        supports,
      ),
    ).toEqual({ color: "red" });
  });

  it("!important는 priority를 벗긴 값으로 검증", () => {
    expect(
      filterValidCssDeclarations({ color: "red !important" }, supports),
    ).toEqual({ color: "red !important" });
  });

  it("custom property는 비어 있지 않으면 보존", () => {
    expect(
      filterValidCssDeclarations({ "--ThemeColor": "oklch(50% 0.2 30)" }, supports),
    ).toEqual({ "--ThemeColor": "oklch(50% 0.2 30)" });
  });
});
