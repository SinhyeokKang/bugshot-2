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
  buildAsanaIssueBody,
  type AsanaBuildInput,
} from "../buildAsanaIssueBody";
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

describe("buildAsanaIssueBody", () => {
  it("{ body, attached } 형태 반환 — 기본 환경 헤더 포함, title은 본문 미포함", () => {
    const out = buildAsanaIssueBody({ ctx: makeCtx() });
    expect(out.attached).toEqual([]);
    expect(out.body).not.toContain("# Test");
    expect(out.body).toContain("**Page**: https://example.com");
    expect(out.body).toContain("**Viewport**: 1024×768");
  });

  it("이미지는 본문에 인라인(![filename](filename)) + attached 포함, 첨부 백틱 목록엔 미포함", () => {
    const input: AsanaBuildInput = {
      ctx: makeCtx({ captureMode: "screenshot" }),
      images: [{ filename: "screenshot.png", contentType: "image/png" }],
    };
    const out = buildAsanaIssueBody(input);
    expect(out.body).toContain("![screenshot.png](screenshot.png)");
    expect(out.attached).toContain("screenshot.png");
    expect(out.body).not.toContain("`screenshot.png`");
  });

  it("첨부 문단(헤딩/안내/파일명 리스트)은 본문에 없다 — Asana 첨부 영역에 자동 표시", () => {
    const out = buildAsanaIssueBody({
      ctx: makeCtx({ captureMode: "screenshot" }),
      images: [{ filename: "screenshot.png", contentType: "image/png" }],
    });
    expect(out.body).not.toContain("md.section.attachments");
    expect(out.body).not.toContain("asana.attachmentNotInline");
    expect(out.body).not.toContain("`screenshot.png`");
  });

  it("element 비교 모드 — As is/To be 섹션에 이미지 + 속성값 분리", () => {
    const out = buildAsanaIssueBody({
      ctx: makeCtx({
        captureMode: "element",
        diffs: [{ prop: "color", asIs: "red", toBe: "blue" }],
      }),
      images: [
        { filename: "before.png", contentType: "image/png" },
        { filename: "after.png", contentType: "image/png" },
      ],
    });
    expect(out.body).toContain("## styleTable.asIs");
    expect(out.body).toContain("## styleTable.toBe");
    expect(out.body).toContain("![before.png](before.png)");
    expect(out.body).toContain("![after.png](after.png)");
    expect(out.body).toContain("- **color**: red");
    expect(out.body).toContain("- **color**: blue");
    expect(out.body).not.toContain("| As is | To be |");
    expect(out.attached).toEqual(
      expect.arrayContaining(["before.png", "after.png"]),
    );
  });
});
