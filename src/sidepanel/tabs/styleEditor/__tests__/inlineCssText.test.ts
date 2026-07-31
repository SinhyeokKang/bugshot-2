import { describe, expect, it } from "vitest";
import {
  parseInlineStyle,
  parseInlineStyleDraft,
  serializeInlineStyle,
} from "../inlineCssText";

describe("serializeInlineStyle", () => {
  it("맵을 'prop: value;' 줄로 직렬화하고 삽입 순서를 유지", () => {
    const m = { padding: "2rem", color: "#fff" };
    expect(serializeInlineStyle(m)).toBe("padding: 2rem;\ncolor: #fff;");
  });

  it("빈 맵은 빈 문자열", () => {
    expect(serializeInlineStyle({})).toBe("");
  });

  it("단일 선언은 끝에 개행 없이 한 줄", () => {
    expect(serializeInlineStyle({ padding: "2rem" })).toBe("padding: 2rem;");
  });

  it("값의 !important를 문자열 그대로 보존", () => {
    expect(serializeInlineStyle({ color: "red !important" })).toBe(
      "color: red !important;",
    );
  });
});

describe("parseInlineStyle", () => {
  it("기본 선언 텍스트를 맵으로 파싱", () => {
    expect(parseInlineStyle("padding: 2rem;\ncolor: #fff;")).toEqual({
      padding: "2rem",
      color: "#fff",
    });
  });

  it("prop은 trim + lowercase, value는 trim(정규화 없음)", () => {
    expect(parseInlineStyle("  COLOR :  #FFF ;")).toEqual({ color: "#FFF" });
  });

  it("첫 콜론만 prop/value 분리 — 값 안의 콜론 보존", () => {
    expect(parseInlineStyle("background-image: url(data:image/png;base64,AAA);")).toEqual({
      "background-image": "url(data:image/png;base64,AAA)",
    });
  });

  it("괄호 내부 세미콜론은 값의 일부로 보존", () => {
    expect(
      parseInlineStyle("background-image: url(data:image/png;base64,AAA); color: red;"),
    ).toEqual({
      "background-image": "url(data:image/png;base64,AAA)",
      color: "red",
    });
  });

  it("따옴표 내부 세미콜론은 값의 일부로 보존", () => {
    expect(parseInlineStyle('content: "a;b";')).toEqual({ content: '"a;b"' });
  });

  it("!important를 값의 일부로 파싱(opaque)", () => {
    expect(parseInlineStyle("color: red !important;")).toEqual({
      color: "red !important",
    });
  });

  it("중복 prop은 마지막 값 채택(last-wins)", () => {
    expect(parseInlineStyle("color: red;\ncolor: blue;")).toEqual({ color: "blue" });
  });

  it("값 없는 선언은 무시", () => {
    expect(parseInlineStyle("padding:;\ncolor: red;")).toEqual({ color: "red" });
  });

  it("콜론 없는 줄은 무시", () => {
    expect(parseInlineStyle("garbage line\ncolor: red;")).toEqual({ color: "red" });
  });

  it("오타 prop명도 검증 없이 그대로 보존", () => {
    expect(parseInlineStyle("colr: red;")).toEqual({ colr: "red" });
  });

  it("커스텀 프로퍼티(--*)는 케이스 보존(lowercase 예외)", () => {
    expect(parseInlineStyle("--mainColor: red;")).toEqual({
      "--mainColor": "red",
    });
  });

  it("빈 문자열은 빈 맵", () => {
    expect(parseInlineStyle("")).toEqual({});
  });

  it("주석을 선언 이름에 섞지 않고 무시", () => {
    expect(parseInlineStyle("/* fallback */ color: red;")).toEqual({
      color: "red",
    });
  });

  it("escaped quote 뒤 세미콜론을 값 내부로 보존", () => {
    expect(parseInlineStyle('content: "a\\\";b"; color: red;')).toEqual({
      content: '"a\\\";b"',
      color: "red",
    });
  });
});

describe("parseInlineStyleDraft", () => {
  it.each([
    "color:",
    'content: "open',
    "width: calc(100% - 2px",
    "/* open",
  ])("불완전 입력은 commit 불가로 분류: %s", (text) => {
    expect(parseInlineStyleDraft(text)).toMatchObject({ valid: false });
  });

  it("중복 선언은 fallback 순서를 축약하지 않고 invalid raw로 보존", () => {
    const raw = "/* fallback */ display: -webkit-box; display: flex;";
    expect(parseInlineStyleDraft(raw)).toEqual({
      valid: false,
      declarations: { display: "flex" },
      raw,
    });
  });
});

describe("round-trip", () => {
  it("parse(serialize(m))가 의미상 동치(값 정규화 제외) — !important 포함", () => {
    const m = {
      padding: "2rem",
      color: "red !important",
      "background-image": "url(data:image/png;base64,AAA)",
      content: '"a;b"',
      cursor: "pointer",
    };
    expect(parseInlineStyle(serializeInlineStyle(m))).toEqual(m);
  });
});
