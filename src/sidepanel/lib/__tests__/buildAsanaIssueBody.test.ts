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

  it("이미지는 인라인 URL 임베드 없이 첨부 목록 + 본문 파일명 표기 (Asana는 인라인 불가)", () => {
    const input: AsanaBuildInput = {
      ctx: makeCtx({ captureMode: "screenshot" }),
      images: [{ filename: "screenshot.png", contentType: "image/png" }],
    };
    const out = buildAsanaIssueBody(input);
    expect(out.attached).toContain("screenshot.png");
    expect(out.body).toContain("`screenshot.png`");
    expect(out.body).not.toContain("![screenshot.png]");
  });

  it("영상도 첨부 목록 + 파일명 표기, 인라인 임베드 없음", () => {
    const input: AsanaBuildInput = {
      ctx: makeCtx({ captureMode: "video" }),
      video: { filename: "recording.mp4", contentType: "video/mp4" },
    };
    const out = buildAsanaIssueBody(input);
    expect(out.attached).toContain("recording.mp4");
    expect(out.body).toContain("`recording.mp4`");
    expect(out.body).not.toContain("![recording.mp4]");
  });

  it("로그 첨부도 attached 목록에 포함", () => {
    const input: AsanaBuildInput = {
      ctx: makeCtx(),
      logs: [{ filename: "logs.html", contentType: "text/html" }],
    };
    const out = buildAsanaIssueBody(input);
    expect(out.attached).toContain("logs.html");
  });
});
