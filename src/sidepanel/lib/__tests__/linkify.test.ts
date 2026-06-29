import { describe, it, expect } from "vitest";
import { tokenizeLogText } from "../linkify";

describe("tokenizeLogText", () => {
  // 정상
  it("URL 없는 텍스트는 text 토큰 1개로 반환한다", () => {
    expect(tokenizeLogText("just a plain message")).toEqual([
      { type: "text", value: "just a plain message" },
    ]);
  });

  it("문장 중간 URL을 text/url/text로 분리한다", () => {
    expect(tokenizeLogText("visit https://react.dev/errors/185 for help")).toEqual([
      { type: "text", value: "visit " },
      {
        type: "url",
        value: "https://react.dev/errors/185",
        href: "https://react.dev/errors/185",
      },
      { type: "text", value: " for help" },
    ]);
  });

  // 엣지
  it("빈 문자열은 빈 배열을 반환한다", () => {
    expect(tokenizeLogText("")).toEqual([]);
  });

  it("URL이 텍스트 전체면 url 토큰 1개만 반환한다(앞뒤 text 없음)", () => {
    expect(tokenizeLogText("https://h/x")).toEqual([
      { type: "url", value: "https://h/x", href: "https://h/x" },
    ]);
  });

  it("http(비-https) URL도 매칭하고 href가 동일하다", () => {
    expect(tokenizeLogText("http://h/x")).toEqual([
      { type: "url", value: "http://h/x", href: "http://h/x" },
    ]);
  });

  it("후행 마침표는 URL에서 떼어 다음 text 토큰에 넣는다", () => {
    expect(tokenizeLogText("see https://react.dev/errors/185.")).toEqual([
      { type: "text", value: "see " },
      {
        type: "url",
        value: "https://react.dev/errors/185",
        href: "https://react.dev/errors/185",
      },
      { type: "text", value: "." },
    ]);
  });

  it("후행 쉼표를 떼고 다음 text 토큰에 합친다", () => {
    expect(tokenizeLogText("a https://h/x, b")).toEqual([
      { type: "text", value: "a " },
      { type: "url", value: "https://h/x", href: "https://h/x" },
      { type: "text", value: ", b" },
    ]);
  });

  it("괄호로 끝나는 V8 스택 URL은 ) 직전까지 매칭하고 href에서 :line:col을 뗀다", () => {
    expect(tokenizeLogText("at F3 (https://h/assets/index.js:55:27752)")).toEqual([
      { type: "text", value: "at F3 (" },
      {
        type: "url",
        value: "https://h/assets/index.js:55:27752",
        href: "https://h/assets/index.js",
      },
      { type: "text", value: ")" },
    ]);
  });

  it("괄호 포함 URL은 첫 )에서 절단된다(의도된 동작)", () => {
    expect(tokenizeLogText("https://en.wikipedia.org/wiki/Foo_(bar)")).toEqual([
      {
        type: "url",
        value: "https://en.wikipedia.org/wiki/Foo_(bar",
        href: "https://en.wikipedia.org/wiki/Foo_(bar",
      },
      { type: "text", value: ")" },
    ]);
  });

  it("line만 있는 URL은 href에서 :line을 뗀다", () => {
    expect(tokenizeLogText("https://h/a.js:55")).toEqual([
      { type: "url", value: "https://h/a.js:55", href: "https://h/a.js" },
    ]);
  });

  it("쿼리스트링은 통째로 URL이고 href가 동일하다", () => {
    expect(tokenizeLogText("https://h/p?a=b&c=d")).toEqual([
      {
        type: "url",
        value: "https://h/p?a=b&c=d",
        href: "https://h/p?a=b&c=d",
      },
    ]);
  });

  it("한 줄에 여러 URL을 각각 url 토큰으로 분리한다", () => {
    expect(tokenizeLogText("https://h/a https://h/b")).toEqual([
      { type: "url", value: "https://h/a", href: "https://h/a" },
      { type: "text", value: " " },
      { type: "url", value: "https://h/b", href: "https://h/b" },
    ]);
  });

  it("멀티라인에서 URL이 줄바꿈을 넘지 않고 각 줄로 분리된다", () => {
    expect(tokenizeLogText("a https://h/x\nb https://h/y")).toEqual([
      { type: "text", value: "a " },
      { type: "url", value: "https://h/x", href: "https://h/x" },
      { type: "text", value: "\nb " },
      { type: "url", value: "https://h/y", href: "https://h/y" },
    ]);
  });

  it("경로 없는 포트-only URL은 href에서 :포트가 깎인다(동작 문서화)", () => {
    expect(tokenizeLogText("https://h:8080")).toEqual([
      { type: "url", value: "https://h:8080", href: "https://h" },
    ]);
  });
});
