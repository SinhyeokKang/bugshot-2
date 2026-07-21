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
  buildIssueMarkdown,
  buildIssueHtml,
  mergeStyleElements,
  joinStyleSelectors,
  styleSelectorList,
  escapeMdLinkText,
  type MarkdownContext,
  type StyleElementContext,
} from "../buildIssueMarkdown";
import type {
  BufferedElement,
  EditorSelection,
  EditorStyleEdits,
} from "@/store/editor-store";

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

function parseMeta(md: string): Record<string, any> {
  const start = md.indexOf("<!-- bugshot-meta-for-ai");
  const end = md.indexOf("-->", start);
  return JSON.parse(md.slice(start + "<!-- bugshot-meta-for-ai\n".length, end));
}

describe("escapeMdLinkText", () => {
  it("일반 파일명은 그대로", () => {
    expect(escapeMdLinkText("report.pdf")).toBe("report.pdf");
  });

  it("대괄호는 백슬래시 이스케이프(링크 조기 종료 방지)", () => {
    expect(escapeMdLinkText("a[1].png")).toBe("a\\[1\\].png");
    expect(escapeMdLinkText("[draft] notes.md")).toBe("\\[draft\\] notes.md");
  });

  it("백슬래시 자체도 이스케이프", () => {
    expect(escapeMdLinkText("a\\b.txt")).toBe("a\\\\b.txt");
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
          errors: [{ id: "nr-t1", method: "GET", path: "/api", status: 500, statusText: "Error" }],
        },
      }),
    );
    expect(md).toContain("logSummary.title");
    expect(md).toContain("logSummary.network.line");
    expect(md).not.toContain("logSummary.network.title");
    expect(md).not.toContain("GET /api → 500 Error");
  });

  it("pipe 문자 이스케이프", () => {
    const md = buildIssueMarkdown(
      makeCtx({ diffs: [{ prop: "content", asIs: "a|b", toBe: "c|d" }] }),
    );
    expect(md).toContain("a\\|b");
  });

  it("class 행: 변경/추가된 토큰만 **볼드**로 출력", () => {
    const md = buildIssueMarkdown(
      makeCtx({
        diffs: [
          {
            prop: "class",
            asIs: "card text-blue-500",
            toBe: "card text-red-500",
            asIsSegments: [
              { text: "card", changed: false },
              { text: "text-blue-500", changed: true },
            ],
            toBeSegments: [
              { text: "card", changed: false },
              { text: "text-red-500", changed: true },
            ],
          },
        ],
      }),
    );
    expect(md).toContain(
      "| class | card **text-blue-500** | card **text-red-500** |",
    );
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
          errors: [{ id: "nr-t2", method: "POST", path: "/api/submit", status: 502, statusText: "Bad Gateway" }],
        },
      }),
    );
    expect(md).toContain("logSummary.title");
    expect(md).toContain("logSummary.network.line");
    expect(md).not.toContain("POST /api/submit → 502 Bad Gateway");
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

describe("buildIssueMarkdown — element + diffs 없음 (no-diff 폐지: media 폴백 제거)", () => {
  const noDiffCtx = (overrides: Partial<MarkdownContext> = {}) =>
    makeCtx({ diffs: [], ...overrides });

  it("element 모드 + diffs=[] → media 폴백 없음", () => {
    const md = buildIssueMarkdown(noDiffCtx());
    expect(md).not.toContain("md.section.media");
    expect(md).not.toContain("md.imageAttached");
  });

  it("element 모드 + diffs=[] → Style Changes 미출력", () => {
    const md = buildIssueMarkdown(noDiffCtx());
    expect(md).not.toContain("md.section.styleChanges");
  });

  it("element 모드 + diffs 존재 → Style Changes (selector) 테이블 유지", () => {
    const md = buildIssueMarkdown(
      noDiffCtx({ diffs: [{ prop: "color", asIs: "#000", toBe: "#fff" }] }),
    );
    expect(md).toContain("md.section.styleChanges (div.container)");
    expect(md).toContain("| color | #000 | #fff |");
    expect(md).not.toContain("md.imageAttached");
  });

  it("element 모드 + diffs=[] → DOM 환경 정보는 유지", () => {
    const md = buildIssueMarkdown(noDiffCtx());
    expect(md).toContain("div.container");
  });
});

describe("buildIssueHtml — element + diffs 없음 (no-diff 폐지)", () => {
  const noDiffCtx = (overrides: Partial<MarkdownContext> = {}) =>
    makeCtx({ diffs: [], ...overrides });

  it("element 모드 + diffs=[] → media 폴백 없음", () => {
    const html = buildIssueHtml(noDiffCtx());
    expect(html).not.toContain("md.section.media");
    expect(html).not.toContain("md.imageAttached");
  });

  it("element 모드 + diffs=[] → Style Changes 미출력", () => {
    const html = buildIssueHtml(noDiffCtx());
    expect(html).not.toContain("md.section.styleChanges");
  });

  it("element 모드 + diffs=[] → table 미출력", () => {
    const html = buildIssueHtml(noDiffCtx());
    expect(html).not.toContain("<table>");
  });

  it("element 모드 + diffs 존재 → Style Changes (selector) 테이블 유지", () => {
    const html = buildIssueHtml(
      noDiffCtx({ diffs: [{ prop: "color", asIs: "#000", toBe: "#fff" }] }),
    );
    expect(html).toContain("md.section.styleChanges (div.container)");
    expect(html).toContain("<table>");
    expect(html).not.toContain("md.imageAttached");
  });
});

describe("buildIssueMarkdown — 복수 styleElements 직렬화", () => {
  const styleEl = (
    selector: string,
    i: number,
    diffs: { prop: string; asIs: string; toBe: string }[],
  ) => ({
    selector,
    tagName: "div",
    classListBefore: [],
    classListAfter: [],
    specifiedStyles: {},
    diffs,
    beforeFilename: `before-${i}.webp`,
    afterFilename: `after-${i}.webp`,
  });

  it("styleElements 2개 → 섹션·테이블 2개 + DOM 쉼표 나열", () => {
    const md = buildIssueMarkdown(
      makeCtx({
        styleElements: [
          styleEl("button.cta", 0, [{ prop: "color", asIs: "#000", toBe: "#fff" }]),
          styleEl("div.card", 1, [{ prop: "padding", asIs: "10px", toBe: "20px" }]),
        ],
      }),
    );
    expect(md).toContain("md.section.styleChanges (button.cta)");
    expect(md).toContain("md.section.styleChanges (div.card)");
    expect(md).toContain("| color | #000 | #fff |");
    expect(md).toContain("| padding | 10px | 20px |");
    expect(md).toContain("- **DOM**: `button.cta`, `div.card`");
  });

  it("styleElements 1개 → (selector) 단일 형식", () => {
    const md = buildIssueMarkdown(
      makeCtx({
        styleElements: [
          styleEl("button.cta", 0, [{ prop: "color", asIs: "#000", toBe: "#fff" }]),
        ],
      }),
    );
    const occurrences = md.split("md.section.styleChanges (").length - 1;
    expect(occurrences).toBe(1);
    expect(md).toContain("md.section.styleChanges (button.cta)");
  });
});

describe("joinStyleSelectors — DOM 줄 selector 쉼표 나열", () => {
  const el = (selector: string) => ({ selector });

  it("styleElements 복수 → 쉼표로 join", () => {
    expect(
      joinStyleSelectors([el("button.cta"), el("div.card")], "fallback"),
    ).toBe("button.cta, div.card");
  });

  it("styleElements 1개 → 그 selector", () => {
    expect(joinStyleSelectors([el("button.cta")], "fallback")).toBe("button.cta");
  });

  it("styleElements 빈 배열 → fallback", () => {
    expect(joinStyleSelectors([], "div.container")).toBe("div.container");
  });

  it("styleElements undefined → fallback", () => {
    expect(joinStyleSelectors(undefined, "div.container")).toBe("div.container");
  });

  it("styleElements 없고 fallback null → 빈 문자열", () => {
    expect(joinStyleSelectors([], null)).toBe("");
    expect(joinStyleSelectors(undefined, undefined)).toBe("");
  });

  it("wrap → 각 selector를 감싸고 join (복수)", () => {
    expect(
      joinStyleSelectors([el("button.cta"), el("div.card")], "fallback", (s) => `\`${s}\``),
    ).toBe("`button.cta`, `div.card`");
  });

  it("wrap → fallback도 감싼다, 빈 fallback은 미적용", () => {
    expect(joinStyleSelectors(undefined, "div.box", (s) => `\`${s}\``)).toBe("`div.box`");
    expect(joinStyleSelectors([], "", (s) => `\`${s}\``)).toBe("");
  });
});

describe("styleSelectorList — Notion/ADF용 selector 배열", () => {
  const styleEl2 = (selector: string): StyleElementContext => ({
    selector,
    tagName: "div",
    classListBefore: [],
    classListAfter: [],
    specifiedStyles: {},
    diffs: [],
  });

  it("styleElements 우선 (복수)", () => {
    const ctx = makeCtx({
      styleElements: [styleEl2("button.cta"), styleEl2("div.card")],
    });
    expect(styleSelectorList(ctx)).toEqual(["button.cta", "div.card"]);
  });

  it("styleElements 없으면 ctx.selector 단일", () => {
    expect(styleSelectorList(makeCtx({ selector: "button.cta" }))).toEqual(["button.cta"]);
  });

  it("빈 selector → 빈 배열", () => {
    expect(styleSelectorList(makeCtx({ selector: "" }))).toEqual([]);
  });
});

describe("buildMetaComment — 복수 element cssChanges (AI 메타)", () => {
  const styleEl = (
    selector: string,
    diffs: { prop: string; asIs: string; toBe: string }[],
  ) => ({
    selector,
    tagName: "div",
    classListBefore: ["base"],
    classListAfter: ["base", "edited"],
    specifiedStyles: { color: "#000" },
    diffs,
    beforeFilename: "before-0.webp",
    afterFilename: "after-0.webp",
  });

  it("복수 styleElements → meta.elements에 각 element selector·cssChanges 직렬화", () => {
    const md = buildIssueMarkdown(
      makeCtx({
        styleElements: [
          styleEl("button.cta", [{ prop: "color", asIs: "#000", toBe: "#fff" }]),
          styleEl("div.card", [{ prop: "padding", asIs: "10px", toBe: "20px" }]),
        ],
      }),
    );
    const meta = parseMeta(md);
    expect(meta.elements).toHaveLength(2);
    expect(meta.elements[0].selector).toBe("button.cta");
    expect(meta.elements[0].cssChanges).toEqual([
      { property: "color", from: "#000", to: "#fff" },
    ]);
    expect(meta.elements[1].selector).toBe("div.card");
    expect(meta.elements[1].classListAfter).toEqual(["base", "edited"]);
    expect(meta.elements[1].cssChanges).toEqual([
      { property: "padding", from: "10px", to: "20px" },
    ]);
  });

  it("단일 styleElements → meta.elements 생략, top-level은 그 element와 정합", () => {
    const md = buildIssueMarkdown(
      makeCtx({
        // 현재 요소(div.container)는 no-diff, 버퍼 element(button.cta)만 변경 — top-level
        // selector는 본문에 emit되는 element(button.cta)를 가리켜야 한다(어긋남 방지).
        styleElements: [
          styleEl("button.cta", [{ prop: "color", asIs: "#000", toBe: "#fff" }]),
        ],
      }),
    );
    const meta = parseMeta(md);
    expect(meta.elements).toBeUndefined();
    expect(meta.selector).toBe("button.cta");
    expect(meta.cssChanges).toEqual([
      { property: "color", from: "#000", to: "#fff" },
    ]);
  });

  it("styleElements 없는 단일 element(레거시) → meta.elements 생략", () => {
    const meta = parseMeta(buildIssueMarkdown(makeCtx()));
    expect(meta.elements).toBeUndefined();
    expect(meta.cssChanges).toEqual([
      { property: "color", from: "#000", to: "#fff" },
    ]);
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

// element-screenshot: 요소 캡처(captureMode "screenshot" + selector 채움)는 env에 DOM 줄 노출.
// 범위 캡처(screenshot + 빈 selector)는 미표시. 조건을 ctx.selector truthy로 완화.
describe("요소 캡처 (screenshot + selector) — DOM 줄 노출", () => {
  it("screenshot + selector → md env에 DOM 줄 표시", () => {
    const md = buildIssueMarkdown(
      makeCtx({ captureMode: "screenshot", selector: "button.cta", diffs: [] }),
    );
    expect(md).toContain("- **DOM**: `button.cta`");
  });

  it("screenshot + 빈 selector(범위 캡처) → DOM 미표시 (회귀)", () => {
    const md = buildIssueMarkdown(
      makeCtx({ captureMode: "screenshot", selector: "", diffs: [] }),
    );
    expect(md).not.toContain("**DOM**");
  });

  it("screenshot + selector → html env에 DOM 표시", () => {
    const html = buildIssueHtml(
      makeCtx({ captureMode: "screenshot", selector: "button.cta", diffs: [] }),
    );
    expect(html).toContain("<strong>DOM</strong>: <code>button.cta</code>");
  });

  it("screenshot + selector → meta comment에 selector 포함", () => {
    const md = buildIssueMarkdown(
      makeCtx({ captureMode: "screenshot", selector: "button.cta", diffs: [] }),
    );
    const start = md.indexOf("<!-- bugshot-meta-for-ai");
    const end = md.indexOf("-->", start);
    expect(md.slice(start, end)).toContain('"selector"');
  });
});

describe("mergeStyleElements — 버퍼+현재 머지·dedup·파일명 인덱싱", () => {
  // buf: inlineStyle color #000000 → #ffffff diff 1개
  function buf(selector: string, after: string, frameId?: number): BufferedElement {
    return {
      selector,
      frameId,
      tagName: "div",
      selectionSnapshot: {
        classList: [selector],
        specifiedStyles: {},
        computedStyles: { color: "#000000" },
        text: null,
        viewport: { width: 0, height: 0 },
        capturedAt: 0,
      },
      styleEdits: { classList: [selector], inlineStyle: { color: "#ffffff" }, text: "" },
      beforeImage: `data:before-${selector}`,
      afterImage: after,
    };
  }

  // current: inlineStyle padding 10px → 20px diff 1개
  function cur(
    selector: string,
    opts: { diff?: boolean; frameId?: number } = {},
  ): {
    selection: EditorSelection;
    styleEdits: EditorStyleEdits;
    before: string | null;
    after: string | null;
  } {
    const hasDiff = opts.diff ?? true;
    return {
      selection: {
        selector,
        frameId: opts.frameId,
        tagName: "span",
        classList: [selector],
        computedStyles: { padding: "10px" },
        specifiedStyles: {},
        propSources: {},
        hasParent: false,
        hasChild: false,
        text: null,
        viewport: { width: 0, height: 0 },
        capturedAt: 0,
      },
      styleEdits: {
        classList: [selector],
        inlineStyle: hasDiff ? { padding: "20px" } : {},
        text: "",
      },
      before: `data:before-${selector}`,
      after: `data:after-${selector}`,
    };
  }

  it("버퍼[A] + 현재 B → [A,B], before-0/before-1 인덱싱", () => {
    const out = mergeStyleElements([buf("a", "data:after-a")], cur("b"));
    expect(out.map((e) => e.selector)).toEqual(["a", "b"]);
    expect(out[0].beforeFilename).toBe("before-0.webp");
    expect(out[0].afterFilename).toBe("after-0.webp");
    expect(out[1].beforeFilename).toBe("before-1.webp");
    expect(out[1].afterFilename).toBe("after-1.webp");
    // 각 항목 diff 1개
    expect(out[0].diffs).toHaveLength(1);
    expect(out[1].diffs).toHaveLength(1);
  });

  it("버퍼 없음 + 현재만 → 1개, before-0", () => {
    const out = mergeStyleElements([], cur("b"));
    expect(out).toHaveLength(1);
    expect(out[0].selector).toBe("b");
    expect(out[0].beforeFilename).toBe("before-0.webp");
  });

  it("같은 selector면 dedup, 현재 우선 (길이 1)", () => {
    const out = mergeStyleElements([buf("a", "data:after-a")], cur("a"));
    expect(out).toHaveLength(1);
    // 현재 우선: tagName이 cur의 span
    expect(out[0].tagName).toBe("span");
    expect(out[0].beforeFilename).toBe("before-0.webp");
  });

  it("dedup으로 길이가 변하면 i가 최종 배열 기준으로 재배열 (styleElements[i] ↔ before-${i})", () => {
    // 버퍼 [a,b] + 현재 a → a가 버퍼에서 빠지고 현재 a가 끝으로 → [b, a]
    const out = mergeStyleElements(
      [buf("a", "data:after-a"), buf("b", "data:after-b")],
      cur("a"),
    );
    expect(out.map((e) => e.selector)).toEqual(["b", "a"]);
    expect(out[0].beforeFilename).toBe("before-0.webp");
    expect(out[1].beforeFilename).toBe("before-1.webp");
    // index 1이 현재 a(현재 우선 → tagName span)
    expect(out[1].tagName).toBe("span");
  });

  it("같은 selector라도 frameId가 다르면 별개 요소 — dedup 안 됨", () => {
    const out = mergeStyleElements([buf("a", "data:after-a")], cur("a", { frameId: 3 }));
    expect(out.map((e) => [e.selector, e.frameId ?? 0])).toEqual([
      ["a", 0],
      ["a", 3],
    ]);
  });

  it("같은 selector + 같은 frameId(≠0)면 dedup, 현재 우선", () => {
    const out = mergeStyleElements([buf("a", "data:after-a", 3)], cur("a", { frameId: 3 }));
    expect(out).toHaveLength(1);
    expect(out[0].tagName).toBe("span");
    expect(out[0].frameId).toBe(3);
  });

  it("frameId 미지정(구버전 스냅샷)은 0과 동일 취급 — top 현재 선택과 dedup", () => {
    const out = mergeStyleElements([buf("a", "data:after-a")], cur("a", { frameId: 0 }));
    expect(out).toHaveLength(1);
    expect(out[0].tagName).toBe("span");
  });

  it("diff 0 항목은 제외 (안전장치)", () => {
    const out = mergeStyleElements([buf("a", "data:after-a")], cur("z", { diff: false }));
    expect(out.map((e) => e.selector)).toEqual(["a"]);
    expect(out[0].beforeFilename).toBe("before-0.webp");
  });

  it("현재 null이면 버퍼만", () => {
    const out = mergeStyleElements([buf("a", "data:after-a")], null);
    expect(out.map((e) => e.selector)).toEqual(["a"]);
    expect(out[0].beforeFilename).toBe("before-0.webp");
  });
});

describe("로그 요약 — action 로그 단독 (video, net/con 없음)", () => {
  it("md: action 캡처만 있어도 로그 요약 섹션 + logs.html 참조 노출", () => {
    const md = buildIssueMarkdown(makeCtx({ captureMode: "video", selector: "", actionLogCaptured: 7 }));
    expect(md).toContain("logSummary.title");
    expect(md).toContain("logSummary.action.line n=7");
    expect(md).toContain("logSummary.logs.detail file=logs.html");
    expect(md).toContain("**logSummary.logs.lead**");
    expect(md).not.toContain("_logSummary.logs.detail");
  });

  it("html: action 캡처만 있어도 로그 요약 + logs.html 참조 노출", () => {
    const html = buildIssueHtml(makeCtx({ captureMode: "video", selector: "", actionLogCaptured: 7 }));
    expect(html).toContain("logSummary.action.line n=7");
    expect(html).toContain("logSummary.logs.detail file=logs.html");
    expect(html).toContain("<strong>logSummary.logs.lead</strong>");
    expect(html).not.toContain("<em>logSummary.logs.detail");
  });
});
