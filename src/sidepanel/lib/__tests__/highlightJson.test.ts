import { describe, expect, it } from "vitest";
import { tokenizeJson, type JsonTokenKind } from "../highlightJson";

// 토큰 종류만 뽑아 비교 — 클래스 문자열은 JSON_TOKEN_CLASS 단일 출처의 몫.
function kinds(code: string): Array<[string, JsonTokenKind | null]> {
  return tokenizeJson(code).map((t) => [t.text, t.kind]);
}

describe("tokenizeJson", () => {
  it("key와 string 값을 구분한다 (콜론이 뒤따르면 key)", () => {
    expect(kinds('{"id": "abc"}')).toEqual([
      ["{", null],
      ['"id"', "key"],
      [": ", null],
      ['"abc"', "string"],
      ["}", null],
    ]);
  });

  it("number·boolean·null을 각각 분류", () => {
    expect(kinds("[1, -2.5e3, true, false, null]")).toEqual([
      ["[", null],
      ["1", "number"],
      [", ", null],
      ["-2.5e3", "number"],
      [", ", null],
      ["true", "boolean"],
      [", ", null],
      ["false", "boolean"],
      [", ", null],
      ["null", "null"],
      ["]", null],
    ]);
  });

  it("문자열 안의 콜론·중괄호는 토큰을 깨지 않는다", () => {
    expect(kinds('{"url": "https://x.dev/a:b{c}"}')).toEqual([
      ["{", null],
      ['"url"', "key"],
      [": ", null],
      ['"https://x.dev/a:b{c}"', "string"],
      ["}", null],
    ]);
  });

  it("이스케이프된 따옴표에서 문자열이 안 끊긴다", () => {
    expect(kinds('{"q": "say \\"hi\\""}')).toEqual([
      ["{", null],
      ['"q"', "key"],
      [": ", null],
      ['"say \\"hi\\""', "string"],
      ["}", null],
    ]);
  });

  // 헤더 라인의 status·경로 숫자도 number로 칠해진다 — Jira·Linear 하이라이터와 같은 동작이라
  // 의도적으로 허용한다(구분자 `--- response ---`와 메서드·경로는 평문).
  it("헤더 라인은 status 숫자만 칠하고 나머지는 평문", () => {
    expect(kinds('GET /api/x → 200 OK\n--- response ---\n{"a": 1}')).toEqual([
      ["GET /api/x → ", null],
      ["200", "number"],
      [" OK\n--- response ---\n{", null],
      ['"a"', "key"],
      [": ", null],
      ["1", "number"],
      ["}", null],
    ]);
  });

  it("숫자처럼 보이는 문자열 조각은 number로 안 샌다", () => {
    expect(kinds('{"v": "10230"}')).toEqual([
      ["{", null],
      ['"v"', "key"],
      [": ", null],
      ['"10230"', "string"],
      ["}", null],
    ]);
  });

  it("빈 문자열은 빈 배열", () => {
    expect(tokenizeJson("")).toEqual([]);
  });

  it("모든 토큰을 이으면 원문이 복원된다 (문자 유실 없음)", () => {
    const code = 'GET /a → 200\n--- response ---\n{\n  "n": null,\n  "s": "x",\n  "t": true\n}';

    expect(
      tokenizeJson(code)
        .map((t) => t.text)
        .join(""),
    ).toBe(code);
  });
});
