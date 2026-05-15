import { describe, it, expect } from "vitest";

import {
  extractInlineRefs,
  replaceInlineRefs,
  stripInlineImageRefs,
} from "../resolveInlineImages";

describe("extractInlineRefs", () => {
  it("inline 참조 없는 마크다운 → 빈 배열", () => {
    expect(extractInlineRefs("hello world")).toEqual([]);
    expect(extractInlineRefs("![](https://example.com/img.png)")).toEqual([]);
  });

  it("inline 참조 1개 → refId 추출", () => {
    const result = extractInlineRefs("![](inline:abc12345)");
    expect(result).toEqual(["abc12345"]);
  });

  it("alt text 포함 참조 → refId 추출", () => {
    const result = extractInlineRefs("![my image](inline:def67890)");
    expect(result).toEqual(["def67890"]);
  });

  it("여러 참조 → 전부 추출", () => {
    const md =
      "text ![](inline:aaa11111) middle ![alt](inline:bbb22222) end";
    const result = extractInlineRefs(md);
    expect(result).toEqual(["aaa11111", "bbb22222"]);
  });

  it("중복 참조 → 중복 제거", () => {
    const md = "![](inline:same1234) and ![](inline:same1234)";
    const result = extractInlineRefs(md);
    expect(result).toEqual(["same1234"]);
  });
});

describe("replaceInlineRefs", () => {
  it("참조 없는 마크다운 → 변경 없음", () => {
    const md = "hello world";
    expect(replaceInlineRefs(md, new Map())).toBe(md);
  });

  it("단일 참조 치환", () => {
    const md = "![](inline:abc12345)";
    const map = new Map([["abc12345", "data:image/png;base64,AAAA"]]);
    expect(replaceInlineRefs(md, map)).toBe(
      "![](data:image/png;base64,AAAA)",
    );
  });

  it("여러 참조 전부 치환", () => {
    const md = "![](inline:aaa) text ![alt](inline:bbb)";
    const map = new Map([
      ["aaa", "https://cdn.example.com/a.png"],
      ["bbb", "https://cdn.example.com/b.png"],
    ]);
    const result = replaceInlineRefs(md, map);
    expect(result).toBe(
      "![](https://cdn.example.com/a.png) text ![alt](https://cdn.example.com/b.png)",
    );
  });

  it("맵에 없는 참조 → 치환하지 않음", () => {
    const md = "![](inline:known) ![](inline:unknown)";
    const map = new Map([["known", "https://resolved.url"]]);
    const result = replaceInlineRefs(md, map);
    expect(result).toContain("https://resolved.url");
    expect(result).toContain("inline:unknown");
  });
});

describe("stripInlineImageRefs", () => {
  it("inline 참조 제거", () => {
    expect(stripInlineImageRefs("before ![](inline:abc) after")).toBe("before  after");
  });

  it("참조 없으면 원본 유지", () => {
    expect(stripInlineImageRefs("plain text")).toBe("plain text");
  });

  it("여러 참조 전부 제거", () => {
    const result = stripInlineImageRefs("![a](inline:x) middle ![b](inline:y)");
    expect(result).toBe("middle");
  });

  it("연속 줄바꿈 정리", () => {
    const result = stripInlineImageRefs("text\n\n\n\n![](inline:a)\n\n\n\nmore");
    expect(result).not.toContain("\n\n\n");
  });
});
