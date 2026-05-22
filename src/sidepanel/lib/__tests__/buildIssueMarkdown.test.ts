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

vi.mock("@/store/settings-ui-store", () => ({
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
    environment: [],
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

  it("meta comment에 os·browser·captureMode 포함", () => {
    const md = buildIssueMarkdown(makeCtx({ os: "macOS 15.2", browser: "Chrome 128.0.6613.85" }));
    const metaStart = md.indexOf("<!-- bugshot-meta-for-ai");
    const metaEnd = md.indexOf("-->", metaStart);
    const meta = JSON.parse(md.slice(metaStart + "<!-- bugshot-meta-for-ai\n".length, metaEnd));
    expect(meta.os).toBe("macOS 15.2");
    expect(meta.browser).toBe("Chrome 128.0.6613.85");
    expect(meta.captureMode).toBe("element");
  });

  it("meta comment — os·browser 없으면 필드 생략", () => {
    const md = buildIssueMarkdown(makeCtx({ os: null, browser: null }));
    const metaStart = md.indexOf("<!-- bugshot-meta-for-ai");
    const metaEnd = md.indexOf("-->", metaStart);
    const meta = JSON.parse(md.slice(metaStart + "<!-- bugshot-meta-for-ai\n".length, metaEnd));
    expect(meta.os).toBeUndefined();
    expect(meta.browser).toBeUndefined();
    expect(meta.captureMode).toBe("element");
  });

  it("meta comment에 사용자 커스텀 환경 필드 포함", () => {
    const md = buildIssueMarkdown(makeCtx({
      environment: [
        { label: "Device", value: "iPhone 14" },
        { label: "Network", value: "Wi-Fi" },
      ],
    }));
    const metaStart = md.indexOf("<!-- bugshot-meta-for-ai");
    const metaEnd = md.indexOf("-->", metaStart);
    const meta = JSON.parse(md.slice(metaStart + "<!-- bugshot-meta-for-ai\n".length, metaEnd));
    expect(meta.environment).toEqual({ Device: "iPhone 14", Network: "Wi-Fi" });
  });

  it("meta comment — 커스텀 환경 필드 비어있으면 environment 생략", () => {
    const md = buildIssueMarkdown(makeCtx({ environment: [] }));
    const metaStart = md.indexOf("<!-- bugshot-meta-for-ai");
    const metaEnd = md.indexOf("-->", metaStart);
    const meta = JSON.parse(md.slice(metaStart + "<!-- bugshot-meta-for-ai\n".length, metaEnd));
    expect(meta.environment).toBeUndefined();
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

describe("buildIssueMarkdown — freeform", () => {
  const freeformCtx = (overrides: Partial<MarkdownContext> = {}) =>
    makeCtx({
      captureMode: "freeform" as MarkdownContext["captureMode"],
      selector: "",
      diffs: [],
      ...overrides,
    });

  it("freeform 모드 → 미디어 섹션 없음 (스타일 테이블·이미지·비디오 모두 미출력)", () => {
    const md = buildIssueMarkdown(freeformCtx());
    expect(md).not.toContain("md.section.styleChanges");
    expect(md).not.toContain("md.section.media");
    expect(md).not.toContain("md.imageAttached");
    expect(md).not.toContain("md.videoAttached");
  });

  it("freeform 모드 → DOM 생략", () => {
    const md = buildIssueMarkdown(freeformCtx());
    expect(md).not.toContain("**DOM**");
  });

  it("freeform 모드 → viewport null이면 Viewport 줄 생략", () => {
    const md = buildIssueMarkdown(
      freeformCtx({ viewport: null as any }),
    );
    expect(md).not.toContain("**Viewport**");
  });

  it("freeform 모드 → viewport 있으면 Viewport 줄 포함", () => {
    const md = buildIssueMarkdown(freeformCtx());
    expect(md).toContain("1920×1080");
  });

  it("freeform 모드 → 환경 정보(Page, Captured) 정상 포함", () => {
    const md = buildIssueMarkdown(freeformCtx());
    expect(md).toContain("https://example.com/page");
    expect(md).toContain("**Captured**");
  });

  it("freeform 모드 → 네트워크 로그 요약 포함", () => {
    const md = buildIssueMarkdown(
      freeformCtx({
        networkLogSummary: {
          captured: 5,
          errors: [{ method: "POST", path: "/api/submit", status: 502, statusText: "Bad Gateway" }],
        },
      }),
    );
    expect(md).toContain("logSummary.network.title");
    expect(md).toContain("POST /api/submit → 502 Bad Gateway");
  });

  it("freeform 모드 → meta comment에 selector/tagName 미포함", () => {
    const md = buildIssueMarkdown(freeformCtx());
    expect(md).toContain("<!-- bugshot-meta-for-ai");
    const metaStart = md.indexOf("<!-- bugshot-meta-for-ai");
    const metaEnd = md.indexOf("-->", metaStart);
    const metaBlock = md.slice(metaStart, metaEnd);
    expect(metaBlock).not.toContain('"selector"');
  });
});

describe("buildIssueHtml — freeform", () => {
  const freeformCtx = (overrides: Partial<MarkdownContext> = {}) =>
    makeCtx({
      captureMode: "freeform" as MarkdownContext["captureMode"],
      selector: "",
      diffs: [],
      ...overrides,
    });

  it("freeform 모드 → 미디어 섹션 없음", () => {
    const html = buildIssueHtml(freeformCtx());
    expect(html).not.toContain("md.section.styleChanges");
    expect(html).not.toContain("md.section.media");
    expect(html).not.toContain("md.imageAttached");
    expect(html).not.toContain("md.videoAttached");
  });

  it("freeform 모드 → DOM 생략", () => {
    const html = buildIssueHtml(freeformCtx());
    expect(html).not.toContain("<strong>DOM</strong>");
  });

  it("freeform 모드 → viewport null이면 Viewport 줄 생략", () => {
    const html = buildIssueHtml(
      freeformCtx({ viewport: null as any }),
    );
    expect(html).not.toContain("Viewport");
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

  it("paragraph 섹션 마크다운 → HTML 렌더링", () => {
    const html = buildIssueHtml(
      makeCtx({ sections: { description: "**bold** and *italic*" } }),
    );
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("paragraph 섹션 빈 값 → noValue", () => {
    const html = buildIssueHtml(makeCtx({ sections: {} }));
    expect(html).toContain("md.noValue");
  });
});

describe("buildIssueMarkdown — browser 환경 정보", () => {
  it("browser 있으면 Page 행 위에 Browser 행 출력", () => {
    const md = buildIssueMarkdown(makeCtx({ browser: "Chrome 128.0.6613.85" }));
    const browserIdx = md.indexOf("**Browser**: Chrome 128.0.6613.85");
    const pageIdx = md.indexOf("**Page**:");
    expect(browserIdx).toBeGreaterThan(-1);
    expect(browserIdx).toBeLessThan(pageIdx);
  });

  it("browser null이면 Browser 행 미출력", () => {
    const md = buildIssueMarkdown(makeCtx({ browser: null }));
    expect(md).not.toContain("**Browser**");
  });

  it("browser 미전달이면 Browser 행 미출력 (하위호환)", () => {
    const md = buildIssueMarkdown(makeCtx());
    expect(md).not.toContain("**Browser**");
  });
});

describe("buildIssueHtml — browser 환경 정보", () => {
  it("browser 있으면 Page 행 위에 Browser 행 출력", () => {
    const html = buildIssueHtml(makeCtx({ browser: "Chrome 128.0.6613.85" }));
    const browserIdx = html.indexOf("<strong>Browser</strong>: Chrome 128.0.6613.85");
    const pageIdx = html.indexOf("<strong>Page</strong>:");
    expect(browserIdx).toBeGreaterThan(-1);
    expect(browserIdx).toBeLessThan(pageIdx);
  });

  it("browser null이면 Browser 행 미출력", () => {
    const html = buildIssueHtml(makeCtx({ browser: null }));
    expect(html).not.toContain("<strong>Browser</strong>");
  });
});

describe("buildIssueMarkdown — os 환경 정보", () => {
  it("os 있으면 Browser 행 위에 OS 행 출력", () => {
    const md = buildIssueMarkdown(makeCtx({ os: "macOS 15.2", browser: "Chrome 128.0.6613.85" }));
    const osIdx = md.indexOf("**OS**: macOS 15.2");
    const browserIdx = md.indexOf("**Browser**: Chrome 128.0.6613.85");
    expect(osIdx).toBeGreaterThan(-1);
    expect(osIdx).toBeLessThan(browserIdx);
  });

  it("os null이면 OS 행 미출력", () => {
    const md = buildIssueMarkdown(makeCtx({ os: null }));
    expect(md).not.toContain("**OS**");
  });

  it("os 미전달이면 OS 행 미출력 (하위호환)", () => {
    const md = buildIssueMarkdown(makeCtx());
    expect(md).not.toContain("**OS**");
  });
});

describe("buildIssueHtml — os 환경 정보", () => {
  it("os 있으면 Browser 행 위에 OS 행 출력", () => {
    const html = buildIssueHtml(makeCtx({ os: "macOS 15.2", browser: "Chrome 128.0.6613.85" }));
    const osIdx = html.indexOf("<strong>OS</strong>: macOS 15.2");
    const browserIdx = html.indexOf("<strong>Browser</strong>: Chrome 128.0.6613.85");
    expect(osIdx).toBeGreaterThan(-1);
    expect(osIdx).toBeLessThan(browserIdx);
  });

  it("os null이면 OS 행 미출력", () => {
    const html = buildIssueHtml(makeCtx({ os: null }));
    expect(html).not.toContain("<strong>OS</strong>");
  });
});

describe("buildIssueMarkdown — custom environment rows", () => {
  it("custom row가 Environment 섹션 불릿으로 포함", () => {
    const md = buildIssueMarkdown(
      makeCtx({
        environment: [{ label: "Browser", value: "Chrome 140" }],
      }),
    );
    expect(md).toContain("- **Browser**: Chrome 140");
  });

  it("label·value 빈 row는 제외", () => {
    const md = buildIssueMarkdown(
      makeCtx({
        environment: [
          { label: "", value: "ignored" },
          { label: "OS", value: "  " },
        ],
      }),
    );
    expect(md).not.toContain("ignored");
    expect(md).not.toContain("**OS**");
  });

  it("value 개행은 공백으로 치환", () => {
    const md = buildIssueMarkdown(
      makeCtx({ environment: [{ label: "OS", value: "macOS\n15" }] }),
    );
    expect(md).toContain("- **OS**: macOS 15");
  });
});

describe("buildIssueHtml — custom environment rows", () => {
  it("custom row가 Environment <li>로 포함", () => {
    const html = buildIssueHtml(
      makeCtx({ environment: [{ label: "Browser", value: "Chrome 140" }] }),
    );
    expect(html).toContain("<li><strong>Browser</strong>: Chrome 140</li>");
  });

  it("custom row label·value HTML 이스케이프", () => {
    const html = buildIssueHtml(
      makeCtx({ environment: [{ label: "Env", value: "<b>x</b>" }] }),
    );
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("빈 row 제외", () => {
    const html = buildIssueHtml(
      makeCtx({ environment: [{ label: "  ", value: "  " }] }),
    );
    expect(html).not.toContain("<strong></strong>");
  });
});
