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

describe("buildGithubIssueBody — 첨부 안내", () => {
  it("이미지는 본문에 인라인되지 않고 파일명만 안내로 노출", () => {
    const input: GithubBuildInput = {
      ctx: makeCtx({ captureMode: "screenshot" }),
      images: [{ filename: "screenshot.webp", contentType: "image/webp" }],
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
      video: { filename: "recording.webm", contentType: "video/webm" },
    };
    const out = buildGithubIssueBody(input);
    expect(out.attached).toEqual(["recording.webm"]);
    expect(out.body).toContain("`recording.webm`");
  });

  it("HAR/console 로그도 푸터 안내", () => {
    const input: GithubBuildInput = {
      ctx: makeCtx({ captureMode: "video" }),
      video: { filename: "recording.webm", contentType: "video/webm" },
      logs: [
        { filename: "network-log.har", contentType: "application/json" },
        { filename: "console-log.json", contentType: "application/json" },
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
        { filename: "a.webp", contentType: "image/webp" },
        { filename: "b.webp", contentType: "image/webp" },
        { filename: "c.webp", contentType: "image/webp" },
      ],
    });
    const matches = out.body.match(/github\.attachmentNotInline/g);
    expect(matches).toHaveLength(1);
  });
});

describe("buildGithubIssueBody — 구조", () => {
  it("기본 헤더 (env, page, viewport, captured) 포함 — title은 본문에 미포함", () => {
    const out = buildGithubIssueBody({ ctx: makeCtx() });
    expect(out.body).not.toContain("# Test");
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
    expect(out.body).toBeTruthy();
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

describe("buildGithubIssueBody — URL 인라인", () => {
  it("screenshot 모드 — url이 있으면 미디어 섹션에 인라인", () => {
    const input: GithubBuildInput = {
      ctx: makeCtx({ captureMode: "screenshot" }),
      images: [
        {
          filename: "screenshot.webp",
          contentType: "image/webp",
          url: "https://github.com/user-attachments/assets/abc",
        },
      ],
    };
    const out = buildGithubIssueBody(input);
    expect(out.body).toContain("md.section.media");
    expect(out.body).toContain(
      "![screenshot.webp](https://github.com/user-attachments/assets/abc)",
    );
  });

  it("video 모드 — url이 있으면 미디어 섹션에 인라인", () => {
    const input: GithubBuildInput = {
      ctx: makeCtx({ captureMode: "video" }),
      video: {
        filename: "recording.webm",
        contentType: "video/webm",
        url: "https://github.com/user-attachments/assets/vid123",
      },
    };
    const out = buildGithubIssueBody(input);
    expect(out.body).toContain("md.section.media");
    expect(out.body).toContain(
      "https://github.com/user-attachments/assets/vid123",
    );
    expect(out.body).not.toContain("`recording.webm`");
  });

  it("로그/기타 파일은 첨부 섹션에 위치 (기대 결과 하단)", () => {
    const input: GithubBuildInput = {
      ctx: makeCtx({
        captureMode: "video",
        sections: { description: "본문", expectedResult: "기대" },
      }),
      video: {
        filename: "recording.webm",
        contentType: "video/webm",
        url: "https://github.com/user-attachments/assets/vid",
      },
      logs: [
        {
          filename: "network-log.har",
          contentType: "application/json",
          url: "https://github.com/user-attachments/assets/log1",
        },
      ],
    };
    const out = buildGithubIssueBody(input);
    const mediaIdx = out.body.indexOf("md.section.media");
    const expectedIdx = out.body.indexOf("md.section.expectedResult");
    const attachIdx = out.body.indexOf("md.section.attachments");
    expect(mediaIdx).toBeLessThan(expectedIdx);
    expect(attachIdx).toBeGreaterThan(expectedIdx);
    expect(out.body).toContain(
      "[network-log.har](https://github.com/user-attachments/assets/log1)",
    );
  });

  it("모든 파일에 url이 있으면 drag-drop 안내 없음", () => {
    const input: GithubBuildInput = {
      ctx: makeCtx({ captureMode: "screenshot" }),
      images: [
        {
          filename: "screenshot.webp",
          contentType: "image/webp",
          url: "https://github.com/user-attachments/assets/img1",
        },
      ],
      logs: [
        {
          filename: "bugshot.md",
          contentType: "text/markdown",
          url: "https://github.com/user-attachments/assets/meta1",
        },
      ],
    };
    const out = buildGithubIssueBody(input);
    expect(out.body).not.toContain("github.attachmentNotInline");
  });

  it("혼합 — url 있는 before는 테이블 스냅샷 행, 없는 after는 첨부 섹션", () => {
    const input: GithubBuildInput = {
      ctx: makeCtx({ captureMode: "element" }),
      images: [
        {
          filename: "before.webp",
          contentType: "image/webp",
          url: "https://github.com/user-attachments/assets/b1",
        },
        { filename: "after.webp", contentType: "image/webp" },
      ],
    };
    const out = buildGithubIssueBody(input);
    expect(out.body).toContain("styleTable.snapshot");
    expect(out.body).toContain(
      "![before.webp](https://github.com/user-attachments/assets/b1)",
    );
    expect(out.body).toContain("`after.webp`");
    expect(out.body).toContain("github.attachmentNotInline");
  });

  it("element 모드 before/after 둘 다 url → 스타일 변경 테이블 스냅샷 행에 인라인", () => {
    const input: GithubBuildInput = {
      ctx: makeCtx({
        captureMode: "element",
        diffs: [{ prop: "color", asIs: "#000", toBe: "#fff" }],
      }),
      images: [
        {
          filename: "before.webp",
          contentType: "image/webp",
          url: "https://github.com/user-attachments/assets/b",
        },
        {
          filename: "after.webp",
          contentType: "image/webp",
          url: "https://github.com/user-attachments/assets/a",
        },
      ],
    };
    const out = buildGithubIssueBody(input);
    expect(out.body).toContain("styleTable.snapshot");
    expect(out.body).toContain("![before.webp]");
    expect(out.body).toContain("![after.webp]");
    expect(out.body).toContain("| color | #000 | #fff |");
    expect(out.body).not.toContain("github.attachmentNotInline");
    expect(out.body).not.toContain("md.section.attachments");
  });
});
