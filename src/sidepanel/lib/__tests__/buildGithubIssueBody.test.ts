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
  tryInlineImage,
  GITHUB_INLINE_IMAGE_MAX,
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

describe("tryInlineImage", () => {
  it("작은 이미지는 dataURI 반환", async () => {
    const blob = makeBlob(1024);
    const out = await tryInlineImage(blob, 60_000);
    expect(out).toMatch(/^data:image\/webp;base64,/);
  });

  it("64KB 초과 blob은 null", async () => {
    const blob = makeBlob(GITHUB_INLINE_IMAGE_MAX + 1);
    expect(await tryInlineImage(blob, 60_000)).toBeNull();
  });

  it("budget 부족이면 null", async () => {
    const blob = makeBlob(1024);
    expect(await tryInlineImage(blob, 100)).toBeNull();
  });

  it("blob.type 비어있으면 image/webp 기본", async () => {
    const blob = new Blob([new Uint8Array(8)], { type: "" });
    const out = await tryInlineImage(blob, 60_000);
    expect(out).toMatch(/^data:image\/webp;base64,/);
  });
});

describe("buildGithubIssueBody — image 인라인", () => {
  it("작은 이미지 1장은 본문에 dataURI 인라인", async () => {
    const input: GithubBuildInput = {
      ctx: makeCtx({ captureMode: "screenshot" }),
      images: [{ filename: "screenshot.webp", blob: makeBlob(2048) }],
    };
    const out = await buildGithubIssueBody(input);
    expect(out.inlined).toEqual(["screenshot.webp"]);
    expect(out.notInlined).toEqual([]);
    expect(out.body).toMatch(/!\[screenshot\.webp\]\(data:image\/webp;base64,/);
  });

  it("큰 이미지는 안내 푸터로 강등", async () => {
    const input: GithubBuildInput = {
      ctx: makeCtx({ captureMode: "screenshot" }),
      images: [
        { filename: "huge.webp", blob: makeBlob(GITHUB_INLINE_IMAGE_MAX + 1) },
      ],
    };
    const out = await buildGithubIssueBody(input);
    expect(out.inlined).toEqual([]);
    expect(out.notInlined).toEqual(["huge.webp"]);
    expect(out.body).toContain("github.attachmentTooLarge");
    expect(out.body).toContain("`huge.webp`");
    expect(out.body).not.toContain("data:image");
  });

  it("budget 누적 — 첫 이미지는 인라인, 다음은 푸터", async () => {
    // 50KB 이미지 두 장이면 base64 약 67KB씩, 둘 다 인라인하면 60KB 초과.
    const input: GithubBuildInput = {
      ctx: makeCtx({ captureMode: "element" }),
      images: [
        { filename: "before.webp", blob: makeBlob(50 * 1024) },
        { filename: "after.webp", blob: makeBlob(50 * 1024) },
      ],
    };
    const out = await buildGithubIssueBody(input);
    expect(out.inlined.length + out.notInlined.length).toBe(2);
    // 적어도 한 장은 푸터로 강등 (예산 초과)
    expect(out.notInlined.length).toBeGreaterThan(0);
  });
});

describe("buildGithubIssueBody — video/log 항상 푸터", () => {
  it("video는 무조건 안내 푸터", async () => {
    const input: GithubBuildInput = {
      ctx: makeCtx({ captureMode: "video" }),
      video: { filename: "recording.webm", blob: makeBlob(1024) },
    };
    const out = await buildGithubIssueBody(input);
    expect(out.inlined).toEqual([]);
    expect(out.notInlined).toEqual(["recording.webm"]);
    expect(out.body).toContain("`recording.webm`");
    expect(out.body).toContain("github.attachmentNotInline");
  });

  it("HAR/console 로그도 항상 푸터", async () => {
    const input: GithubBuildInput = {
      ctx: makeCtx({ captureMode: "video" }),
      video: { filename: "recording.webm", blob: makeBlob(512) },
      logs: [
        { filename: "network-log.har", blob: makeBlob(2048) },
        { filename: "console-log.json", blob: makeBlob(2048) },
      ],
    };
    const out = await buildGithubIssueBody(input);
    expect(out.notInlined).toEqual([
      "recording.webm",
      "network-log.har",
      "console-log.json",
    ]);
    expect(out.body).toContain("`network-log.har`");
    expect(out.body).toContain("`console-log.json`");
    // 로그 첨부에는 base64 인라인 금지
    expect(out.body).not.toContain("data:application");
  });
});

describe("buildGithubIssueBody — 구조", () => {
  it("기본 헤더 (title, env, page, viewport, captured) 포함", async () => {
    const out = await buildGithubIssueBody({ ctx: makeCtx() });
    expect(out.body).toContain("# Test");
    expect(out.body).toContain("**Page**: https://example.com");
    expect(out.body).toContain("**Viewport**: 1024×768");
    expect(out.body).toContain("**Captured**:");
  });

  it("style diff는 element 모드에서만 emit", async () => {
    const ctx = makeCtx({
      captureMode: "element",
      diffs: [{ prop: "color", asIs: "#000", toBe: "#fff" }],
    });
    const out = await buildGithubIssueBody({ ctx });
    expect(out.body).toContain("md.section.styleChanges");
    expect(out.body).toContain("| color | #000 | #fff |");
  });

  it("미디어/이미지 없이도 빈 ctx 처리 안전", async () => {
    const out = await buildGithubIssueBody({ ctx: makeCtx({ diffs: [] }) });
    expect(out.body).toContain("# Test");
    expect(out.inlined).toEqual([]);
    expect(out.notInlined).toEqual([]);
  });

  it("section 콘텐츠 비어있으면 md.noValue", async () => {
    const out = await buildGithubIssueBody({
      ctx: makeCtx({
        sections: {},
      }),
    });
    expect(out.body).toContain("md.noValue");
  });

  it("footer 마크다운 포함 (Reported via BugShot)", async () => {
    const out = await buildGithubIssueBody({ ctx: makeCtx() });
    expect(out.body).toMatch(/_Reported via .*BugShot.*_/);
  });
});
