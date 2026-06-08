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
    environment: [],
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

  it("logs.html 로그도 푸터 안내", () => {
    const input: GithubBuildInput = {
      ctx: makeCtx({ captureMode: "video" }),
      video: { filename: "recording.webm", contentType: "video/webm" },
      logs: [
        { filename: "logs.html", contentType: "text/html" },
      ],
    };
    const out = buildGithubIssueBody(input);
    expect(out.attached).toEqual([
      "recording.webm",
      "logs.html",
    ]);
    expect(out.body).toContain("`logs.html`");
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

describe("buildGithubIssueBody — freeform", () => {
  it("freeform 모드 → 미디어 섹션 없음, 첨부 없음", () => {
    const out = buildGithubIssueBody({
      ctx: makeCtx({ captureMode: "freeform" as MarkdownContext["captureMode"], selector: "", diffs: [] }),
    });
    expect(out.body).not.toContain("md.section.media");
    expect(out.body).not.toContain("md.section.styleChanges");
    expect(out.body).not.toContain("md.imageAttached");
    expect(out.body).not.toContain("md.videoAttached");
    expect(out.attached).toEqual([]);
  });

  it("freeform 모드 → DOM 미표시", () => {
    const out = buildGithubIssueBody({
      ctx: makeCtx({ captureMode: "freeform" as MarkdownContext["captureMode"], selector: "" }),
    });
    expect(out.body).not.toContain("**DOM**");
  });

  it("freeform 모드 → 환경 정보(Page, Viewport, Captured) 포함", () => {
    const out = buildGithubIssueBody({
      ctx: makeCtx({ captureMode: "freeform" as MarkdownContext["captureMode"], selector: "", diffs: [] }),
    });
    expect(out.body).toContain("**Page**: https://example.com");
    expect(out.body).toContain("**Viewport**:");
    expect(out.body).toContain("**Captured**:");
  });

  it("freeform 모드 + 로그 첨부 → 첨부 섹션에 표시", () => {
    const out = buildGithubIssueBody({
      ctx: makeCtx({ captureMode: "freeform" as MarkdownContext["captureMode"], selector: "", diffs: [] }),
      logs: [
        { filename: "logs.html", contentType: "text/html" },
      ],
    });
    expect(out.attached).toEqual(["logs.html"]);
    expect(out.body).toContain("`logs.html`");
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
          filename: "logs.html",
          contentType: "text/html",
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
      "[logs.html](https://github.com/user-attachments/assets/log1)",
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
      ctx: makeCtx({
        captureMode: "element",
        diffs: [{ prop: "color", asIs: "#000", toBe: "#fff" }],
      }),
      images: [
        {
          filename: "before-0.webp",
          contentType: "image/webp",
          url: "https://github.com/user-attachments/assets/b1",
        },
        { filename: "after-0.webp", contentType: "image/webp" },
      ],
    };
    const out = buildGithubIssueBody(input);
    expect(out.body).toContain("styleTable.snapshot");
    expect(out.body).toContain(
      "![before-0.webp](https://github.com/user-attachments/assets/b1)",
    );
    expect(out.body).toContain("`after-0.webp`");
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
          filename: "before-0.webp",
          contentType: "image/webp",
          url: "https://github.com/user-attachments/assets/b",
        },
        {
          filename: "after-0.webp",
          contentType: "image/webp",
          url: "https://github.com/user-attachments/assets/a",
        },
      ],
    };
    const out = buildGithubIssueBody(input);
    expect(out.body).toContain("styleTable.snapshot");
    expect(out.body).toContain("![before-0.webp]");
    expect(out.body).toContain("![after-0.webp]");
    expect(out.body).toContain("| color | #000 | #fff |");
    expect(out.body).not.toContain("github.attachmentNotInline");
    expect(out.body).not.toContain("md.section.attachments");
  });

  it("복수 element → 각 섹션이 자기 before-${i}/after-${i} (교차 매칭·중복 없음)", () => {
    const input: GithubBuildInput = {
      ctx: makeCtx({
        captureMode: "element",
        styleElements: [
          { selector: "button.cta", tagName: "button", classListBefore: [], classListAfter: [], specifiedStyles: {}, diffs: [{ prop: "color", asIs: "#000", toBe: "#fff" }], beforeFilename: "before-0.webp", afterFilename: "after-0.webp" },
          { selector: "div.card", tagName: "div", classListBefore: [], classListAfter: [], specifiedStyles: {}, diffs: [{ prop: "padding", asIs: "10px", toBe: "20px" }], beforeFilename: "before-1.webp", afterFilename: "after-1.webp" },
        ],
      }),
      images: [
        { filename: "before-0.webp", contentType: "image/webp", url: "u-b0" },
        { filename: "after-0.webp", contentType: "image/webp", url: "u-a0" },
        { filename: "before-1.webp", contentType: "image/webp", url: "u-b1" },
        { filename: "after-1.webp", contentType: "image/webp", url: "u-a1" },
      ],
    };
    const out = buildGithubIssueBody(input);
    expect(out.body).toContain("md.section.styleChanges (button.cta)");
    expect(out.body).toContain("md.section.styleChanges (div.card)");
    const sec0 = out.body.indexOf("(button.cta)");
    const sec1 = out.body.indexOf("(div.card)");
    expect(out.body.slice(sec0, sec1)).toContain("![before-0.webp](u-b0)");
    expect(out.body.slice(sec0, sec1)).toContain("![after-0.webp](u-a0)");
    expect(out.body.slice(sec1)).toContain("![before-1.webp](u-b1)");
    expect(out.body.slice(sec1)).toContain("![after-1.webp](u-a1)");
    // 4쌍 모두 mediaHandled → 하단 Attachments 중복 없음
    expect(out.body).not.toContain("md.section.attachments");
  });
});

describe("buildGithubIssueBody — element + diffs 없음 (no-diff 폐지)", () => {
  it("element + diffs=[] + 이미지 없음 → styleChanges·media 미출력", () => {
    const out = buildGithubIssueBody({
      ctx: makeCtx({ captureMode: "element", diffs: [] }),
    });
    expect(out.body).not.toContain("md.section.styleChanges");
    expect(out.body).not.toContain("md.section.media");
  });

  it("element + diffs 존재 → Style Changes (selector) 테이블 유지", () => {
    const input: GithubBuildInput = {
      ctx: makeCtx({
        captureMode: "element",
        diffs: [{ prop: "color", asIs: "#000", toBe: "#fff" }],
      }),
      images: [
        { filename: "before-0.webp", contentType: "image/webp", url: "https://github.com/user-attachments/assets/b" },
        { filename: "after-0.webp", contentType: "image/webp", url: "https://github.com/user-attachments/assets/a" },
      ],
    };
    const out = buildGithubIssueBody(input);
    expect(out.body).toContain("md.section.styleChanges (div)");
    expect(out.body).toContain("| color | #000 | #fff |");
  });
});

describe("buildGithubIssueBody — browser 환경 정보", () => {
  it("browser 있으면 Page 행 위에 Browser 행 출력", () => {
    const out = buildGithubIssueBody({ ctx: makeCtx({ browser: "Chrome 128.0.6613.85" }) });
    const browserIdx = out.body.indexOf("**Browser**: Chrome 128.0.6613.85");
    const pageIdx = out.body.indexOf("**Page**:");
    expect(browserIdx).toBeGreaterThan(-1);
    expect(browserIdx).toBeLessThan(pageIdx);
  });

  it("browser null이면 Browser 행 미출력", () => {
    const out = buildGithubIssueBody({ ctx: makeCtx({ browser: null }) });
    expect(out.body).not.toContain("**Browser**");
  });

  it("browser 미전달이면 Browser 행 미출력 (하위호환)", () => {
    const out = buildGithubIssueBody({ ctx: makeCtx() });
    expect(out.body).not.toContain("**Browser**");
  });
});

describe("buildGithubIssueBody — os 환경 정보", () => {
  it("os 있으면 Browser 행 위에 OS 행 출력", () => {
    const out = buildGithubIssueBody({
      ctx: makeCtx({ os: "macOS 15.2", browser: "Chrome 128.0.6613.85" }),
    });
    const osIdx = out.body.indexOf("**OS**: macOS 15.2");
    const browserIdx = out.body.indexOf("**Browser**: Chrome 128.0.6613.85");
    const pageIdx = out.body.indexOf("**Page**:");
    expect(osIdx).toBeGreaterThan(-1);
    expect(osIdx).toBeLessThan(browserIdx);
    expect(browserIdx).toBeLessThan(pageIdx);
  });

  it("os null이면 OS 행 미출력", () => {
    const out = buildGithubIssueBody({ ctx: makeCtx({ os: null }) });
    expect(out.body).not.toContain("**OS**");
  });

  it("os 미전달이면 OS 행 미출력 (하위호환)", () => {
    const out = buildGithubIssueBody({ ctx: makeCtx() });
    expect(out.body).not.toContain("**OS**");
  });
});

describe("buildGithubIssueBody — custom environment rows", () => {
  it("custom row가 Environment 섹션 불릿으로 포함", () => {
    const out = buildGithubIssueBody({
      ctx: makeCtx({ environment: [{ label: "Browser", value: "Chrome 140" }] }),
    });
    expect(out.body).toContain("- **Browser**: Chrome 140");
  });

  it("빈 row 제외, value 개행 공백 치환", () => {
    const out = buildGithubIssueBody({
      ctx: makeCtx({
        environment: [
          { label: "", value: "ignored" },
          { label: "OS", value: "macOS\n15" },
        ],
      }),
    });
    expect(out.body).not.toContain("ignored");
    expect(out.body).toContain("- **OS**: macOS 15");
  });
});

// element-screenshot (Group A: ctx.selector 직접 출력): 요소 캡처(screenshot + selector)는 DOM 줄 노출.
describe("buildGithubIssueBody — 요소 캡처 (screenshot + selector)", () => {
  it("screenshot + selector → 본문에 DOM 줄", () => {
    const out = buildGithubIssueBody({
      ctx: makeCtx({ captureMode: "screenshot", selector: "button.cta", diffs: [] }),
    });
    expect(out.body).toContain("**DOM**: button.cta");
  });

  it("screenshot + 빈 selector(범위 캡처) → DOM 미표시 (회귀)", () => {
    const out = buildGithubIssueBody({
      ctx: makeCtx({ captureMode: "screenshot", selector: "", diffs: [] }),
    });
    expect(out.body).not.toContain("**DOM**");
  });
});
