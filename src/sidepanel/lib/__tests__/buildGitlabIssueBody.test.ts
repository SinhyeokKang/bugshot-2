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
  buildGitlabIssueBody,
  type GitlabBuildInput,
} from "../buildGitlabIssueBody";
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

describe("buildGitlabIssueBody", () => {
  it("{ body, attached } 형태 반환 — 기본 헤더 포함, title은 본문 미포함", () => {
    const out = buildGitlabIssueBody({ ctx: makeCtx() });
    expect(out.attached).toEqual([]);
    expect(out.body).not.toContain("# Test");
    expect(out.body).toContain("**Page**: https://example.com");
    expect(out.body).toContain("**Viewport**: 1024×768");
  });

  it("url 있는 이미지는 미디어 섹션에 마크다운 인라인", () => {
    const input: GitlabBuildInput = {
      ctx: makeCtx({ captureMode: "screenshot" }),
      images: [
        {
          filename: "screenshot.png",
          contentType: "image/png",
          url: "/uploads/abc/screenshot.png",
        },
      ],
    };
    const out = buildGitlabIssueBody(input);
    expect(out.body).toContain("![screenshot.png](/uploads/abc/screenshot.png)");
  });

  it("freeform 모드는 이미지가 있어도 미디어 섹션을 만들지 않는다", () => {
    const input: GitlabBuildInput = {
      ctx: makeCtx({ captureMode: "freeform" }),
      images: [
        {
          filename: "screenshot.png",
          contentType: "image/png",
          url: "/uploads/abc/screenshot.png",
        },
      ],
    };
    const out = buildGitlabIssueBody(input);
    expect(out.body).not.toContain("## md.section.media");
    expect(out.body).not.toContain("## md.section.styleChanges");
    // 이미지는 첨부 섹션에서만 노출
    expect(out.body).toContain("## md.section.attachments");
  });

  it("url 없는 첨부는 attached 목록에 파일명만", () => {
    const input: GitlabBuildInput = {
      ctx: makeCtx({ captureMode: "video" }),
      video: { filename: "recording.mp4", contentType: "video/mp4" },
    };
    const out = buildGitlabIssueBody(input);
    expect(out.attached).toEqual(["recording.mp4"]);
    expect(out.body).toContain("`recording.mp4`");
  });
});
