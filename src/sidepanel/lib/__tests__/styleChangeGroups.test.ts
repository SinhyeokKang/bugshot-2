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
import type {
  StyleDiffSelection,
  StyleDiffEdits,
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
