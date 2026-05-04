import { describe, it, expect, vi } from "vitest";

vi.mock("@/i18n", () => ({
  t: (key: string, params?: Record<string, string | number>) => {
    if (params) {
      let s = key;
      for (const [k, v] of Object.entries(params)) s += ` ${k}=${v}`;
      return s;
    }
    return key;
  },
  dateBcp47: () => "en-US",
}));

vi.mock("@/store/app-settings-store", () => ({
  POST_MEDIA_SECTION_IDS: new Set(["expectedResult", "notes"]),
  sectionMdLabelKey: (id: string) => `md.section.${id}`,
}));

import {
  networkLogPath,
  buildIssueMarkdown,
  buildIssueHtml,
  type MarkdownContext,
} from "../buildIssueMarkdown";

function makeCtx(overrides: Partial<MarkdownContext> = {}): MarkdownContext {
  return {
    captureMode: "element",
    title: "Test Issue",
    sections: { description: "버그 설명", stepsToReproduce: "1단계\n2단계" },
    sectionConfig: [
      { id: "description", enabled: true, renderAs: "paragraph", builtIn: true },
      { id: "stepsToReproduce", enabled: true, renderAs: "orderedList", builtIn: true },
      { id: "expectedResult", enabled: true, renderAs: "paragraph", builtIn: true },
      { id: "notes", enabled: false, renderAs: "paragraph", builtIn: true },
    ],
    url: "https://example.com/page",
    selector: "div.container",
    tagName: "div",
    classListBefore: ["container"],
    classListAfter: ["container"],
    specifiedStyles: {},
    tokens: [],
    viewport: { width: 1920, height: 1080 },
    capturedAt: 1700000000000,
    diffs: [
      { prop: "color", asIs: "#000", toBe: "#fff" },
    ],
    ...overrides,
  };
}

describe("networkLogPath", () => {
  it("정상 URL → pathname", () => {
    expect(networkLogPath("https://example.com/api/data?q=1")).toBe("/api/data");
  });

  it("잘못된 URL → 원본", () => {
    expect(networkLogPath("not-a-url")).toBe("not-a-url");
  });
});

describe("buildIssueMarkdown", () => {
  it("타이틀 포함", () => {
    const md = buildIssueMarkdown(makeCtx());
    expect(md).toContain("# Test Issue");
  });

  it("환경 정보 포함", () => {
    const md = buildIssueMarkdown(makeCtx());
    expect(md).toContain("https://example.com/page");
    expect(md).toContain("div.container");
    expect(md).toContain("1920×1080");
  });

  it("element 모드 → 스타일 diff 테이블", () => {
    const md = buildIssueMarkdown(makeCtx());
    expect(md).toContain("| color | #000 | #fff |");
  });

  it("video 모드 → media 섹션", () => {
    const md = buildIssueMarkdown(makeCtx({ captureMode: "video", selector: "" }));
    expect(md).toContain("md.videoAttached");
    expect(md).not.toContain("| color |");
  });

  it("screenshot 모드 → DOM 셀렉터 생략", () => {
    const md = buildIssueMarkdown(makeCtx({ captureMode: "screenshot", selector: "" }));
    expect(md).not.toContain("**DOM**");
    expect(md).toContain("md.imageAttached");
  });

  it("disabled 섹션 미출력", () => {
    const md = buildIssueMarkdown(makeCtx());
    expect(md).not.toContain("md.section.notes");
  });

  it("orderedList 렌더", () => {
    const md = buildIssueMarkdown(makeCtx());
    expect(md).toContain("1. 1단계");
    expect(md).toContain("2. 2단계");
  });

  it("빈 섹션 → noValue", () => {
    const md = buildIssueMarkdown(makeCtx({ sections: {} }));
    expect(md).toContain("md.noValue");
  });

  it("POST_MEDIA 위치: expectedResult 전에 media emit", () => {
    const md = buildIssueMarkdown(makeCtx());
    const styleIdx = md.indexOf("md.section.styleChanges");
    const expectedIdx = md.indexOf("md.section.expectedResult");
    expect(styleIdx).toBeGreaterThan(-1);
    expect(expectedIdx).toBeGreaterThan(-1);
    expect(styleIdx).toBeLessThan(expectedIdx);
  });

  it("footer 포함", () => {
    const md = buildIssueMarkdown(makeCtx());
    expect(md).toContain("BugShot");
    expect(md).toContain("---");
  });

  it("meta comment 포함", () => {
    const md = buildIssueMarkdown(makeCtx());
    expect(md).toContain("<!-- bugshot-meta-for-ai");
    expect(md).toContain('"version": 1');
  });

  it("네트워크 로그 요약 포함", () => {
    const md = buildIssueMarkdown(
      makeCtx({
        networkLogSummary: {
          captured: 10,
          errors: [{ method: "GET", path: "/api", status: 500, statusText: "Error" }],
        },
      }),
    );
    expect(md).toContain("logSummary.network.title");
    expect(md).toContain("GET /api → 500 Error");
  });

  it("pipe 문자 이스케이프", () => {
    const md = buildIssueMarkdown(
      makeCtx({ diffs: [{ prop: "content", asIs: "a|b", toBe: "c|d" }] }),
    );
    expect(md).toContain("a\\|b");
  });
});

describe("buildIssueHtml", () => {
  it("HTML 태그 포함", () => {
    const html = buildIssueHtml(makeCtx());
    expect(html).toContain("<h1>");
    expect(html).toContain("<table>");
    expect(html).toContain("<hr>");
  });

  it("HTML 이스케이프", () => {
    const html = buildIssueHtml(makeCtx({ title: "Bug <script>alert(1)</script>" }));
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("orderedList → <ol>", () => {
    const html = buildIssueHtml(makeCtx());
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>");
  });
});
