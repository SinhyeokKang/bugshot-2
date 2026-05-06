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

vi.mock("@/store/app-settings-store", () => ({
  POST_MEDIA_SECTION_IDS: new Set(["expectedResult", "notes"]),
  sectionMdLabelKey: (id: string) => `md.section.${id}`,
}));

import {
  buildGithubIssueBody,
  type GithubBuildInput,
} from "../buildGithubIssueBody";
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

function makeBlob(size: number, mime = "image/webp"): Blob {
  return new Blob([new Uint8Array(size)], { type: mime });
}

describe("buildGithubIssueBody — 첨부 안내", () => {
  it("이미지는 본문에 인라인되지 않고 파일명만 안내로 노출", () => {
    const input: GithubBuildInput = {
      ctx: makeCtx({ captureMode: "screenshot" }),
      images: [{ filename: "screenshot.webp", blob: makeBlob(2048) }],
    };
    const out = buildGithubIssueBody(input);
    expect(out.attached).toEqual(["screenshot.webp"]);
    expect(out.body).not.toContain("data:image");
    expect(out.body).toContain("`screenshot.webp`");
    expect(out.body).toContain("github.attachmentNotInline");
  });

  it("video도 푸터 안내", () => {
    const input: GithubBuildInput = {
      ctx: makeCtx({ captureMode: "video" }),
      video: { filename: "recording.webm", blob: makeBlob(1024) },
    };
    const out = buildGithubIssueBody(input);
    expect(out.attached).toEqual(["recording.webm"]);
    expect(out.body).toContain("`recording.webm`");
  });

  it("HAR/console 로그도 푸터 안내", () => {
    const input: GithubBuildInput = {
      ctx: makeCtx({ captureMode: "video" }),
      video: { filename: "recording.webm", blob: makeBlob(512) },
      logs: [
        { filename: "network-log.har", blob: makeBlob(2048) },
        { filename: "console-log.json", blob: makeBlob(2048) },
      ],
    };
    const out = buildGithubIssueBody(input);
    expect(out.attached).toEqual([
      "recording.webm",
      "network-log.har",
      "console-log.json",
    ]);
    expect(out.body).toContain("`network-log.har`");
    expect(out.body).toContain("`console-log.json`");
    // 어떤 형식이든 base64 인라인 금지
    expect(out.body).not.toContain("data:application");
    expect(out.body).not.toContain("data:image");
    expect(out.body).not.toContain("data:video");
  });

  it("첨부 0건이면 첨부 섹션 미표시", () => {
    const out = buildGithubIssueBody({ ctx: makeCtx() });
    expect(out.attached).toEqual([]);
    expect(out.body).not.toContain("md.section.attachments");
    expect(out.body).not.toContain("github.attachmentNotInline");
  });

  it("안내 문구는 첨부 섹션당 1회만 (모든 항목마다 반복 X)", () => {
    const out = buildGithubIssueBody({
      ctx: makeCtx({ captureMode: "screenshot" }),
      images: [
        { filename: "a.webp", blob: makeBlob(1) },
        { filename: "b.webp", blob: makeBlob(1) },
        { filename: "c.webp", blob: makeBlob(1) },
      ],
    });
    const matches = out.body.match(/github\.attachmentNotInline/g);
    expect(matches).toHaveLength(1);
  });
});

describe("buildGithubIssueBody — 구조", () => {
  it("기본 헤더 (title, env, page, viewport, captured) 포함", () => {
    const out = buildGithubIssueBody({ ctx: makeCtx() });
    expect(out.body).toContain("# Test");
    expect(out.body).toContain("**Page**: https://example.com");
    expect(out.body).toContain("**Viewport**: 1024×768");
    expect(out.body).toContain("**Captured**:");
  });

  it("style diff는 element 모드에서만 emit", () => {
    const ctx = makeCtx({
      captureMode: "element",
      diffs: [{ prop: "color", asIs: "#000", toBe: "#fff" }],
    });
    const out = buildGithubIssueBody({ ctx });
    expect(out.body).toContain("md.section.styleChanges");
    expect(out.body).toContain("| color | #000 | #fff |");
  });

  it("미디어/이미지 없이도 빈 ctx 처리 안전", () => {
    const out = buildGithubIssueBody({ ctx: makeCtx({ diffs: [] }) });
    expect(out.body).toContain("# Test");
    expect(out.attached).toEqual([]);
  });

  it("section 콘텐츠 비어있으면 md.noValue", () => {
    const out = buildGithubIssueBody({
      ctx: makeCtx({ sections: {} }),
    });
    expect(out.body).toContain("md.noValue");
  });

  it("footer 마크다운 포함 (Reported via BugShot)", () => {
    const out = buildGithubIssueBody({ ctx: makeCtx() });
    expect(out.body).toMatch(/_Reported via .*BugShot.*_/);
  });
});
