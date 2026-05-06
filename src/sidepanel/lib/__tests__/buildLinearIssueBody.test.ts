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
    ...overrides,
  };
}

describe("buildLinearIssueBody — 첨부 안내", () => {
  it("이미지는 파일명만 안내로 노출", () => {
    const input: LinearBuildInput = {
      ctx: makeCtx({ captureMode: "screenshot" }),
      images: [{ filename: "screenshot.webp" }],
    };
    const out = buildLinearIssueBody(input);
    expect(out.body).toContain("`screenshot.webp`");
    expect(out.body).toContain("linear.attachmentNotInline");
  });

  it("video도 파일명 안내", () => {
    const input: LinearBuildInput = {
      ctx: makeCtx({ captureMode: "video" }),
      video: { filename: "recording.webm" },
    };
    const out = buildLinearIssueBody(input);
    expect(out.body).toContain("`recording.webm`");
  });

  it("로그 파일도 안내", () => {
    const input: LinearBuildInput = {
      ctx: makeCtx({ captureMode: "video" }),
      video: { filename: "recording.webm" },
      logs: [
        { filename: "network-log.har" },
        { filename: "console-log.json" },
      ],
    };
    const out = buildLinearIssueBody(input);
    expect(out.body).toContain("`network-log.har`");
    expect(out.body).toContain("`console-log.json`");
  });

  it("첨부 0건이면 첨부 섹션 미표시", () => {
    const out = buildLinearIssueBody({ ctx: makeCtx() });
    expect(out.body).not.toContain("md.section.attachments");
    expect(out.body).not.toContain("linear.attachmentNotInline");
  });

  it("안내 문구는 1회만", () => {
    const out = buildLinearIssueBody({
      ctx: makeCtx({ captureMode: "screenshot" }),
      images: [
        { filename: "a.webp" },
        { filename: "b.webp" },
      ],
    });
    const matches = out.body.match(/linear\.attachmentNotInline/g);
    expect(matches).toHaveLength(1);
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

  it("style diff는 element 모드에서 emit", () => {
    const ctx = makeCtx({
      captureMode: "element",
      diffs: [{ prop: "color", asIs: "#000", toBe: "#fff" }],
    });
    const out = buildLinearIssueBody({ ctx });
    expect(out.body).toContain("md.section.styleChanges");
    expect(out.body).toContain("| color | #000 | #fff |");
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
