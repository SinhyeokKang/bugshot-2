import { describe, expect, it } from "vitest";
import { markdownToAsanaHtml } from "../markdownToAsanaHtml";

describe("markdownToAsanaHtml", () => {
  it("빈 입력 → <body></body>로만 래핑", () => {
    const out = markdownToAsanaHtml("");
    expect(out.startsWith("<body>")).toBe(true);
    expect(out.endsWith("</body>")).toBe(true);
  });

  it("출력은 항상 <body>로 래핑", () => {
    const out = markdownToAsanaHtml("hello");
    expect(out).toMatch(/^<body>[\s\S]*<\/body>$/);
    expect(out).toContain("hello");
  });

  it("# / ## 헤딩 → <h1>/<h2>", () => {
    expect(markdownToAsanaHtml("# Title")).toContain("<h1>Title</h1>");
    expect(markdownToAsanaHtml("## Sub")).toContain("<h2>Sub</h2>");
  });

  it("### 이상 헤딩은 <strong>으로 폴백 (Asana는 h1/h2만 허용)", () => {
    expect(markdownToAsanaHtml("### Deep")).toContain("<strong>Deep</strong>");
    expect(markdownToAsanaHtml("### Deep")).not.toContain("<h3>");
  });

  it("bold/italic → <strong>/<em>", () => {
    expect(markdownToAsanaHtml("**b**")).toContain("<strong>b</strong>");
    expect(markdownToAsanaHtml("*i*")).toContain("<em>i</em>");
  });

  it("inline code → <code>", () => {
    expect(markdownToAsanaHtml("`x`")).toContain("<code>x</code>");
  });

  it("링크 → <a href>", () => {
    const out = markdownToAsanaHtml("[label](https://example.com)");
    expect(out).toContain('<a href="https://example.com">label</a>');
  });

  it("코드펜스 → <pre>", () => {
    const out = markdownToAsanaHtml("```\nconst a = 1;\n```");
    expect(out).toContain("<pre>");
    expect(out).toContain("const a = 1;");
  });

  it("순서 없는 리스트 → <ul><li>", () => {
    const out = markdownToAsanaHtml("- a\n- b");
    expect(out).toContain("<ul>");
    expect(out).toContain("<li>a</li>");
    expect(out).toContain("<li>b</li>");
  });

  it("순서 있는 리스트 → <ol><li>", () => {
    const out = markdownToAsanaHtml("1. a\n2. b");
    expect(out).toContain("<ol>");
    expect(out).toContain("<li>a</li>");
  });

  it("blockquote → <blockquote>, --- → <hr>", () => {
    expect(markdownToAsanaHtml("> quote")).toContain("<blockquote>");
    expect(markdownToAsanaHtml("---")).toContain("<hr");
  });

  it("이미지 ![alt](url) → gid map 없으면 캡션 텍스트만, <img>·url 없음", () => {
    const out = markdownToAsanaHtml("![Screenshot](blob:abc-123)");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("blob:abc-123");
    expect(out).toContain("Screenshot");
  });

  it("이미지 src가 ref map에 있으면 <img data-asana-gid> + 크기/스타일로 인라인", () => {
    const out = markdownToAsanaHtml("![cap](shot.webp)", {
      "shot.webp": { gid: "1209876", width: 800, height: 600 },
    });
    expect(out).toContain(
      '<img data-asana-gid="1209876" data-src-width="800" data-src-height="600" style="display:block;max-width:100%">',
    );
    expect(out).not.toContain("shot.webp");
  });

  it("viewUrl이 있으면 src 속성 포함 (인라인 렌더용)", () => {
    const out = markdownToAsanaHtml("![cap](shot.webp)", {
      "shot.webp": {
        gid: "1",
        viewUrl: "https://asana.com/app/view/1",
        width: 800,
        height: 600,
      },
    });
    expect(out).toContain('src="https://asana.com/app/view/1"');
    expect(out).toContain('data-asana-gid="1"');
    expect(out).toContain('data-src-width="800"');
  });

  it("크기 미상이면 data-asana-gid + style만 (data-src-* 생략)", () => {
    const out = markdownToAsanaHtml("![cap](shot.webp)", {
      "shot.webp": { gid: "1209876" },
    });
    expect(out).toContain(
      '<img data-asana-gid="1209876" style="display:block;max-width:100%">',
    );
    expect(out).not.toContain("data-src-width");
  });

  it("ref map에 없는 이미지는 캡션 폴백 (업로드 실패/미매칭)", () => {
    const out = markdownToAsanaHtml("![cap](missing.webp)", {
      "other.webp": { gid: "111" },
    });
    expect(out).not.toContain("<img");
    expect(out).toContain("cap");
  });

  it("테이블 → <pre> 폴백, <table> 미사용, 컬럼 공백 정렬", () => {
    const md = [
      "| Property | Before | After |",
      "| --- | --- | --- |",
      "| color | red | blue |",
    ].join("\n");
    const out = markdownToAsanaHtml(md);
    expect(out).toContain("<pre>");
    expect(out).not.toContain("<table");
    for (const v of ["Property", "Before", "After", "color", "red", "blue"]) {
      expect(out).toContain(v);
    }
    // 정렬 검증: <pre> 내부 데이터 행들의 길이가 모두 동일 (컬럼별 max-width 패딩)
    const pre = out.match(/<pre>([\s\S]*?)<\/pre>/)?.[1] ?? "";
    const lines = pre.split("\n").filter((l) => l.trim().length > 0);
    const widths = new Set(lines.map((l) => l.length));
    expect(widths.size).toBe(1);
  });
});
