import { describe, it, expect, vi } from "vitest";

// StyleChangesTable이 @/i18n(useT)을 import하므로 모듈 로드용 최소 mock.
vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
  t: (key: string) => key,
}));

import {
  buildChangeGroups,
  countChangeRows,
  removeDiffRow,
} from "../styleChangeGroups";
import {
  buildStyleDiff,
  type StyleDiffSelection,
  type StyleDiffEdits,
} from "@/sidepanel/components/StyleChangesTable";
import type {
  BufferedElement,
  EditorSelection,
  EditorStyleEdits,
} from "@/store/editor-store";

function selection(overrides: Partial<EditorSelection> = {}): EditorSelection {
  return {
    selector: "#current",
    tagName: "div",
    classList: ["card"],
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

function edits(overrides: Partial<EditorStyleEdits> = {}): EditorStyleEdits {
  return {
    classList: ["card"],
    inlineStyle: {},
    text: "",
    ...overrides,
  };
}

function buffered(
  selector: string,
  overrides: Partial<BufferedElement> = {},
): BufferedElement {
  return {
    selector,
    tagName: "span",
    selectionSnapshot: {
      classList: ["item"],
      specifiedStyles: {},
      computedStyles: {},
      propSources: {},
      text: null,
      viewport: { width: 1280, height: 800 },
      capturedAt: 1,
    },
    styleEdits: {
      classList: ["item"],
      inlineStyle: { color: "#f00" },
      text: "",
    },
    beforeImage: null,
    afterImage: null,
    ...overrides,
  };
}

function snap(overrides: Partial<StyleDiffSelection> = {}): StyleDiffSelection {
  return {
    classList: ["card"],
    specifiedStyles: {},
    computedStyles: {},
    text: null,
    ...overrides,
  };
}

function diffEdits(overrides: Partial<StyleDiffEdits> = {}): StyleDiffEdits {
  return {
    classList: ["card"],
    inlineStyle: {},
    text: "",
    ...overrides,
  };
}

describe("buildChangeGroups", () => {
  it("버퍼 2개 + 현재 선택 diff 있음 → 그룹 3개, 버퍼 순서 뒤 현재, source 플래그", () => {
    const groups = buildChangeGroups(
      selection(),
      edits({ inlineStyle: { color: "#00f" } }),
      [buffered("#a"), buffered("#b")],
    );

    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.selector)).toEqual(["#a", "#b", "#current"]);
    expect(groups.map((g) => g.source)).toEqual([
      "buffered",
      "buffered",
      "current",
    ]);
    expect(groups[2].rows).toEqual([
      { prop: "color", asIs: "", toBe: "#00f" },
    ]);
  });

  it("현재 선택 diff 없음 → 현재 그룹 제외, 버퍼만 포함", () => {
    const groups = buildChangeGroups(selection(), edits(), [buffered("#a")]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ source: "buffered", selector: "#a" });
  });

  it("selection null → 버퍼 그룹만", () => {
    const groups = buildChangeGroups(null, edits(), [
      buffered("#a"),
      buffered("#b"),
    ]);

    expect(groups.map((g) => g.selector)).toEqual(["#a", "#b"]);
    expect(groups.every((g) => g.source === "buffered")).toBe(true);
  });

  it("중복 selector(버퍼 항목 == 현재 선택) → 두 그룹 모두 포함", () => {
    const groups = buildChangeGroups(
      selection({ selector: "#a" }),
      edits({ inlineStyle: { color: "#00f" } }),
      [buffered("#a")],
    );

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.source)).toEqual(["buffered", "current"]);
    expect(groups.every((g) => g.selector === "#a")).toBe(true);
  });

  it("현재 그룹에 text·class·inline 행 혼합 → text→class→prop 순 정렬", () => {
    const groups = buildChangeGroups(
      selection({ text: "Old" }),
      edits({
        text: "New",
        classList: ["card", "active"],
        inlineStyle: { color: "#00f" },
      }),
      [],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toEqual([
      { prop: "text", asIs: "Old", toBe: "New" },
      {
        prop: "class",
        asIs: "card",
        toBe: "card active",
        asIsSegments: [{ text: "card", changed: false }],
        toBeSegments: [
          { text: "card", changed: false },
          { text: "active", changed: true },
        ],
      },
      { prop: "color", asIs: "", toBe: "#00f" },
    ]);
  });

  it("그룹에 라벨·원복용 메타(tagName·classList·snapshot·edits)가 실린다", () => {
    const b = buffered("#a");
    const groups = buildChangeGroups(null, edits(), [b]);

    expect(groups[0].tagName).toBe("span");
    expect(groups[0].classList).toEqual(["item"]);
    expect(groups[0].snapshot).toEqual(b.selectionSnapshot);
    expect(groups[0].edits).toEqual(b.styleEdits);
  });
});

describe("countChangeRows", () => {
  it("모든 그룹의 rows 합 (shorthand collapse 반영)", () => {
    const paddingBuffer = buffered("#pad", {
      styleEdits: {
        classList: ["item"],
        inlineStyle: {
          "padding-top": "8px",
          "padding-right": "8px",
          "padding-bottom": "8px",
          "padding-left": "8px",
        },
        text: "",
      },
    });
    const groups = buildChangeGroups(
      selection(),
      edits({ inlineStyle: { color: "#00f" } }),
      [paddingBuffer, buffered("#b")],
    );

    // padding 4면 동일값 → 1행 collapse, #b color 1행, 현재 color 1행
    expect(countChangeRows(groups)).toBe(3);
  });

  it("빈 배열 → 0", () => {
    expect(countChangeRows([])).toBe(0);
  });
});

describe("buildStyleDiff — shorthand collapse", () => {
  it("collapsed 행은 prepend가 아니라 첫 longhand 자리 (text→class→prop 정렬 유지)", () => {
    const rows = buildStyleDiff(
      snap({ text: "Old" }),
      diffEdits({
        text: "New",
        classList: ["card", "active"],
        inlineStyle: {
          color: "#00f",
          "padding-top": "8px",
          "padding-right": "8px",
          "padding-bottom": "8px",
          "padding-left": "8px",
          width: "320px",
        },
      }),
    );

    expect(rows.map((r) => r.prop)).toEqual([
      "text",
      "class",
      "color",
      "padding",
      "width",
    ]);
  });

  it("명시 shorthand 키와 longhand 4종 공존 시 같은 prop 행을 중복 생성하지 않는다", () => {
    const rows = buildStyleDiff(
      snap(),
      diffEdits({
        inlineStyle: {
          padding: "8px",
          "padding-top": "12px",
          "padding-right": "12px",
          "padding-bottom": "12px",
          "padding-left": "12px",
        },
      }),
    );

    expect(rows.filter((r) => r.prop === "padding")).toHaveLength(1);
    expect(rows.map((r) => r.prop)).toEqual([
      "padding",
      "padding-bottom",
      "padding-left",
      "padding-right",
      "padding-top",
    ]);
  });
});

describe("removeDiffRow", () => {
  it('"text" → snapshot.text로 원복', () => {
    const next = removeDiffRow(
      snap({ text: "Old" }),
      diffEdits({ text: "New", inlineStyle: { color: "#00f" } }),
      "text",
    );

    expect(next.text).toBe("Old");
    expect(next.inlineStyle).toEqual({ color: "#00f" });
    expect(next.classList).toEqual(["card"]);
  });

  it('"class" → snapshot.classList로 원복', () => {
    const next = removeDiffRow(
      snap({ classList: ["card"] }),
      diffEdits({ classList: ["card", "active"] }),
      "class",
    );

    expect(next.classList).toEqual(["card"]);
  });

  it("일반 prop → inlineStyle에서 해당 키만 삭제", () => {
    const next = removeDiffRow(
      snap(),
      diffEdits({ inlineStyle: { color: "#00f", "font-size": "14px" } }),
      "color",
    );

    expect(next.inlineStyle).toEqual({ "font-size": "14px" });
  });

  it('collapsed shorthand 행("padding") → longhand 4종 + padding 키 모두 삭제', () => {
    const next = removeDiffRow(
      snap(),
      diffEdits({
        inlineStyle: {
          "padding-top": "8px",
          "padding-right": "8px",
          "padding-bottom": "8px",
          "padding-left": "8px",
          padding: "8px",
          color: "#00f",
        },
      }),
      "padding",
    );

    expect(next.inlineStyle).toEqual({ color: "#00f" });
  });

  it('inlineStyle에 "padding" 직접 키만 있는 경우도 삭제', () => {
    const next = removeDiffRow(
      snap(),
      diffEdits({ inlineStyle: { padding: "8px", color: "#00f" } }),
      "padding",
    );

    expect(next.inlineStyle).toEqual({ color: "#00f" });
  });

  it("입력 edits를 변형하지 않는다 (새 객체 반환)", () => {
    const input = diffEdits({ inlineStyle: { color: "#00f" } });
    const next = removeDiffRow(snap(), input, "color");

    expect(input.inlineStyle).toEqual({ color: "#00f" });
    expect(next).not.toBe(input);
  });
});

describe("buildStyleDiff — border 변별 collapse", () => {
  it("border-{side}-width 네 변 동일 → 단일 border-width 행", () => {
    const rows = buildStyleDiff(
      snap(),
      diffEdits({
        inlineStyle: {
          "border-top-width": "2px",
          "border-right-width": "2px",
          "border-bottom-width": "2px",
          "border-left-width": "2px",
        },
      }),
    );

    expect(rows).toEqual([{ prop: "border-width", asIs: "", toBe: "2px" }]);
  });

  it("border-{side}-color 네 변 동일 → 단일 border-color 행", () => {
    const rows = buildStyleDiff(
      snap(),
      diffEdits({
        inlineStyle: {
          "border-top-color": "red",
          "border-right-color": "red",
          "border-bottom-color": "red",
          "border-left-color": "red",
        },
      }),
    );

    expect(rows).toEqual([{ prop: "border-color", asIs: "", toBe: "red" }]);
  });

  it("border-{side}-style 네 변 동일 → 단일 border-style 행", () => {
    const rows = buildStyleDiff(
      snap(),
      diffEdits({
        inlineStyle: {
          "border-top-style": "dashed",
          "border-right-style": "dashed",
          "border-bottom-style": "dashed",
          "border-left-style": "dashed",
        },
      }),
    );

    expect(rows).toEqual([{ prop: "border-style", asIs: "", toBe: "dashed" }]);
  });

  it("부분 일치(3변만 같음) → collapse 안 함, 개별 행 4개", () => {
    const rows = buildStyleDiff(
      snap(),
      diffEdits({
        inlineStyle: {
          "border-top-width": "2px",
          "border-right-width": "2px",
          "border-bottom-width": "4px",
          "border-left-width": "2px",
        },
      }),
    );

    expect(rows.map((r) => r.prop).sort()).toEqual([
      "border-bottom-width",
      "border-left-width",
      "border-right-width",
      "border-top-width",
    ]);
    expect(rows.some((r) => r.prop === "border-width")).toBe(false);
  });

  it("한 변만 편집 → 그 변 개별 행만 (collapse 조건 미충족)", () => {
    const rows = buildStyleDiff(
      snap(),
      diffEdits({ inlineStyle: { "border-bottom-width": "2px" } }),
    );

    expect(rows).toEqual([
      { prop: "border-bottom-width", asIs: "", toBe: "2px" },
    ]);
  });
});

describe("buildStyleDiff — border 2차 통합 (width/style/color → border)", () => {
  it("width/style/color 셋 다 4면 동일 변경 → border 한 줄 (asIs baseline 없음 → \"\")", () => {
    const rows = buildStyleDiff(
      snap(),
      diffEdits({
        inlineStyle: {
          "border-top-width": "2px",
          "border-right-width": "2px",
          "border-bottom-width": "2px",
          "border-left-width": "2px",
          "border-top-style": "solid",
          "border-right-style": "solid",
          "border-bottom-style": "solid",
          "border-left-style": "solid",
          "border-top-color": "red",
          "border-right-color": "red",
          "border-bottom-color": "red",
          "border-left-color": "red",
        },
      }),
    );

    expect(rows).toEqual([
      { prop: "border", asIs: "", toBe: "2px solid red" },
    ]);
  });

  it("baseline(computed) 있으면 asIs도 width style color 순으로 조합", () => {
    const rows = buildStyleDiff(
      snap({
        computedStyles: {
          "border-top-width": "0px",
          "border-right-width": "0px",
          "border-bottom-width": "0px",
          "border-left-width": "0px",
          "border-top-style": "none",
          "border-right-style": "none",
          "border-bottom-style": "none",
          "border-left-style": "none",
          "border-top-color": "rgb(0, 0, 0)",
          "border-right-color": "rgb(0, 0, 0)",
          "border-bottom-color": "rgb(0, 0, 0)",
          "border-left-color": "rgb(0, 0, 0)",
        },
      }),
      diffEdits({
        inlineStyle: {
          "border-top-width": "2px",
          "border-right-width": "2px",
          "border-bottom-width": "2px",
          "border-left-width": "2px",
          "border-top-style": "solid",
          "border-right-style": "solid",
          "border-bottom-style": "solid",
          "border-left-style": "solid",
          "border-top-color": "red",
          "border-right-color": "red",
          "border-bottom-color": "red",
          "border-left-color": "red",
        },
      }),
    );

    expect(rows).toEqual([
      { prop: "border", asIs: "0px none rgb(0, 0, 0)", toBe: "2px solid red" },
    ]);
  });

  it("color만 4면 불일치(개별 행 잔존) → border 통합 안 함, width/style만 1차 축약", () => {
    const rows = buildStyleDiff(
      snap(),
      diffEdits({
        inlineStyle: {
          "border-top-width": "2px",
          "border-right-width": "2px",
          "border-bottom-width": "2px",
          "border-left-width": "2px",
          "border-top-style": "solid",
          "border-right-style": "solid",
          "border-bottom-style": "solid",
          "border-left-style": "solid",
          "border-top-color": "red",
          "border-right-color": "blue",
          "border-bottom-color": "red",
          "border-left-color": "red",
        },
      }),
    );

    expect(rows.some((r) => r.prop === "border")).toBe(false);
    expect(rows.some((r) => r.prop === "border-width")).toBe(true);
    expect(rows.some((r) => r.prop === "border-style")).toBe(true);
    // color는 1차 축약도 안 돼 개별 행 4개 잔존
    expect(rows.filter((r) => r.prop.endsWith("-color"))).toHaveLength(4);
  });

  it("width만 변경(style/color 미변경) → border-width 한 줄, border 통합 없음", () => {
    const rows = buildStyleDiff(
      snap(),
      diffEdits({
        inlineStyle: {
          "border-top-width": "2px",
          "border-right-width": "2px",
          "border-bottom-width": "2px",
          "border-left-width": "2px",
        },
      }),
    );

    expect(rows).toEqual([{ prop: "border-width", asIs: "", toBe: "2px" }]);
  });

  it("명시 border 행이 이미 있으면 중복 생성 안 함", () => {
    const rows = buildStyleDiff(
      snap(),
      diffEdits({
        inlineStyle: {
          border: "1px solid black",
          "border-top-width": "2px",
          "border-right-width": "2px",
          "border-bottom-width": "2px",
          "border-left-width": "2px",
          "border-top-style": "solid",
          "border-right-style": "solid",
          "border-bottom-style": "solid",
          "border-left-style": "solid",
          "border-top-color": "red",
          "border-right-color": "red",
          "border-bottom-color": "red",
          "border-left-color": "red",
        },
      }),
    );

    expect(rows.filter((r) => r.prop === "border")).toHaveLength(1);
    expect(rows.find((r) => r.prop === "border")?.toBe).toBe("1px solid black");
  });
});

describe("countChangeRows — border 변별 collapse", () => {
  it("border-width 네 변 동일 편집 → 1 카운트 (longhand 4 아님)", () => {
    const groups = buildChangeGroups(
      selection(),
      edits({
        inlineStyle: {
          "border-top-width": "2px",
          "border-right-width": "2px",
          "border-bottom-width": "2px",
          "border-left-width": "2px",
        },
      }),
      [],
    );

    expect(countChangeRows(groups)).toBe(1);
  });
});

describe("removeDiffRow — border 변별 collapse", () => {
  it('"border-width" → width longhand 4종 삭제(다른 prop 보존)', () => {
    const next = removeDiffRow(
      snap(),
      diffEdits({
        inlineStyle: {
          "border-top-width": "2px",
          "border-right-width": "2px",
          "border-bottom-width": "2px",
          "border-left-width": "2px",
          color: "#00f",
        },
      }),
      "border-width",
    );

    expect(next.inlineStyle).toEqual({ color: "#00f" });
  });

  it('"border-color" → color longhand 4종 삭제', () => {
    const next = removeDiffRow(
      snap(),
      diffEdits({
        inlineStyle: {
          "border-top-color": "red",
          "border-right-color": "red",
          "border-bottom-color": "red",
          "border-left-color": "red",
        },
      }),
      "border-color",
    );

    expect(next.inlineStyle).toEqual({});
  });

  it('"border"(2차 통합 행) → width/style/color longhand 12종 모두 삭제(다른 prop 보존)', () => {
    const next = removeDiffRow(
      snap(),
      diffEdits({
        inlineStyle: {
          "border-top-width": "2px",
          "border-right-width": "2px",
          "border-bottom-width": "2px",
          "border-left-width": "2px",
          "border-top-style": "solid",
          "border-right-style": "solid",
          "border-bottom-style": "solid",
          "border-left-style": "solid",
          "border-top-color": "red",
          "border-right-color": "red",
          "border-bottom-color": "red",
          "border-left-color": "red",
          color: "#00f",
        },
      }),
      "border",
    );

    expect(next.inlineStyle).toEqual({ color: "#00f" });
  });
});
