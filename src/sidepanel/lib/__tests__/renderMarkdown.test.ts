import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../renderMarkdown";

describe("renderMarkdown", () => {
  it("plain text → <p>", () => {
    expect(renderMarkdown("hello")).toContain("<p>hello</p>");
  });

  it("**bold** → <strong>", () => {
    expect(renderMarkdown("**bold**")).toContain("<strong>bold</strong>");
  });

  it("*italic* → <em>", () => {
    expect(renderMarkdown("*italic*")).toContain("<em>italic</em>");
  });

  it("`code` → <code>", () => {
    expect(renderMarkdown("`code`")).toContain("<code>code</code>");
  });

  it("~~strike~~ → <s>", () => {
    expect(renderMarkdown("~~strike~~")).toContain("<s>strike</s>");
  });

  it("[text](url) → <a>", () => {
    const html = renderMarkdown("[click](https://example.com)");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain(">click</a>");
  });

  it("- item → <ul><li>", () => {
    const html = renderMarkdown("- item1\n- item2");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>item1</li>");
  });

  it("1. item → <ol><li>", () => {
    const html = renderMarkdown("1. first\n2. second");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>first</li>");
  });

  it("--- → <hr>", () => {
    expect(renderMarkdown("---")).toContain("<hr>");
  });

  it("![alt](src) → <img>", () => {
    const html = renderMarkdown("![alt text](https://example.com/img.png)");
    expect(html).toContain('<img src="https://example.com/img.png" alt="alt text">');
  });

  it("줄바꿈 보존 (breaks: true)", () => {
    const html = renderMarkdown("line1\nline2");
    expect(html).toContain("<br>");
  });

  it("빈 문자열 → 빈 출력", () => {
    expect(renderMarkdown("").trim()).toBe("");
  });

  describe("XSS 방어", () => {
    it("<script> 태그 → 이스케이프", () => {
      const html = renderMarkdown("<script>alert(1)</script>");
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });

    it("<img onerror> → 이스케이프 (raw 태그 아님)", () => {
      const html = renderMarkdown('<img onerror="alert(1)" src="x">');
      expect(html).not.toContain("<img ");
      expect(html).toContain("&lt;img");
    });

    it("[link](javascript:) → href에 javascript: 없음", () => {
      const html = renderMarkdown("[click](javascript:alert(1))");
      expect(html).not.toContain('href="javascript:');
      expect(html).not.toContain("<a ");
    });

    it("[link](JAVASCRIPT:) → 대소문자 무관 차단", () => {
      const html = renderMarkdown("[click](JAVASCRIPT:alert(1))");
      expect(html).not.toContain("<a ");
    });

    it("<iframe> → 이스케이프", () => {
      const html = renderMarkdown('<iframe src="evil.com"></iframe>');
      expect(html).not.toContain("<iframe");
      expect(html).toContain("&lt;iframe");
    });
  });
});

describe("renderMarkdown — 삽입된 로그 코드블럭 하이라이팅", () => {
  it("```json 펜스는 토큰별 span으로 칠한다", () => {
    const html = renderMarkdown('```json\n{"id": 1}\n```');

    expect(html).toContain('<span class="text-purple-700 dark:text-purple-400">&quot;id&quot;</span>');
    expect(html).toContain('<span class="text-blue-700 dark:text-blue-400">1</span>');
  });

  it("language 없는 펜스는 칠하지 않는다 (우리가 만든 콘텐츠가 아님)", () => {
    const html = renderMarkdown('```\n{"id": 1}\n```');

    expect(html).not.toContain("<span");
  });

  it("코드 안의 HTML은 escape된다 (span 주입으로 새지 않음)", () => {
    const html = renderMarkdown('```json\n{"x": "<img src=x onerror=alert(1)>"}\n```');

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
