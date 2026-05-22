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
        { filename: "before.webp", assetUrl: "https://cdn.linear.app/before.webp" },
        { filename: "after.webp", assetUrl: "https://cdn.linear.app/after.webp" },
      ],
    };
    const out = buildLinearIssueBody(input);
    expect(out.body).toContain("**styleTable.snapshot**");
    expect(out.body).toContain("![before.webp](https://cdn.linear.app/before.webp)");
    expect(out.body).toContain("![after.webp](https://cdn.linear.app/after.webp)");
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
      ctx: makeCtx({ captureMode: "freeform" as MarkdownContext["captureMode"], selector: "div.test" }),
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
    expect(out.body).toContain("logSummary.network.title");
    expect(out.body).toContain("PUT /api/update → 403 Forbidden");
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

  it("element 모드에서 DOM 라벨은 formatElementName 형식", () => {
    const out = buildLinearIssueBody({
      ctx: makeCtx({ tagName: "button", classListBefore: ["btn", "primary"] }),
    });
    expect(out.body).toContain("**DOM**: button.btn.primary");
  });

  it("screenshot/video 모드에서 DOM 미표시", () => {
    const out1 = buildLinearIssueBody({ ctx: makeCtx({ captureMode: "screenshot" }) });
    expect(out1.body).not.toContain("**DOM**");
    const out2 = buildLinearIssueBody({ ctx: makeCtx({ captureMode: "video" }) });
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
    expect(out.body).toContain("logSummary.network.title");
    expect(out.body).toContain("GET /api/x → 500 Internal Server Error");
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
    expect(out.body).toContain("logSummary.console.title");
    expect(out.body).toContain("TypeError: Cannot read property 'x' of null");
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
