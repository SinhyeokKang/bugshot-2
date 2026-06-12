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

vi.mock("@/lib/element-label", () => ({
  formatElementName: (opts: { tag: string; classList: string[] }) => {
    const cls = opts.classList.map((c: string) => `.${c}`).join("");
    return `${opts.tag}${cls}`;
  },
}));

import {
  buildLinearIssueBody,
  type LinearBuildInput,
} from "../buildLinearIssueBody";
import type { MarkdownContext } from "../buildIssueMarkdown";

function makeCtx(overrides: Partial<MarkdownContext> = {}): MarkdownContext {
  return {
    captureMode: "element",
    title: "Test",
    sections: { description: "본문" },
    sectionConfig: [
      { id: "description", enabled: true, renderAs: "paragraph", builtIn: true },
      { id: "expectedResult", enabled: true, renderAs: "paragraph", builtIn: true },
    ],
    url: "https://example.com",
    selector: "div",
    tagName: "div",
    classListBefore: [],
    classListAfter: [],
    specifiedStyles: {},
    tokens: [],
    viewport: { width: 1024, height: 768 },
    capturedAt: 1700000000000,
    diffs: [],
    environment: [],
    ...overrides,
  };
}

describe("buildLinearIssueBody — 인라인 미디어", () => {
  it("screenshot 모드에서 이미지 인라인 삽입", () => {
    const input: LinearBuildInput = {
      ctx: makeCtx({ captureMode: "screenshot" }),
      images: [{ filename: "screenshot.webp", assetUrl: "https://cdn.linear.app/screenshot.webp" }],
    };
    const out = buildLinearIssueBody(input);
    expect(out.body).toContain("![screenshot.webp](https://cdn.linear.app/screenshot.webp)");
    expect(out.body).toContain("md.section.media");
    expect(out.body).not.toContain("linear.attachmentNotInline");
  });

  it("screenshot assetUrl 없으면 이미지 미삽입", () => {
    const input: LinearBuildInput = {
      ctx: makeCtx({ captureMode: "screenshot" }),
      images: [{ filename: "screenshot.webp" }],
    };
    const out = buildLinearIssueBody(input);
    expect(out.body).not.toContain("![screenshot.webp]");
  });

  it("video 모드에서 비디오 인라인 삽입", () => {
    const input: LinearBuildInput = {
      ctx: makeCtx({ captureMode: "video" }),
      video: { filename: "recording.webm", assetUrl: "https://cdn.linear.app/recording.webm" },
    };
    const out = buildLinearIssueBody(input);
    expect(out.body).toContain("![recording.webm](https://cdn.linear.app/recording.webm)");
    expect(out.body).toContain("md.section.media");
  });

  it("video assetUrl 없으면 fallback 텍스트", () => {
    const input: LinearBuildInput = {
      ctx: makeCtx({ captureMode: "video" }),
      video: { filename: "recording.webm" },
    };
    const out = buildLinearIssueBody(input);
    expect(out.body).toContain("md.videoAttached");
  });

  it("element 모드에서 before/after를 테이블 Snapshot 행으로 삽입", () => {
    const ctx = makeCtx({
      captureMode: "element",
      diffs: [{ prop: "color", asIs: "#000", toBe: "#fff" }],
    });
    const input: LinearBuildInput = {
      ctx,
      images: [
        { filename: "before-0.webp", assetUrl: "https://cdn.linear.app/before-0.webp" },
        { filename: "after-0.webp", assetUrl: "https://cdn.linear.app/after-0.webp" },
      ],
    };
    const out = buildLinearIssueBody(input);
    expect(out.body).toContain("**styleTable.snapshot**");
    expect(out.body).toContain("![before-0.webp](https://cdn.linear.app/before-0.webp)");
    expect(out.body).toContain("![after-0.webp](https://cdn.linear.app/after-0.webp)");
    expect(out.body).toContain("| color | #000 | #fff |");
  });

  it("element 모드 이미지 없으면 테이블만 (Snapshot 행 없음)", () => {
    const ctx = makeCtx({
      captureMode: "element",
      diffs: [{ prop: "color", asIs: "#000", toBe: "#fff" }],
    });
    const out = buildLinearIssueBody({ ctx });
    expect(out.body).not.toContain("styleTable.snapshot");
    expect(out.body).toContain("| color | #000 | #fff |");
  });
});

describe("buildLinearIssueBody — element + diffs 없음 (no-diff 폐지)", () => {
  it("element + diffs=[] + 이미지 없음 → styleChanges·media 미출력", () => {
    const out = buildLinearIssueBody({
      ctx: makeCtx({ captureMode: "element", diffs: [] }),
    });
    expect(out.body).not.toContain("md.section.styleChanges");
    expect(out.body).not.toContain("md.section.media");
  });

  it("element + diffs 존재 → Style Changes (selector) 테이블 유지", () => {
    const input: LinearBuildInput = {
      ctx: makeCtx({
        captureMode: "element",
        diffs: [{ prop: "color", asIs: "#000", toBe: "#fff" }],
      }),
      images: [
        { filename: "before-0.webp", assetUrl: "https://cdn.linear.app/before-0.webp" },
        { filename: "after-0.webp", assetUrl: "https://cdn.linear.app/after-0.webp" },
      ],
    };
    const out = buildLinearIssueBody(input);
    expect(out.body).toContain("md.section.styleChanges (div)");
    expect(out.body).toContain("| color | #000 | #fff |");
  });

  it("복수 element → 각 섹션이 자기 before-${i}/after-${i}", () => {
    const out = buildLinearIssueBody({
      ctx: makeCtx({
        captureMode: "element",
        styleElements: [
          { selector: "a.x", tagName: "a", classListBefore: [], classListAfter: [], specifiedStyles: {}, diffs: [{ prop: "color", asIs: "#000", toBe: "#fff" }], beforeFilename: "before-0.webp", afterFilename: "after-0.webp" },
          { selector: "b.y", tagName: "b", classListBefore: [], classListAfter: [], specifiedStyles: {}, diffs: [{ prop: "padding", asIs: "1px", toBe: "2px" }], beforeFilename: "before-1.webp", afterFilename: "after-1.webp" },
        ],
      }),
      images: [
        { filename: "before-0.webp", assetUrl: "u-b0" },
        { filename: "after-0.webp", assetUrl: "u-a0" },
        { filename: "before-1.webp", assetUrl: "u-b1" },
        { filename: "after-1.webp", assetUrl: "u-a1" },
      ],
    });
    const sec0 = out.body.indexOf("(a.x)");
    const sec1 = out.body.indexOf("(b.y)");
    expect(out.body.slice(sec0, sec1)).toContain("![before-0.webp](u-b0)");
    expect(out.body.slice(sec1)).toContain("![before-1.webp](u-b1)");
  });
});

describe("buildLinearIssueBody — freeform", () => {
  it("freeform 모드 → 미디어 섹션 없음", () => {
    const out = buildLinearIssueBody({
      ctx: makeCtx({ captureMode: "freeform" as MarkdownContext["captureMode"], selector: "", diffs: [] }),
    });
    expect(out.body).not.toContain("md.section.media");
    expect(out.body).not.toContain("md.section.styleChanges");
    expect(out.body).not.toContain("md.imageAttached");
    expect(out.body).not.toContain("md.videoAttached");
  });

  it("freeform 모드 → DOM 미표시", () => {
    const out = buildLinearIssueBody({
      ctx: makeCtx({ captureMode: "freeform" as MarkdownContext["captureMode"], selector: "" }),
    });
    expect(out.body).not.toContain("**DOM**");
  });

  it("freeform 모드 → 환경 정보(Page, Viewport, Captured) 포함", () => {
    const out = buildLinearIssueBody({
      ctx: makeCtx({ captureMode: "freeform" as MarkdownContext["captureMode"], selector: "", diffs: [] }),
    });
    expect(out.body).toContain("**Page**: https://example.com");
    expect(out.body).toContain("**Viewport**:");
    expect(out.body).toContain("**Captured**:");
  });

  it("freeform 모드 → 네트워크 로그 요약 포함", () => {
    const out = buildLinearIssueBody({
      ctx: makeCtx({
        captureMode: "freeform" as MarkdownContext["captureMode"],
        selector: "",
        diffs: [],
        networkLogSummary: {
          captured: 8,
          errors: [{ method: "PUT", path: "/api/update", status: 403, statusText: "Forbidden" }],
        },
      }),
    });
    expect(out.body).toContain("logSummary.title");
    expect(out.body).toContain("logSummary.network.line");
    expect(out.body).not.toContain("PUT /api/update → 403 Forbidden");
  });
});

describe("buildLinearIssueBody — 구조", () => {
  it("env 헤더 포함, title은 본문에 미포함", () => {
    const out = buildLinearIssueBody({ ctx: makeCtx() });
    expect(out.body).not.toContain("# Test");
    expect(out.body).toContain("**Page**: https://example.com");
    expect(out.body).toContain("**Viewport**: 1024×768");
    expect(out.body).toContain("**Captured**:");
  });

  it("element 모드에서 DOM 줄은 ctx.selector 문자열", () => {
    const out = buildLinearIssueBody({
      ctx: makeCtx({ selector: "button.btn.primary" }),
    });
    expect(out.body).toContain("**DOM**: button.btn.primary");
  });

  it("screenshot/video 모드 + 빈 selector → DOM 미표시", () => {
    const out1 = buildLinearIssueBody({ ctx: makeCtx({ captureMode: "screenshot", selector: "" }) });
    expect(out1.body).not.toContain("**DOM**");
    const out2 = buildLinearIssueBody({ ctx: makeCtx({ captureMode: "video", selector: "" }) });
    expect(out2.body).not.toContain("**DOM**");
  });

  it("section 콘텐츠 비어있으면 md.noValue", () => {
    const out = buildLinearIssueBody({
      ctx: makeCtx({ sections: {} }),
    });
    expect(out.body).toContain("md.noValue");
  });

  it("footer 마크다운 포함", () => {
    const out = buildLinearIssueBody({ ctx: makeCtx() });
    expect(out.body).toMatch(/_Reported via .*BugShot.*_/);
  });

  it("네트워크 로그 요약 포함", () => {
    const out = buildLinearIssueBody({
      ctx: makeCtx({
        networkLogSummary: {
          captured: 10,
          errors: [
            { method: "GET", path: "/api/x", status: 500, statusText: "Internal Server Error" },
          ],
        },
      }),
    });
    expect(out.body).toContain("logSummary.title");
    expect(out.body).toContain("logSummary.network.line");
    expect(out.body).not.toContain("GET /api/x → 500 Internal Server Error");
  });

  it("콘솔 로그 요약 포함", () => {
    const out = buildLinearIssueBody({
      ctx: makeCtx({
        consoleLogSummary: {
          captured: 20,
          errorCount: 3,
          warnCount: 1,
          topErrors: ["TypeError: Cannot read property 'x' of null"],
        },
      }),
    });
    expect(out.body).toContain("logSummary.title");
    expect(out.body).toContain("logSummary.console.line");
    expect(out.body).not.toContain("TypeError: Cannot read property 'x' of null");
  });
});

describe("buildLinearIssueBody — browser 환경 정보", () => {
  it("browser 있으면 Page 행 위에 Browser 행 출력", () => {
    const out = buildLinearIssueBody({ ctx: makeCtx({ browser: "Chrome 128.0.6613.85" }) });
    const browserIdx = out.body.indexOf("**Browser**: Chrome 128.0.6613.85");
    const pageIdx = out.body.indexOf("**Page**:");
    expect(browserIdx).toBeGreaterThan(-1);
    expect(browserIdx).toBeLessThan(pageIdx);
  });

  it("browser null이면 Browser 행 미출력", () => {
    const out = buildLinearIssueBody({ ctx: makeCtx({ browser: null }) });
    expect(out.body).not.toContain("**Browser**");
  });

  it("browser 미전달이면 Browser 행 미출력 (하위호환)", () => {
    const out = buildLinearIssueBody({ ctx: makeCtx() });
    expect(out.body).not.toContain("**Browser**");
  });
});

describe("buildLinearIssueBody — os 환경 정보", () => {
  it("os 있으면 Browser 행 위에 OS 행 출력", () => {
    const out = buildLinearIssueBody({
      ctx: makeCtx({ os: "macOS 15.2", browser: "Chrome 128.0.6613.85" }),
    });
    const osIdx = out.body.indexOf("**OS**: macOS 15.2");
    const browserIdx = out.body.indexOf("**Browser**: Chrome 128.0.6613.85");
    expect(osIdx).toBeGreaterThan(-1);
    expect(osIdx).toBeLessThan(browserIdx);
  });

  it("os null이면 OS 행 미출력", () => {
    const out = buildLinearIssueBody({ ctx: makeCtx({ os: null }) });
    expect(out.body).not.toContain("**OS**");
  });

  it("os 미전달이면 OS 행 미출력 (하위호환)", () => {
    const out = buildLinearIssueBody({ ctx: makeCtx() });
    expect(out.body).not.toContain("**OS**");
  });
});

describe("buildLinearIssueBody — custom environment rows", () => {
  it("custom row가 Environment 섹션 불릿으로 포함", () => {
    const out = buildLinearIssueBody({
      ctx: makeCtx({ environment: [{ label: "Browser", value: "Chrome 140" }] }),
    });
    expect(out.body).toContain("- **Browser**: Chrome 140");
  });

  it("빈 row 제외, value 개행 공백 치환", () => {
    const out = buildLinearIssueBody({
      ctx: makeCtx({
        environment: [
          { label: "  ", value: "  " },
          { label: "OS", value: "macOS\n15" },
        ],
      }),
    });
    expect(out.body).toContain("- **OS**: macOS 15");
  });
});

// element-screenshot (Group B: domLabel→selector 전환): 요소 캡처(screenshot + selector)는
// formatElementName이 아니라 ctx.selector 문자열을 DOM 줄에 출력. screenshot 게이트도 완화.
describe("buildLinearIssueBody — 요소 캡처 (screenshot + selector)", () => {
  it("screenshot + selector → DOM 줄에 selector(formatElementName 아님)", () => {
    const out = buildLinearIssueBody({
      ctx: makeCtx({
        captureMode: "screenshot",
        selector: "button.cta",
        tagName: "button",
        diffs: [],
      }),
    });
    expect(out.body).toContain("**DOM**: button.cta");
  });

  it("screenshot + 빈 selector(범위 캡처) → DOM 미표시 (회귀)", () => {
    const out = buildLinearIssueBody({
      ctx: makeCtx({ captureMode: "screenshot", selector: "", diffs: [] }),
    });
    expect(out.body).not.toContain("**DOM**");
  });
});

describe("cc 멘션", () => {
  it("cc 줄이 --- 푸터 직전에 위치 + 표시 이름 마크다운 이스케이프", () => {
    const out = buildLinearIssueBody({ ctx: makeCtx(), cc: ["Jane Doe", "a_b"] });
    const lines = out.body.split("\n");
    const idx = lines.indexOf("cc @Jane Doe, @a\\_b");
    expect(idx).toBeGreaterThan(-1);
    expect(lines[idx + 2]).toBe("---");
    expect(lines[idx + 4]).toContain("Reported via");
  });

  it("cc 미지정·undefined·빈 배열 모두 기존 출력과 등치", () => {
    const base = buildLinearIssueBody({ ctx: makeCtx() });
    expect(buildLinearIssueBody({ ctx: makeCtx(), cc: undefined })).toEqual(base);
    expect(buildLinearIssueBody({ ctx: makeCtx(), cc: [] })).toEqual(base);
  });
});
