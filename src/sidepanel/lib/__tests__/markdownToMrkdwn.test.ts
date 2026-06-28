import { describe, expect, it } from "vitest";

import { escapeMrkdwn, markdownToMrkdwn } from "../markdownToMrkdwn";

// Slack mrkdwn은 마크다운과 문법이 다르다(볼드 `*`, 이탤릭 `_`, 링크 `<url|text>`,
// 헤딩 없음, 인라인 이미지 없음). 변환 규칙은 design.md "변환 규칙표" 기준.

describe("markdownToMrkdwn — 인라인 마크", () => {
  it("**bold** → *bold*", () => {
    expect(markdownToMrkdwn("**bold**")).toBe("*bold*");
  });

  it("*italic* / _italic_ → _italic_", () => {
    expect(markdownToMrkdwn("*italic*")).toBe("_italic_");
    expect(markdownToMrkdwn("_italic_")).toBe("_italic_");
  });

  it("~~strike~~ → ~strike~", () => {
    expect(markdownToMrkdwn("~~strike~~")).toBe("~strike~");
  });

  it("[text](url) → <url|text>", () => {
    expect(markdownToMrkdwn("[Google](https://google.com)")).toBe(
      "<https://google.com|Google>",
    );
  });

  it("![alt](url) 인라인 이미지는 제거 (Slack mrkdwn 미지원, 첨부로 분리)", () => {
    expect(markdownToMrkdwn("![shot](https://x/y.png)")).not.toContain("y.png");
    expect(markdownToMrkdwn("![shot](https://x/y.png)")).not.toContain("![");
  });
});

describe("markdownToMrkdwn — 블록", () => {
  it("# / ## 헤딩 → 볼드 줄 (mrkdwn 헤딩 문법 없음)", () => {
    expect(markdownToMrkdwn("# Title")).toBe("*Title*");
    expect(markdownToMrkdwn("## Sub")).toBe("*Sub*");
  });

  it("- item / * item 불릿 → • item", () => {
    expect(markdownToMrkdwn("- first")).toBe("• first");
    expect(markdownToMrkdwn("* second")).toBe("• second");
  });

  it("1. item 순서 리스트는 그대로 유지", () => {
    expect(markdownToMrkdwn("1. first")).toBe("1. first");
  });

  it("> quote는 그대로 유지 (mrkdwn 지원)", () => {
    expect(markdownToMrkdwn("> note")).toBe("> note");
  });

  it("코드블록 내부는 변환하지 않는다 (``` 보존)", () => {
    const md = "```\n**not bold**\n```";
    const out = markdownToMrkdwn(md);
    expect(out).toContain("**not bold**");
    expect(out).toContain("```");
  });

  it("인라인 `code`는 그대로 유지", () => {
    expect(markdownToMrkdwn("`x`")).toBe("`x`");
  });
});

describe("markdownToMrkdwn — 엣지", () => {
  it("빈 문자열 → 빈 문자열", () => {
    expect(markdownToMrkdwn("")).toBe("");
  });

  it("일반 텍스트는 변경 없음", () => {
    expect(markdownToMrkdwn("hello world")).toBe("hello world");
  });
});

describe("escapeMrkdwn — 특수문자 이스케이프", () => {
  it("< > & → &lt; &gt; &amp;", () => {
    expect(escapeMrkdwn("a < b > c & d")).toBe("a &lt; b &gt; c &amp; d");
  });

  it("셀렉터 div.foo > span 같은 입력을 안전하게 이스케이프", () => {
    expect(escapeMrkdwn("div > span")).toBe("div &gt; span");
  });

  it("특수문자 없으면 원본 그대로", () => {
    expect(escapeMrkdwn("plain text")).toBe("plain text");
  });

  it("빈 문자열 → 빈 문자열", () => {
    expect(escapeMrkdwn("")).toBe("");
  });
});
