import { describe, it, expect, vi } from "vitest";

// StyleChangesTable이 @/i18n(useT)을 import하므로 모듈 로드용 최소 mock.
vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
  t: (key: string) => key,
}));

import { hasStyleChange } from "../hasStyleChange";
import {
  buildStyleDiff,
  type StyleDiffSelection,
  type StyleDiffEdits,
} from "@/sidepanel/components/StyleChangesTable";

function sel(overrides: Partial<StyleDiffSelection> = {}): StyleDiffSelection {
  return {
    classList: ["card"],
    specifiedStyles: {},
    computedStyles: {},
    text: null,
    ...overrides,
  };
}

function edits(overrides: Partial<StyleDiffEdits> = {}): StyleDiffEdits {
  return {
    classList: ["card"],
    inlineStyle: {},
    text: "",
    ...overrides,
  };
}

describe("hasStyleChange — 진입 게이트 판정", () => {
  it("inlineStyle 변경이 있으면 true", () => {
    expect(hasStyleChange(sel(), edits({ inlineStyle: { color: "#fff" } }))).toBe(
      true,
    );
  });

  it("classList가 다르면 true", () => {
    expect(
      hasStyleChange(sel({ classList: ["card"] }), edits({ classList: ["card", "active"] })),
    ).toBe(true);
  });

  it("text가 바뀌면 true", () => {
    expect(
      hasStyleChange(sel({ text: "Old" }), edits({ classList: ["card"], text: "New" })),
    ).toBe(true);
  });

  it("아무 변경 없으면 false", () => {
    expect(hasStyleChange(sel(), edits())).toBe(false);
  });

  it("inline 값이 baseline(specified)과 동일하면 false (phantom diff 방지)", () => {
    expect(
      hasStyleChange(
        sel({ specifiedStyles: { "padding-top": "10px" } }),
        edits({ inlineStyle: { "padding-top": "10px" } }),
      ),
    ).toBe(false);
  });

  it("inline 값이 baseline(computed)과 동일하면 false", () => {
    expect(
      hasStyleChange(
        sel({ computedStyles: { color: "rgb(0, 0, 0)" } }),
        edits({ inlineStyle: { color: "rgb(0, 0, 0)" } }),
      ),
    ).toBe(false);
  });

  it("inline 값이 baseline과 다르면 true", () => {
    expect(
      hasStyleChange(
        sel({ specifiedStyles: { "padding-top": "10px" } }),
        edits({ inlineStyle: { "padding-top": "12px" } }),
      ),
    ).toBe(true);
  });

  it("text가 null이고 edits.text가 빈 문자열이면 false (no-op)", () => {
    expect(hasStyleChange(sel({ text: null }), edits({ text: "" }))).toBe(false);
  });
});

describe("hasStyleChange ↔ buildStyleDiff().length>0 동치 (#10)", () => {
  const cases: { name: string; s: StyleDiffSelection; e: StyleDiffEdits }[] = [
    { name: "변경 없음", s: sel(), e: edits() },
    {
      name: "inline 1개",
      s: sel(),
      e: edits({ inlineStyle: { color: "#fff" } }),
    },
    {
      name: "class 변경",
      s: sel({ classList: ["card"] }),
      e: edits({ classList: ["card", "active"] }),
    },
    {
      name: "text 변경",
      s: sel({ text: "Old" }),
      e: edits({ classList: ["card"], text: "New" }),
    },
    {
      name: "padding longhand 4개 (shorthand collapse 후에도 동치)",
      s: sel({
        computedStyles: {
          "padding-top": "0px",
          "padding-right": "0px",
          "padding-bottom": "0px",
          "padding-left": "0px",
        },
      }),
      e: edits({
        inlineStyle: {
          "padding-top": "8px",
          "padding-right": "8px",
          "padding-bottom": "8px",
          "padding-left": "8px",
        },
      }),
    },
    {
      name: "text null + 빈 edits.text",
      s: sel({ text: null }),
      e: edits({ text: "" }),
    },
    {
      name: "inline == baseline (phantom diff — 둘 다 변경 없음)",
      s: sel({ specifiedStyles: { "padding-top": "10px" } }),
      e: edits({ inlineStyle: { "padding-top": "10px" } }),
    },
  ];

  cases.forEach(({ name, s, e }) => {
    it(`동치: ${name}`, () => {
      expect(hasStyleChange(s, e)).toBe(buildStyleDiff(s, e).length > 0);
    });
  });
});
