import { describe, expect, it } from "vitest";
import { splitHighlight, type HighlightSegment } from "../highlight-text";

// 세그먼트 텍스트를 이어붙이면 항상 원문과 같아야 한다(비손실 분할 불변식).
function joined(segs: HighlightSegment[]): string {
  return segs.map((s) => s.text).join("");
}

describe("splitHighlight", () => {
  it("빈 쿼리는 원문 단일 비매칭 세그먼트를 반환한다", () => {
    expect(splitHighlight("hello world", "")).toEqual([
      { text: "hello world", match: false },
    ]);
  });

  it("무매칭이면 원문 단일 비매칭 세그먼트를 반환한다", () => {
    expect(splitHighlight("hello world", "zzz")).toEqual([
      { text: "hello world", match: false },
    ]);
  });

  it("쿼리가 텍스트보다 길면 단일 비매칭 세그먼트", () => {
    expect(splitHighlight("hi", "hello")).toEqual([{ text: "hi", match: false }]);
  });

  it("중간 매칭을 before/match/after로 쪼갠다", () => {
    expect(splitHighlight("hello world", "lo w")).toEqual([
      { text: "hel", match: false },
      { text: "lo w", match: true },
      { text: "orld", match: false },
    ]);
  });

  it("맨 앞 매칭은 앞쪽 빈 세그먼트를 만들지 않는다", () => {
    expect(splitHighlight("hello", "he")).toEqual([
      { text: "he", match: true },
      { text: "llo", match: false },
    ]);
  });

  it("맨 끝 매칭은 뒤쪽 빈 세그먼트를 만들지 않는다", () => {
    expect(splitHighlight("hello", "lo")).toEqual([
      { text: "hel", match: false },
      { text: "lo", match: true },
    ]);
  });

  it("다중 매칭에서 원문 대소문자를 보존한다", () => {
    expect(splitHighlight("Screenshot annotated screenshot", "screenshot")).toEqual([
      { text: "Screenshot", match: true },
      { text: " annotated ", match: false },
      { text: "screenshot", match: true },
    ]);
  });

  it("대소문자를 무시한다(쿼리가 대문자여도 매칭)", () => {
    expect(splitHighlight("screenshot", "SCREEN")).toEqual([
      { text: "screen", match: true },
      { text: "shot", match: false },
    ]);
  });

  it("정규식 특수문자를 리터럴로 매칭한다", () => {
    expect(splitHighlight("call api.v2(x) now", "api.v2(x)")).toEqual([
      { text: "call ", match: false },
      { text: "api.v2(x)", match: true },
      { text: " now", match: false },
    ]);
  });

  it("정규식 메타문자가 와일드카드로 동작하지 않는다", () => {
    // "a.c"가 정규식이면 "axc"에 매칭되지만, 리터럴이므로 무매칭이어야 한다.
    expect(splitHighlight("axc", "a.c")).toEqual([{ text: "axc", match: false }]);
  });

  it("연속 매칭을 비중첩으로 좌→우 소비한다", () => {
    expect(splitHighlight("aaaa", "aa")).toEqual([
      { text: "aa", match: true },
      { text: "aa", match: true },
    ]);
  });

  it("분할 결과를 이어붙이면 원문과 동일하다(불변식)", () => {
    const text = "GET https://api.example.com/v2/users?id=42";
    expect(joined(splitHighlight(text, "example"))).toBe(text);
    expect(joined(splitHighlight(text, ""))).toBe(text);
    expect(joined(splitHighlight(text, "zzz"))).toBe(text);
  });
});
