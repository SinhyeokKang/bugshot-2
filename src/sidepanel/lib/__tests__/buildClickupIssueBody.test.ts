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

import { buildClickupIssueBody } from "../buildClickupIssueBody";
import type { MarkdownContext } from "../buildIssueMarkdown";

function makeCtx(overrides: Partial<MarkdownContext> = {}): MarkdownContext {
  return {
    captureMode: "element",
    title: "Test",
    sections: { description: "본문" },
    sectionConfig: [
      { id: "description", enabled: true, renderAs: "paragraph", builtIn: true },
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

describe("buildClickupIssueBody", () => {
  it("{ body, attached } 형태 반환 — env 헤더 포함, title은 본문 미포함", () => {
    const out = buildClickupIssueBody({ ctx: makeCtx() });
    expect(out.attached).toEqual([]);
    expect(out.body).not.toContain("# Test");
    expect(out.body).toContain("**Page**: https://example.com");
    expect(out.body).toContain("**Viewport**: 1024×768");
  });

  it("빈 섹션은 md.noValue로 채운다", () => {
    const out = buildClickupIssueBody({
      ctx: makeCtx({ sections: { description: "" } }),
    });
    expect(out.body).toContain("md.noValue");
  });
});

describe("buildClickupIssueBody — cc 멘션 (markdown @텍스트)", () => {
  it("cc 줄이 --- 푸터 직전에 위치", () => {
    const out = buildClickupIssueBody({ ctx: makeCtx(), cc: ["alice", "bob"] });
    const lines = out.body.split("\n");
    const idx = lines.indexOf("cc @alice, @bob");
    expect(idx).toBeGreaterThan(-1);
    expect(lines[idx + 2]).toBe("---");
    expect(lines[idx + 4]).toContain("Reported via");
  });

  it("cc 미지정·undefined·빈 배열 모두 기존 출력과 등치", () => {
    const base = buildClickupIssueBody({ ctx: makeCtx() });
    expect(buildClickupIssueBody({ ctx: makeCtx(), cc: undefined })).toEqual(base);
    expect(buildClickupIssueBody({ ctx: makeCtx(), cc: [] })).toEqual(base);
  });
});
