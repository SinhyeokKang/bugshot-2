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
import { CC_SENTINEL } from "../ccMention";
import { markdownToAsanaHtml } from "../markdownToAsanaHtml";

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

  it("element 모드 → DOM 줄 selector는 백틱, HTML 변환 시 <code>", () => {
    const out = buildAsanaIssueBody({ ctx: makeCtx({ selector: "button.cta" }) });
    expect(out.body).toContain("**DOM**: `button.cta`");
    expect(markdownToAsanaHtml(out.body)).toContain("<code>button.cta</code>");
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

  it("element 비교 모드 — As is/To be (selector) 섹션에 이미지 + 속성값 분리", () => {
    const out = buildAsanaIssueBody({
      ctx: makeCtx({
        captureMode: "element",
        selector: "div.box",
        diffs: [{ prop: "color", asIs: "red", toBe: "blue" }],
      }),
      images: [
        { filename: "before-0.webp", contentType: "image/webp" },
        { filename: "after-0.webp", contentType: "image/webp" },
      ],
    });
    expect(out.body).toContain("## styleTable.asIs (div.box)");
    expect(out.body).toContain("## styleTable.toBe (div.box)");
    expect(out.body).toContain("![before-0.webp](before-0.webp)");
    expect(out.body).toContain("![after-0.webp](after-0.webp)");
    expect(out.body).toContain("- **color**: red");
    expect(out.body).toContain("- **color**: blue");
    // 비교에 쓰인 이미지는 media 섹션으로 새지 않음
    expect(out.body).not.toContain("md.section.media");
    expect(out.attached).toEqual(
      expect.arrayContaining(["before-0.webp", "after-0.webp"]),
    );
  });

  it("복수 element — 각 As is/To be 섹션이 자기 before-${i}/after-${i}", () => {
    const out = buildAsanaIssueBody({
      ctx: makeCtx({
        captureMode: "element",
        styleElements: [
          { selector: "a.x", tagName: "a", classListBefore: [], classListAfter: [], specifiedStyles: {}, diffs: [{ prop: "color", asIs: "red", toBe: "blue" }], beforeFilename: "before-0.png", afterFilename: "after-0.png" },
          { selector: "b.y", tagName: "b", classListBefore: [], classListAfter: [], specifiedStyles: {}, diffs: [{ prop: "padding", asIs: "1px", toBe: "2px" }], beforeFilename: "before-1.png", afterFilename: "after-1.png" },
        ],
      }),
      images: [
        { filename: "before-0.png", contentType: "image/png" },
        { filename: "after-0.png", contentType: "image/png" },
        { filename: "before-1.png", contentType: "image/png" },
        { filename: "after-1.png", contentType: "image/png" },
      ],
    });
    expect(out.body).toContain("## styleTable.asIs (a.x)");
    expect(out.body).toContain("## styleTable.asIs (b.y)");
    expect(out.body).toContain("![before-0.png](before-0.png)");
    expect(out.body).toContain("![before-1.png](before-1.png)");
    expect(out.body).not.toContain("md.section.media");
  });
});

describe("cc 멘션 (sentinel)", () => {
  it("hasCc면 sentinel 줄이 --- 푸터 직전에 위치", () => {
    const out = buildAsanaIssueBody({ ctx: makeCtx(), hasCc: true });
    const lines = out.body.split("\n");
    const idx = lines.indexOf(CC_SENTINEL);
    expect(idx).toBeGreaterThan(-1);
    expect(lines[idx + 2]).toBe("---");
  });

  it("hasCc 미지정·false 모두 기존 출력과 등치", () => {
    const base = buildAsanaIssueBody({ ctx: makeCtx() });
    expect(buildAsanaIssueBody({ ctx: makeCtx(), hasCc: undefined })).toEqual(base);
    expect(buildAsanaIssueBody({ ctx: makeCtx(), hasCc: false })).toEqual(base);
  });

  it("markdownToAsanaHtml 통과 시 sentinel 원형 보존", () => {
    const out = buildAsanaIssueBody({ ctx: makeCtx(), hasCc: true });
    expect(markdownToAsanaHtml(out.body)).toContain(CC_SENTINEL);
  });

  it("본문에 마크다운 참조 정의가 있어도 sentinel이 살아남는다 (구 괄호 sentinel 회귀)", () => {
    const out = buildAsanaIssueBody({
      ctx: makeCtx({
        sections: {
          description: `[bugshot:cc]: https://example.com\n[${CC_SENTINEL}]: https://example.com`,
        },
      }),
      hasCc: true,
    });
    expect(markdownToAsanaHtml(out.body)).toContain(CC_SENTINEL);
  });
});
