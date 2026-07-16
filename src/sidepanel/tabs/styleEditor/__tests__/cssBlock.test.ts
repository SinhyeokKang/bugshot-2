import { describe, expect, it } from "vitest";
import {
  serializeCssBlock,
  parseCssBlock,
  computeOverrides,
  collapseTrbl,
  expandTrbl,
  isCompleteDeclarationLine,
} from "../cssBlock";

describe("serializeCssBlock", () => {
  it("selector { } 블록으로 감싸고 선언을 줄바꿈 (들여쓰기는 에디터 decoration이 담당)", () => {
    expect(serializeCssBlock("sel", { color: "red" })).toBe(
      "sel {\ncolor: red;\n}",
    );
  });

  it("여러 선언은 삽입 순서 유지", () => {
    expect(serializeCssBlock("div.card", { color: "red", margin: "0" })).toBe(
      "div.card {\ncolor: red;\nmargin: 0;\n}",
    );
  });

  it("빈 맵은 선언 없는 빈 블록", () => {
    expect(serializeCssBlock("sel", {})).toBe("sel {\n}");
  });

  it("!important를 값 그대로 보존", () => {
    expect(serializeCssBlock("sel", { color: "red !important" })).toBe(
      "sel {\ncolor: red !important;\n}",
    );
  });
});

describe("parseCssBlock", () => {
  it("중괄호 본문의 선언을 맵으로 추출", () => {
    expect(parseCssBlock("sel {\n  color: red;\n}")).toEqual({ color: "red" });
  });

  it("selector 라인은 무시하고 본문만 파싱", () => {
    expect(
      parseCssBlock("div.card#hero:nth-child(2) {\n  padding: 8px;\n}"),
    ).toEqual({ padding: "8px" });
  });

  it("중괄호 없는 텍스트는 전체를 본문으로 관대 파싱", () => {
    expect(parseCssBlock("color: red;\nmargin: 0;")).toEqual({
      color: "red",
      margin: "0",
    });
  });

  it("닫는 } 없어도 여는 { 뒤를 본문으로 관대 파싱", () => {
    expect(parseCssBlock("sel {\n  color: red;")).toEqual({ color: "red" });
  });

  it("selector만 있고 본문이 비면 빈 맵", () => {
    expect(parseCssBlock("div.card {\n}")).toEqual({});
  });

  it("값 없는 선언은 무시(tolerant 파서 계승)", () => {
    expect(parseCssBlock("sel {\n  padding:;\n  color: red;\n}")).toEqual({
      color: "red",
    });
  });

  it("임의 속성·!important도 검증 없이 보존", () => {
    expect(
      parseCssBlock("sel {\n  cursor: pointer;\n  color: red !important;\n}"),
    ).toEqual({ cursor: "pointer", color: "red !important" });
  });

  it("빈 문자열은 빈 맵", () => {
    expect(parseCssBlock("")).toEqual({});
  });
});

describe("round-trip", () => {
  it("parseCssBlock(serializeCssBlock(sel, m))가 m과 동치", () => {
    const m = {
      color: "red !important",
      padding: "8px",
      cursor: "pointer",
      "background-image": "url(data:image/png;base64,AAA)",
    };
    expect(parseCssBlock(serializeCssBlock("div.card", m))).toEqual(m);
  });
});

describe("computeOverrides", () => {
  it("specified와 값이 다른 prop만 오버라이드로", () => {
    expect(
      computeOverrides(
        { color: "blue", padding: "8px" },
        { color: "red", padding: "8px" },
      ),
    ).toEqual({ color: "blue" });
  });

  it("edited에 새로 추가된 prop(specified에 없음)은 오버라이드", () => {
    expect(computeOverrides({ cursor: "pointer" }, {})).toEqual({
      cursor: "pointer",
    });
  });

  it("specified와 동일 값이면 오버라이드 아님(제외)", () => {
    expect(
      computeOverrides({ color: "red" }, { color: "red" }),
    ).toEqual({});
  });

  it("삭제=원복: specified에 있던 prop이 edited에서 빠지면 initial 방출", () => {
    expect(
      computeOverrides({ color: "red" }, { color: "red", padding: "8px" }),
    ).toEqual({ padding: "initial" });
  });

  it("변경·추가·삭제 혼합", () => {
    expect(
      computeOverrides(
        { color: "blue", margin: "0" },
        { color: "red", padding: "8px" },
      ),
    ).toEqual({ color: "blue", margin: "0", padding: "initial" });
  });

  it("무편집 불변식: 실제 getComputedStyle 형태 값에서도 빈 맵(phantom diff 없음)", () => {
    const specified = {
      color: "rgb(0, 0, 0)",
      margin: "10px 20px 10px 20px",
      width: "100.273px",
    };
    expect(
      computeOverrides(parseCssBlock(serializeCssBlock("sel", specified)), specified),
    ).toEqual({});
  });

  it("모두 삭제하면 전 specified prop이 initial 원복", () => {
    expect(computeOverrides({}, { color: "red", padding: "8px" })).toEqual({
      color: "initial",
      padding: "initial",
    });
  });
});

describe("expandTrbl — shorthand → longhand 4면", () => {
  it("단일값 → 4면 동일", () => {
    expect(expandTrbl({ padding: "8px" })).toEqual({
      "padding-top": "8px",
      "padding-right": "8px",
      "padding-bottom": "8px",
      "padding-left": "8px",
    });
  });

  it("2값 → top/bottom·right/left", () => {
    expect(expandTrbl({ margin: "8px 16px" })).toEqual({
      "margin-top": "8px",
      "margin-right": "16px",
      "margin-bottom": "8px",
      "margin-left": "16px",
    });
  });

  it("3값 → top·right/left·bottom", () => {
    expect(expandTrbl({ inset: "1px 2px 3px" })).toEqual({
      top: "1px",
      right: "2px",
      bottom: "3px",
      left: "2px",
    });
  });

  it("4값 → t r b l", () => {
    expect(expandTrbl({ "border-width": "1px 2px 3px 4px" })).toEqual({
      "border-top-width": "1px",
      "border-right-width": "2px",
      "border-bottom-width": "3px",
      "border-left-width": "4px",
    });
  });

  it("괄호 내부 공백 보존(paren-aware) — border-color rgb", () => {
    expect(expandTrbl({ "border-color": "rgb(255, 0, 0) blue" })).toEqual({
      "border-top-color": "rgb(255, 0, 0)",
      "border-right-color": "blue",
      "border-bottom-color": "rgb(255, 0, 0)",
      "border-left-color": "blue",
    });
  });

  it("border-radius 코너 순서 TL TR BR BL", () => {
    expect(expandTrbl({ "border-radius": "1px 2px 3px 4px" })).toEqual({
      "border-top-left-radius": "1px",
      "border-top-right-radius": "2px",
      "border-bottom-right-radius": "3px",
      "border-bottom-left-radius": "4px",
    });
  });

  it("elliptical( / ) border-radius는 opaque 유지", () => {
    expect(expandTrbl({ "border-radius": "8px / 4px" })).toEqual({
      "border-radius": "8px / 4px",
    });
  });

  it("TRBL 그룹 아닌 prop은 그대로", () => {
    expect(expandTrbl({ color: "red", display: "flex" })).toEqual({
      color: "red",
      display: "flex",
    });
  });
});

describe("collapseTrbl — longhand 4면 → shorthand", () => {
  it("4면 동일 → 단일값", () => {
    expect(
      collapseTrbl({
        "padding-top": "8px",
        "padding-right": "8px",
        "padding-bottom": "8px",
        "padding-left": "8px",
      }),
    ).toEqual({ padding: "8px" });
  });

  it("top==bottom·right==left → 2값", () => {
    expect(
      collapseTrbl({
        "margin-top": "8px",
        "margin-right": "16px",
        "margin-bottom": "8px",
        "margin-left": "16px",
      }),
    ).toEqual({ margin: "8px 16px" });
  });

  it("right==left(top!=bottom) → 3값", () => {
    expect(
      collapseTrbl({
        top: "1px",
        right: "2px",
        bottom: "3px",
        left: "2px",
      }),
    ).toEqual({ inset: "1px 2px 3px" });
  });

  it("전부 다르면 → 4값", () => {
    expect(
      collapseTrbl({
        "border-top-width": "1px",
        "border-right-width": "2px",
        "border-bottom-width": "3px",
        "border-left-width": "4px",
      }),
    ).toEqual({ "border-width": "1px 2px 3px 4px" });
  });

  it("4면 다 있지 않으면 collapse 안 함(원문 유지)", () => {
    const partial = {
      "padding-top": "8px",
      "padding-right": "8px",
      "padding-bottom": "8px",
    };
    expect(collapseTrbl(partial)).toEqual(partial);
  });

  it("삽입 순서 보존 — 첫 longhand 위치에 shorthand", () => {
    const out = collapseTrbl({
      color: "red",
      "padding-top": "8px",
      "padding-right": "8px",
      "padding-bottom": "8px",
      "padding-left": "8px",
      display: "flex",
    });
    expect(Object.keys(out)).toEqual(["color", "padding", "display"]);
  });

  it("비TRBL prop은 그대로", () => {
    expect(collapseTrbl({ color: "red", "border-radius": "8px" })).toEqual({
      color: "red",
      "border-radius": "8px",
    });
  });

  it("round-trip: collapseTrbl(expandTrbl(x)) === x (shorthand 형태)", () => {
    for (const v of ["8px", "8px 16px", "8px 16px 4px", "1px 2px 3px 4px"]) {
      expect(collapseTrbl(expandTrbl({ padding: v }))).toEqual({ padding: v });
    }
  });
});

describe("isCompleteDeclarationLine", () => {
  it("완결 선언(prop: value)은 true — 세미콜론 유무 무관", () => {
    expect(isCompleteDeclarationLine("table-layout: fixed;")).toBe(true);
    expect(isCompleteDeclarationLine("table-layout: fixed")).toBe(true);
    expect(isCompleteDeclarationLine("color: red;")).toBe(true);
    expect(isCompleteDeclarationLine("--x: 1;")).toBe(true);
  });

  it("콜론 없는 미완성 속성명은 false (적용 안 됨 — 취소선 유지)", () => {
    expect(isCompleteDeclarationLine("table-layout")).toBe(false);
    expect(isCompleteDeclarationLine("table-layou")).toBe(false);
  });

  it("콜론만 있고 값이 비면 false", () => {
    expect(isCompleteDeclarationLine("table-layout:")).toBe(false);
    expect(isCompleteDeclarationLine("table-layout: ;")).toBe(false);
    expect(isCompleteDeclarationLine("table-layout:   ")).toBe(false);
  });

  it("속성명이 비면(선두 콜론) false", () => {
    expect(isCompleteDeclarationLine(": fixed")).toBe(false);
  });

  it("들여쓰기/함수값(var())도 정확히 판별", () => {
    expect(isCompleteDeclarationLine("  border-collapse: separate;")).toBe(true);
    expect(
      isCompleteDeclarationLine("border-spacing: var(--tw-x) var(--tw-y);"),
    ).toBe(true);
  });
});
