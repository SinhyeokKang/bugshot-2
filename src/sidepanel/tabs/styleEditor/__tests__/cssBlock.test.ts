import { describe, expect, it } from "vitest";
import { serializeCssBlock, parseCssBlock, computeOverrides } from "../cssBlock";

describe("serializeCssBlock", () => {
  it("selector { } 블록으로 감싸고 선언을 2칸 들여쓰기", () => {
    expect(serializeCssBlock("sel", { color: "red" })).toBe(
      "sel {\n  color: red;\n}",
    );
  });

  it("여러 선언은 삽입 순서 유지 + 각 줄 2칸 들여쓰기", () => {
    expect(serializeCssBlock("div.card", { color: "red", margin: "0" })).toBe(
      "div.card {\n  color: red;\n  margin: 0;\n}",
    );
  });

  it("빈 맵은 선언 없는 빈 블록", () => {
    expect(serializeCssBlock("sel", {})).toBe("sel {\n}");
  });

  it("!important를 값 그대로 보존", () => {
    expect(serializeCssBlock("sel", { color: "red !important" })).toBe(
      "sel {\n  color: red !important;\n}",
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
