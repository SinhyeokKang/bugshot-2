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

  it("video는 ![](url) 이미지 문법으로 임베드 (GitLab 영상 플레이어 인식)", () => {
    const input: GitlabBuildInput = {
      ctx: makeCtx({ captureMode: "video" }),
      video: {
        filename: "recording.mp4",
        contentType: "video/mp4",
        url: "/uploads/abc/recording.mp4",
      },
    };
    const out = buildGitlabIssueBody(input);
    expect(out.body).toContain("![recording.mp4](/uploads/abc/recording.mp4)");
    // bare URL 단독 줄이면 안 됨
    expect(out.body).not.toMatch(/^\/uploads\/abc\/recording\.mp4$/m);
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

describe("buildGitlabIssueBody — element 복수", () => {
  it("element + diffs 존재 → Style Changes (selector) + before-0 스냅샷", () => {
    const out = buildGitlabIssueBody({
      ctx: makeCtx({ captureMode: "element", diffs: [{ prop: "color", asIs: "#000", toBe: "#fff" }] }),
      images: [
        { filename: "before-0.webp", contentType: "image/webp", url: "/u/b0" },
        { filename: "after-0.webp", contentType: "image/webp", url: "/u/a0" },
      ],
    });
    expect(out.body).toContain("md.section.styleChanges (div)");
    expect(out.body).toContain("![before-0.webp](/u/b0)");
    expect(out.body).toContain("| color | #000 | #fff |");
    expect(out.body).not.toContain("md.section.attachments");
  });

  it("복수 element → 각 섹션이 자기 before-${i}/after-${i}", () => {
    const out = buildGitlabIssueBody({
      ctx: makeCtx({
        captureMode: "element",
        styleElements: [
          { selector: "a.x", tagName: "a", classListBefore: [], classListAfter: [], specifiedStyles: {}, diffs: [{ prop: "color", asIs: "#000", toBe: "#fff" }], beforeFilename: "before-0.webp", afterFilename: "after-0.webp" },
          { selector: "b.y", tagName: "b", classListBefore: [], classListAfter: [], specifiedStyles: {}, diffs: [{ prop: "padding", asIs: "1px", toBe: "2px" }], beforeFilename: "before-1.webp", afterFilename: "after-1.webp" },
        ],
      }),
      images: [
        { filename: "before-0.webp", contentType: "image/webp", url: "/u/b0" },
        { filename: "after-0.webp", contentType: "image/webp", url: "/u/a0" },
        { filename: "before-1.webp", contentType: "image/webp", url: "/u/b1" },
        { filename: "after-1.webp", contentType: "image/webp", url: "/u/a1" },
      ],
    });
    const sec0 = out.body.indexOf("(a.x)");
    const sec1 = out.body.indexOf("(b.y)");
    expect(out.body.slice(sec0, sec1)).toContain("![before-0.webp](/u/b0)");
    expect(out.body.slice(sec1)).toContain("![before-1.webp](/u/b1)");
    expect(out.body).not.toContain("md.section.attachments");
  });
});
