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

vi.mock("@/lib/element-label", () => ({
  formatElementName: (opts: { tag: string; classList: string[] }) => {
    const cls = opts.classList.map((c: string) => `.${c}`).join("");
    return `${opts.tag}${cls}`;
  },
}));

import { buildNotionIssueBody } from "../buildNotionIssueBody";
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

describe("buildNotionIssueBody — block 변환", () => {
  it("환경 섹션은 heading_2 + bulleted_list_item로", () => {
    const out = buildNotionIssueBody({ ctx: makeCtx() });
    const headings = out.blocks.filter((b) => b.type === "heading_2");
    expect(headings.length).toBeGreaterThan(0);
    expect(headings[0]).toMatchObject({ type: "heading_2", text: "md.section.env" });
    const bullets = out.blocks.filter((b) => b.type === "bulleted_list_item");
    expect(bullets.some((b) => "text" in b && b.text.startsWith("Page:"))).toBe(true);
    expect(
      bullets.some((b) => "text" in b && b.text.startsWith("Viewport:")),
    ).toBe(true);
  });

  it("section 콘텐츠 비어있으면 paragraph(md.noValue)", () => {
    const out = buildNotionIssueBody({ ctx: makeCtx({ sections: {} }) });
    const paragraphs = out.blocks.filter((b) => b.type === "paragraph");
    expect(paragraphs.some((b) => "text" in b && b.text === "md.noValue")).toBe(
      true,
    );
  });

  it("orderedList 섹션은 bulleted_list_item 다중", () => {
    const ctx = makeCtx({
      sections: { stepsToReproduce: "1\n2\n3" },
      sectionConfig: [
        {
          id: "stepsToReproduce",
          enabled: true,
          renderAs: "orderedList",
          builtIn: true,
        },
      ],
    });
    const out = buildNotionIssueBody({ ctx });
    const bullets = out.blocks.filter((b) => b.type === "bulleted_list_item");
    const stepBullets = bullets.filter(
      (b) => "text" in b && ["1", "2", "3"].includes(b.text),
    );
    expect(stepBullets.length).toBe(3);
  });
});

describe("buildNotionIssueBody — 미디어 분기", () => {
  it("screenshot 모드: image block 인라인 + attachments에 큐", () => {
    const out = buildNotionIssueBody({
      ctx: makeCtx({ captureMode: "screenshot" }),
      images: [
        {
          filename: "screenshot.png",
          contentType: "image/png",
          dataUrl: "data:image/png;base64,YQ==",
        },
      ],
    });
    const imageBlock = out.blocks.find((b) => b.type === "image");
    expect(imageBlock).toBeDefined();
    expect(out.attachments.length).toBe(1);
    expect(out.attachments[0].category).toBe("image");
    expect(out.attachments[0].placeholderId).toBe(
      imageBlock && "placeholderId" in imageBlock
        ? imageBlock.placeholderId
        : "",
    );
  });

  it("video 모드: type:'video' inline 블록 emit + attachments placeholderId 매칭", () => {
    const out = buildNotionIssueBody({
      ctx: makeCtx({ captureMode: "video" }),
      video: {
        filename: "recording.webm",
        contentType: "video/webm",
        dataUrl: "data:video/webm;base64,YQ==",
      },
    });
    const videoBlock = out.blocks.find((b) => b.type === "video");
    expect(videoBlock).toBeDefined();
    // image 블록은 안 만들어짐
    const imageBlock = out.blocks.find((b) => b.type === "image");
    expect(imageBlock).toBeUndefined();
    expect(out.attachments.length).toBe(1);
    expect(out.attachments[0].category).toBe("video");
    if (videoBlock && videoBlock.type === "video") {
      expect(out.attachments[0].placeholderId).toBe(videoBlock.placeholderId);
    }
  });

  it("video 모드: video 있으면 '(recording.webm 참조)' 안내 paragraph 안 emit", () => {
    const out = buildNotionIssueBody({
      ctx: makeCtx({ captureMode: "video" }),
      video: {
        filename: "recording.webm",
        contentType: "video/webm",
        dataUrl: "data:video/webm;base64,YQ==",
      },
    });
    const refParagraph = out.blocks.find(
      (b) =>
        b.type === "paragraph" && "text" in b && b.text === "md.videoAttached",
    );
    expect(refParagraph).toBeUndefined();
  });

  it("video 모드: video 없으면 안내 paragraph로 fallback", () => {
    const out = buildNotionIssueBody({
      ctx: makeCtx({ captureMode: "video" }),
    });
    const refParagraph = out.blocks.find(
      (b) =>
        b.type === "paragraph" && "text" in b && b.text === "md.videoAttached",
    );
    expect(refParagraph).toBeDefined();
    // video 블록은 안 만들어짐
    const videoBlock = out.blocks.find((b) => b.type === "video");
    expect(videoBlock).toBeUndefined();
  });

  it("element 모드: Before/After heading_3 + 이미지 + diff bullet list", () => {
    const ctx = makeCtx({
      captureMode: "element",
      diffs: [{ prop: "color", asIs: "#000", toBe: "#fff" }],
    });
    const out = buildNotionIssueBody({
      ctx,
      images: [
        {
          filename: "before.webp",
          contentType: "image/webp",
          dataUrl: "data:image/webp;base64,YQ==",
        },
        {
          filename: "after.webp",
          contentType: "image/webp",
          dataUrl: "data:image/webp;base64,YQ==",
        },
      ],
    });
    // 표는 안 만들어진다
    expect(out.blocks.find((b) => b.type === "table")).toBeUndefined();

    const headings3 = out.blocks.filter((b) => b.type === "heading_3");
    expect(headings3.map((b) => "text" in b && b.text)).toEqual([
      "md.section.before",
      "md.section.after",
    ]);

    // Before 섹션: heading_3 → image → bullet (asIs)
    const beforeIdx = out.blocks.findIndex(
      (b) => b.type === "heading_3" && "text" in b && b.text === "md.section.before",
    );
    expect(out.blocks[beforeIdx + 1].type).toBe("image");
    expect(out.blocks[beforeIdx + 2]).toMatchObject({
      type: "bulleted_list_item",
      text: "color: #000",
    });

    // After 섹션: heading_3 → image → bullet (toBe)
    const afterIdx = out.blocks.findIndex(
      (b) => b.type === "heading_3" && "text" in b && b.text === "md.section.after",
    );
    expect(out.blocks[afterIdx + 1].type).toBe("image");
    expect(out.blocks[afterIdx + 2]).toMatchObject({
      type: "bulleted_list_item",
      text: "color: #fff",
    });

    expect(out.attachments.map((a) => a.filename).sort()).toEqual([
      "after.webp",
      "before.webp",
    ]);
  });

  it("element 모드: image 블록 placeholderId가 attachments와 매칭", () => {
    const ctx = makeCtx({
      captureMode: "element",
      diffs: [{ prop: "color", asIs: "#000", toBe: "#fff" }],
    });
    const out = buildNotionIssueBody({
      ctx,
      images: [
        {
          filename: "before.webp",
          contentType: "image/webp",
          dataUrl: "data:image/webp;base64,YQ==",
        },
        {
          filename: "after.webp",
          contentType: "image/webp",
          dataUrl: "data:image/webp;base64,YQ==",
        },
      ],
    });
    const imageBlocks = out.blocks.filter((b) => b.type === "image");
    expect(imageBlocks.length).toBe(2);
    const phToFilename = new Map(
      out.attachments.map((a) => [a.placeholderId, a.filename]),
    );
    for (const b of imageBlocks) {
      if (b.type !== "image") throw new Error("expected image block");
      expect(phToFilename.has(b.placeholderId)).toBe(true);
    }
  });

  it("element 모드: before만 있으면 Before 섹션만 image, After 섹션은 heading만 (diffs 없음)", () => {
    const ctx = makeCtx({ captureMode: "element", diffs: [] });
    const out = buildNotionIssueBody({
      ctx,
      images: [
        {
          filename: "before.webp",
          contentType: "image/webp",
          dataUrl: "data:image/webp;base64,YQ==",
        },
      ],
    });
    const imageBlocks = out.blocks.filter((b) => b.type === "image");
    expect(imageBlocks.length).toBe(1);
    expect(out.attachments.map((a) => a.filename)).toEqual(["before.webp"]);
    // diffs 없고 after 이미지도 없으면 After 섹션 자체 미emit
    const headings3Texts = out.blocks
      .filter((b) => b.type === "heading_3")
      .map((b) => ("text" in b ? b.text : ""));
    expect(headings3Texts).toEqual(["md.section.before"]);
  });

  it("element 모드: after만 있으면 After 섹션만 emit", () => {
    const ctx = makeCtx({ captureMode: "element", diffs: [] });
    const out = buildNotionIssueBody({
      ctx,
      images: [
        {
          filename: "after.webp",
          contentType: "image/webp",
          dataUrl: "data:image/webp;base64,YQ==",
        },
      ],
    });
    const imageBlocks = out.blocks.filter((b) => b.type === "image");
    expect(imageBlocks.length).toBe(1);
    expect(out.attachments.map((a) => a.filename)).toEqual(["after.webp"]);
    const headings3Texts = out.blocks
      .filter((b) => b.type === "heading_3")
      .map((b) => ("text" in b ? b.text : ""));
    expect(headings3Texts).toEqual(["md.section.after"]);
  });

  it("element 모드: diffs만 있고 이미지 없으면 image 블록 0개, Before/After 섹션은 bullet list만", () => {
    const ctx = makeCtx({
      captureMode: "element",
      diffs: [{ prop: "color", asIs: "a", toBe: "b" }],
    });
    const out = buildNotionIssueBody({ ctx, images: [] });
    const imageBlocks = out.blocks.filter((b) => b.type === "image");
    expect(imageBlocks.length).toBe(0);
    expect(out.attachments).toEqual([]);
    // 표는 안 만들어진다
    expect(out.blocks.find((b) => b.type === "table")).toBeUndefined();
    const bullets = out.blocks
      .filter((b) => b.type === "bulleted_list_item")
      .map((b) => ("text" in b ? b.text : ""));
    expect(bullets).toContain("color: a");
    expect(bullets).toContain("color: b");
  });

  it("로그 첨부는 attachments 큐에 log 카테고리로", () => {
    const out = buildNotionIssueBody({
      ctx: makeCtx({ captureMode: "screenshot" }),
      images: [
        {
          filename: "screenshot.png",
          contentType: "image/png",
          dataUrl: "data:image/png;base64,YQ==",
        },
      ],
      logs: [
        {
          filename: "console.json",
          contentType: "application/json",
          dataUrl: "data:application/json;base64,YQ==",
          category: "log",
        },
      ],
    });
    expect(out.attachments.find((a) => a.category === "log")).toBeDefined();
    expect(out.attachments.find((a) => a.category === "image")).toBeDefined();
  });
});

describe("buildNotionIssueBody — 로그 요약", () => {
  it("네트워크/콘솔 로그 요약은 code block", () => {
    const out = buildNotionIssueBody({
      ctx: makeCtx({
        networkLogSummary: {
          captured: 10,
          errors: [
            {
              method: "GET",
              path: "/api/x",
              status: 500,
              statusText: "Internal Server Error",
            },
          ],
        },
        consoleLogSummary: {
          captured: 20,
          errorCount: 3,
          warnCount: 1,
          topErrors: ["TypeError"],
        },
      }),
    });
    const codeBlocks = out.blocks.filter((b) => b.type === "code");
    expect(codeBlocks.length).toBeGreaterThanOrEqual(2);
    const allCodeText = codeBlocks
      .map((b) => ("text" in b ? b.text : ""))
      .join("\n");
    expect(allCodeText).toContain("GET /api/x → 500");
    expect(allCodeText).toContain("TypeError");
  });
});
