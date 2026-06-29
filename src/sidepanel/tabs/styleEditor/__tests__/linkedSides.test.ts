import { describe, it, expect, vi } from "vitest";

// StylePropEditors가 @/i18n(useT)을 import하므로 모듈 로드용 최소 mock.
vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
  t: (key: string) => key,
}));

import {
  commonEditValue,
  commonBaseline,
  sidesMixed,
  sidesAllEqual,
} from "../StylePropEditors";
import type { EditorSelection } from "@/store/editor-store";

const PADDING = [
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
];
const GAP = ["row-gap", "column-gap"];

function selection(overrides: Partial<EditorSelection> = {}): EditorSelection {
  return {
    selector: "#el",
    tagName: "div",
    classList: [],
    computedStyles: {},
    specifiedStyles: {},
    propSources: {},
    hasParent: true,
    hasChild: false,
    text: null,
    viewport: { width: 1280, height: 800 },
    capturedAt: 1,
    ...overrides,
  };
}

describe("commonEditValue", () => {
  it("4면 편집값이 모두 동일 → 그 값", () => {
    const inline = {
      "padding-top": "16px",
      "padding-right": "16px",
      "padding-bottom": "16px",
      "padding-left": "16px",
    };
    expect(commonEditValue(PADDING, inline)).toBe("16px");
  });

  it("일부 면만 편집값 존재 → \"\"", () => {
    expect(commonEditValue(PADDING, { "padding-top": "16px" })).toBe("");
  });

  it("4면 편집값이 모두 있으나 서로 다름 → \"\"", () => {
    const inline = {
      "padding-top": "16px",
      "padding-right": "8px",
      "padding-bottom": "16px",
      "padding-left": "16px",
    };
    expect(commonEditValue(PADDING, inline)).toBe("");
  });

  it("빈 inlineStyle → \"\"", () => {
    expect(commonEditValue(PADDING, {})).toBe("");
  });

  it("gap 2축 편집값 동일 → 그 값 (4면 아닌 묶음도 동작)", () => {
    expect(
      commonEditValue(GAP, { "row-gap": "12px", "column-gap": "12px" }),
    ).toBe("12px");
  });
});

describe("commonBaseline", () => {
  it("편집값 4면 동일 → 그 값", () => {
    const inline = {
      "padding-top": "8px",
      "padding-right": "8px",
      "padding-bottom": "8px",
      "padding-left": "8px",
    };
    expect(commonBaseline(PADDING, inline, selection())).toBe("8px");
  });

  it("편집 없고 specified 4면 동일 → specified 값", () => {
    const sel = selection({
      specifiedStyles: {
        "padding-top": "4px",
        "padding-right": "4px",
        "padding-bottom": "4px",
        "padding-left": "4px",
      },
    });
    expect(commonBaseline(PADDING, {}, sel)).toBe("4px");
  });

  it("편집·specified 없고 computed만 4면 동일 → computed 값", () => {
    const sel = selection({
      computedStyles: {
        "padding-top": "0px",
        "padding-right": "0px",
        "padding-bottom": "0px",
        "padding-left": "0px",
      },
    });
    expect(commonBaseline(PADDING, {}, sel)).toBe("0px");
  });

  it("편집값이 specified/computed보다 우선", () => {
    const sel = selection({
      specifiedStyles: {
        "padding-top": "4px",
        "padding-right": "4px",
        "padding-bottom": "4px",
        "padding-left": "4px",
      },
    });
    const inline = {
      "padding-top": "16px",
      "padding-right": "16px",
      "padding-bottom": "16px",
      "padding-left": "16px",
    };
    expect(commonBaseline(PADDING, inline, sel)).toBe("16px");
  });

  it("baseline 4면 불일치 → \"\"", () => {
    const sel = selection({
      computedStyles: {
        "padding-top": "4px",
        "padding-right": "0px",
        "padding-bottom": "0px",
        "padding-left": "0px",
      },
    });
    expect(commonBaseline(PADDING, {}, sel)).toBe("");
  });

  it("selection null + 편집값 없음 → \"\"", () => {
    expect(commonBaseline(PADDING, {}, null)).toBe("");
  });
});

describe("sidesMixed", () => {
  it("baseline 4면 동일 → false", () => {
    const sel = selection({
      computedStyles: {
        "padding-top": "8px",
        "padding-right": "8px",
        "padding-bottom": "8px",
        "padding-left": "8px",
      },
    });
    expect(sidesMixed(PADDING, {}, sel)).toBe(false);
  });

  it("한 면만 편집(top 16px), 나머지 computed 0 → true", () => {
    const sel = selection({
      computedStyles: {
        "padding-top": "0px",
        "padding-right": "0px",
        "padding-bottom": "0px",
        "padding-left": "0px",
      },
    });
    expect(sidesMixed(PADDING, { "padding-top": "16px" }, sel)).toBe(true);
  });

  it("4면 모두 빈 값(selection null) → false (불일치 아님)", () => {
    expect(sidesMixed(PADDING, {}, null)).toBe(false);
  });

  it("편집값 일부(top 16) + specified 8 혼합 → true", () => {
    const sel = selection({
      specifiedStyles: {
        "padding-top": "8px",
        "padding-right": "8px",
        "padding-bottom": "8px",
        "padding-left": "8px",
      },
    });
    expect(sidesMixed(PADDING, { "padding-top": "16px" }, sel)).toBe(true);
  });
});

describe("sidesAllEqual ⟺ commonBaseline(...) !== \"\" 동치성", () => {
  const cases: Array<{
    name: string;
    inline: Record<string, string>;
    sel: EditorSelection | null;
  }> = [
    { name: "selection null + 편집 없음", inline: {}, sel: null },
    {
      name: "4면 모두 빈 값 → 둘 다 false",
      inline: {},
      sel: selection(),
    },
    {
      name: "편집값 일부만 존재",
      inline: { "padding-top": "16px" },
      sel: selection(),
    },
    {
      name: "specified/computed 혼합 동일값",
      inline: {},
      sel: selection({
        specifiedStyles: { "padding-top": "8px", "padding-right": "8px" },
        computedStyles: {
          "padding-top": "8px",
          "padding-right": "8px",
          "padding-bottom": "8px",
          "padding-left": "8px",
        },
      }),
    },
    {
      name: "baseline 불일치",
      inline: {},
      sel: selection({
        computedStyles: {
          "padding-top": "4px",
          "padding-right": "0px",
          "padding-bottom": "0px",
          "padding-left": "0px",
        },
      }),
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(sidesAllEqual(PADDING, c.inline, c.sel)).toBe(
        commonBaseline(PADDING, c.inline, c.sel) !== "",
      );
    });
  }

  it("4면 모두 빈 값 → sidesAllEqual false", () => {
    expect(sidesAllEqual(PADDING, {}, selection())).toBe(false);
  });
});
