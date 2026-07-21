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

  it("영상은 ![](url)가 아니라 ?view=open 붙은 맨 URL로 들어간다 (클릭하면 ClickUp 뷰어 재생)", () => {
    const out = buildClickupIssueBody({
      ctx: makeCtx({ captureMode: "video" }),
      video: { filename: "recording.mp4", contentType: "video/mp4", url: "https://att/recording.mp4" },
    });
    expect(out.body).toMatch(/^https:\/\/att\/recording\.mp4\?view=open$/m);
    expect(out.body).not.toContain("![recording.mp4]");
  });

  it("이미 쿼리가 있는 영상 URL엔 ?view=open을 중복 추가하지 않는다", () => {
    const out = buildClickupIssueBody({
      ctx: makeCtx({ captureMode: "video" }),
      video: { filename: "recording.mp4", contentType: "video/mp4", url: "https://att/recording.mp4?view=open" },
    });
    expect(out.body).toMatch(/^https:\/\/att\/recording\.mp4\?view=open$/m);
  });

  it("[첨부] 섹션은 만들지 않는다 (영상·로그·사용자첨부는 네이티브 첨부로만)", () => {
    const out = buildClickupIssueBody({
      ctx: makeCtx({ captureMode: "video" }),
      video: { filename: "recording.mp4", contentType: "video/mp4", url: "https://att/recording.mp4" },
      logs: [{ filename: "logs.html", contentType: "text/html", url: "https://att/logs.html" }],
    });
    expect(out.body).not.toContain("md.section.attachments");
  });

  it("로그 안내 문구: 첫 문장 strong + italic 제거 + {file} build-time 링크 유지", () => {
    const out = buildClickupIssueBody({
      ctx: makeCtx({ captureMode: "video", selector: "", actionLogCaptured: 3 }),
      logs: [{ filename: "logs.html", contentType: "text/html", url: "https://att/logs.html" }],
    });
    expect(out.body).toContain("logSummary.logs.detail file=[logs.html](https://att/logs.html)");
    expect(out.body).toContain("**logSummary.logs.lead**");
    expect(out.body).not.toContain("_logSummary.logs.detail");
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
