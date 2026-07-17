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

  // buildIssueHtml()이 이 함수를 쓰고 그 출력이 클립보드 HTML·logs.html 리포트로 나간다 —
  // 접기 마크업이 여기 섞이면 사용자가 트래커에 붙여넣는 본문에 pill이 딸려 들어간다.
  // 접기는 렌더된 DOM 위에서만 붙으므로 이 경로는 도입 전후로 동일해야 한다.
  it("긴 코드블럭을 렌더해도 접기 마크업이 섞이지 않는다", () => {
    const body = Array.from({ length: 30 }, (_, i) => `  "k${i}": ${i},`).join("\n");
    const html = renderMarkdown(`\`\`\`json\n{\n${body}\n}\n\`\`\``);

    expect(html).not.toContain("code-collapse");
    expect(html).not.toContain("펼치기");
    expect(html).not.toContain("Expand");
    expect(html).not.toContain("<button");
  });
});
