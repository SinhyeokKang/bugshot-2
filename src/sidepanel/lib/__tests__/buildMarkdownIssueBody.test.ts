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
  sectionMdLabelKey: (id: string) => `md.section.${id}`,
}));

import {
  buildMarkdownIssueBody,
  type MarkdownIssueBuildInput,
} from "../buildMarkdownIssueBody";
import type { MarkdownContext } from "../buildIssueMarkdown";

function makeCtx(overrides: Partial<MarkdownContext> = {}): MarkdownContext {
  return {
    captureMode: "element",
    title: "Test",
    sections: { description: "본문" },
    sectionConfig: [
      { id: "description", enabled: true, renderAs: "paragraph", builtIn: true },
      { id: "media", enabled: true, renderAs: "meta", builtIn: true },
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
    environment: [],
    ...overrides,
  };
}

const VIDEO_URL = "https://up/recording.webm";

function videoInput(
  overrides: Partial<MarkdownIssueBuildInput> = {},
): MarkdownIssueBuildInput {
  return {
    ctx: makeCtx({ captureMode: "video" }),
    video: { filename: "recording.webm", contentType: "video/webm", url: VIDEO_URL },
    ...overrides,
  };
}

describe("buildMarkdownIssueBody — videoEmbed 콜백", () => {
  it("github: videoEmbed로 bare url 임베드 (미디어 섹션)", () => {
    const out = buildMarkdownIssueBody(videoInput(), {
      platform: "github",
      videoEmbed: (m) => m.url,
    });
    expect(out.body).toContain("md.section.media");
    expect(out.body.split("\n")).toContain(VIDEO_URL);
    expect(out.body).not.toContain(`![recording.webm](${VIDEO_URL})`);
    expect(out.attached).toContain("recording.webm");
  });

  it("gitlab: videoEmbed 미지정이면 기본 마크다운 이미지 문법", () => {
    const out = buildMarkdownIssueBody(videoInput(), { platform: "gitlab" });
    expect(out.body).toContain(`![recording.webm](${VIDEO_URL})`);
    expect(out.attached).toContain("recording.webm");
  });

  it("videoEmbed는 미디어 섹션 + 첨부 섹션 두 지점 모두에 적용", () => {
    const out = buildMarkdownIssueBody(
      videoInput({
        attachments: [
          { filename: "clip.mp4", contentType: "video/mp4", url: "https://up/clip.mp4" },
        ],
      }),
      {
        platform: "github",
        videoEmbed: (m) => `EMBED(${m.filename}|${m.url})`,
      },
    );
    expect(out.body).toContain(`EMBED(recording.webm|${VIDEO_URL})`);
    expect(out.body).toContain("EMBED(clip.mp4|https://up/clip.mp4)");
  });
});

describe("buildMarkdownIssueBody — platform별 i18n 키", () => {
  it("github: url 없는 첨부는 github.attachmentNotInline 안내", () => {
    const out = buildMarkdownIssueBody(
      {
        ctx: makeCtx({ captureMode: "screenshot" }),
        images: [{ filename: "screenshot.webp", contentType: "image/webp" }],
      },
      { platform: "github" },
    );
    expect(out.body).toContain("github.attachmentNotInline");
    expect(out.body).toContain("`screenshot.webp`");
    expect(out.attached).toEqual(["screenshot.webp"]);
  });

  it("gitlab: url 없는 첨부는 gitlab.attachmentNotInline 안내", () => {
    const out = buildMarkdownIssueBody(
      {
        ctx: makeCtx({ captureMode: "screenshot" }),
        images: [{ filename: "screenshot.webp", contentType: "image/webp" }],
      },
      { platform: "gitlab" },
    );
    expect(out.body).toContain("gitlab.attachmentNotInline");
    expect(out.body).not.toContain("github.attachmentNotInline");
  });
});

describe("buildMarkdownIssueBody — 공통 동작 보존", () => {
  it("첨부 0건이면 첨부 섹션 미표시", () => {
    const out = buildMarkdownIssueBody({ ctx: makeCtx() }, { platform: "github" });
    expect(out.attached).toEqual([]);
    expect(out.body).not.toContain("md.section.attachments");
  });

  it("이미지 첨부는 양 플랫폼 공통 마크다운 이미지 문법으로 인라인", () => {
    const out = buildMarkdownIssueBody(
      {
        ctx: makeCtx({ captureMode: "screenshot" }),
        images: [
          { filename: "shot.webp", contentType: "image/webp", url: "https://up/shot.webp" },
        ],
        attachments: [
          { filename: "extra.png", contentType: "image/png", url: "https://up/extra.png" },
        ],
      },
      { platform: "github" },
    );
    expect(out.body).toContain("![shot.webp](https://up/shot.webp)");
    expect(out.body).toContain("![extra.png](https://up/extra.png)");
  });

  it("logs url이 있으면 로그 요약 안내 {file}에 마크다운 링크 주입", () => {
    const out = buildMarkdownIssueBody(
      {
        ctx: makeCtx({ networkLogSummary: { captured: 5, errorCount: 0, errors: [] } }),
        logs: [
          { filename: "logs.html", contentType: "text/html", url: "https://up/logs.html" },
        ],
      },
      { platform: "gitlab" },
    );
    expect(out.body).toContain(
      "logSummary.logs.detail file=[logs.html](https://up/logs.html)",
    );
  });
});
