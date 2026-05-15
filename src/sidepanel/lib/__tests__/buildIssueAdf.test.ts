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

vi.mock("@/lib/adf-sentinels", () => ({
  IMAGE_PLACEHOLDER: "__BUGSHOT_IMAGE__",
  VIDEO_PLACEHOLDER: "__BUGSHOT_VIDEO__",
  INLINE_IMAGE_PREFIX: "__BUGSHOT_INLINE:",
  inlineImagePlaceholder: (refId: string) => `__BUGSHOT_INLINE:${refId}__`,
  parseInlinePlaceholder: (text: string) => {
    if (!text.startsWith("__BUGSHOT_INLINE:") || !text.endsWith("__")) return null;
    return text.slice("__BUGSHOT_INLINE:".length, -2);
  },
}));

vi.mock("@/lib/element-label", () => ({
  formatElementName: (opts: { tag: string; classList: string[] }) =>
    `${opts.tag}.${opts.classList.join(".")}`,
}));

import { buildIssueAdf, type AdfDoc } from "../buildIssueAdf";
import type { MarkdownContext } from "../buildIssueMarkdown";

function makeCtx(overrides: Partial<MarkdownContext> = {}): MarkdownContext {
  return {
    captureMode: "element",
    title: "Test Issue",
    sections: { description: "버그 설명", stepsToReproduce: "1단계\n2단계" },
    sectionConfig: [
      { id: "description", enabled: true, renderAs: "paragraph", builtIn: true },
      { id: "stepsToReproduce", enabled: true, renderAs: "orderedList", builtIn: true },
      { id: "expectedResult", enabled: true, renderAs: "paragraph", builtIn: true },
      { id: "notes", enabled: false, renderAs: "paragraph", builtIn: true },
    ],
    url: "https://example.com/page",
    selector: "div.container",
    tagName: "div",
    classListBefore: ["container"],
    classListAfter: ["container"],
    specifiedStyles: {},
    tokens: [],
    viewport: { width: 1920, height: 1080 },
    capturedAt: 1700000000000,
    diffs: [{ prop: "color", asIs: "#000", toBe: "#fff" }],
    ...overrides,
  };
}

function findNodes(doc: AdfDoc, type: string): any[] {
  const result: any[] = [];
  function walk(node: any) {
    if (node.type === type) result.push(node);
    if (node.content) node.content.forEach(walk);
  }
  doc.content.forEach(walk);
  return result;
}

describe("buildIssueAdf", () => {
  it("ADF doc 기본 구조", () => {
    const doc = buildIssueAdf(makeCtx());
    expect(doc.version).toBe(1);
    expect(doc.type).toBe("doc");
    expect(doc.content.length).toBeGreaterThan(0);
  });

  it("element 모드 → table 노드", () => {
    const doc = buildIssueAdf(makeCtx());
    const tables = findNodes(doc, "table");
    expect(tables.length).toBeGreaterThanOrEqual(1);
  });

  it("video 모드 → table 없음, VIDEO_PLACEHOLDER 텍스트", () => {
    const doc = buildIssueAdf(makeCtx({ captureMode: "video" }));
    const tables = findNodes(doc, "table");
    expect(tables).toHaveLength(0);
    const texts = findNodes(doc, "text");
    expect(texts.some((t) => t.text === "__BUGSHOT_VIDEO__")).toBe(true);
  });

  it("screenshot 모드 → IMAGE_PLACEHOLDER", () => {
    const doc = buildIssueAdf(makeCtx({ captureMode: "screenshot" }));
    const texts = findNodes(doc, "text");
    expect(texts.some((t) => t.text === "__BUGSHOT_IMAGE__")).toBe(true);
  });

  it("orderedList 섹션", () => {
    const doc = buildIssueAdf(makeCtx());
    const lists = findNodes(doc, "orderedList");
    expect(lists.length).toBeGreaterThanOrEqual(1);
    const items = findNodes(doc, "listItem");
    const stepTexts = items
      .flatMap((i: any) => findNodes({ content: i.content, type: "doc", version: 1 } as AdfDoc, "text"))
      .map((t: any) => t.text);
    expect(stepTexts).toContain("1단계");
    expect(stepTexts).toContain("2단계");
  });

  it("빈 섹션 → noValue 텍스트", () => {
    const doc = buildIssueAdf(makeCtx({ sections: {} }));
    const texts = findNodes(doc, "text");
    expect(texts.some((t) => t.text === "md.noValue")).toBe(true);
  });

  it("disabled 섹션 미출력", () => {
    const doc = buildIssueAdf(makeCtx());
    const headings = findNodes(doc, "heading");
    const headingTexts = headings.flatMap((h: any) =>
      (h.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text),
    );
    expect(headingTexts).not.toContain("md.section.notes");
  });

  it("footer: rule + paragraph", () => {
    const doc = buildIssueAdf(makeCtx());
    const lastTwo = doc.content.slice(-2);
    expect(lastTwo[0].type).toBe("rule");
    expect(lastTwo[1].type).toBe("paragraph");
    const footerTexts = findNodes(
      { version: 1, type: "doc", content: [lastTwo[1]] },
      "text",
    );
    expect(footerTexts.some((t) => t.text === "BugShot")).toBe(true);
  });

  it("줄바꿈 → hardBreak", () => {
    const doc = buildIssueAdf(makeCtx({ sections: { description: "line1\nline2" } }));
    const breaks = findNodes(doc, "hardBreak");
    expect(breaks.length).toBeGreaterThanOrEqual(1);
  });

  it("video 모드 → VIDEO_PLACEHOLDER paragraph (인라인 임베드용)", () => {
    const doc = buildIssueAdf(makeCtx({ captureMode: "video" }));
    const placeholderParagraph = doc.content.find(
      (n) => n.type === "paragraph" && n.content?.[0]?.text === "__BUGSHOT_VIDEO__",
    );
    expect(placeholderParagraph).toBeDefined();
  });

  it("screenshot 모드 → VIDEO_PLACEHOLDER 미포함", () => {
    const doc = buildIssueAdf(makeCtx({ captureMode: "screenshot" }));
    const hasVideoPlaceholder = doc.content.some(
      (n) => n.type === "paragraph" && n.content?.[0]?.text === "__BUGSHOT_VIDEO__",
    );
    expect(hasVideoPlaceholder).toBe(false);
  });

  it("element 모드 → VIDEO_PLACEHOLDER 미포함", () => {
    const doc = buildIssueAdf(makeCtx());
    const hasVideoPlaceholder = doc.content.some(
      (n) => n.type === "paragraph" && n.content?.[0]?.text === "__BUGSHOT_VIDEO__",
    );
    expect(hasVideoPlaceholder).toBe(false);
  });

  it("POST_MEDIA 위치: table이 expectedResult heading 전에 위치", () => {
    const doc = buildIssueAdf(makeCtx());
    const tableIdx = doc.content.findIndex((n) => n.type === "table");
    const expectedHeadingIdx = doc.content.findIndex(
      (n) =>
        n.type === "heading" &&
        n.content?.some((c) => c.text === "md.section.expectedResult"),
    );
    expect(tableIdx).toBeGreaterThan(-1);
    expect(expectedHeadingIdx).toBeGreaterThan(-1);
    expect(tableIdx).toBeLessThan(expectedHeadingIdx);
  });

  it("paragraph 섹션 마크다운 → ADF 인라인 마크", () => {
    const doc = buildIssueAdf(
      makeCtx({ sections: { description: "**bold** and *italic*" } }),
    );
    const texts = findNodes(doc, "text");
    const bold = texts.find(
      (t) => t.text === "bold" && t.marks?.some((m: any) => m.type === "strong"),
    );
    const italic = texts.find(
      (t) => t.text === "italic" && t.marks?.some((m: any) => m.type === "em"),
    );
    expect(bold).toBeDefined();
    expect(italic).toBeDefined();
  });
});

describe("buildIssueAdf — inline images", () => {
  it("인라인 이미지가 해당 섹션 직후에 placeholder로 배치된다", () => {
    const doc = buildIssueAdf(
      makeCtx({ sections: { description: "text ![](inline:abc123) more" } }),
      ["abc123"],
    );
    const descHeading = doc.content.findIndex(
      (n: any) => n.type === "heading" && n.content?.[0]?.text === "md.section.description",
    );
    expect(descHeading).toBeGreaterThanOrEqual(0);
    const nextHeading = doc.content.findIndex(
      (n: any, i: number) => i > descHeading && n.type === "heading",
    );
    const sectionNodes = nextHeading === -1
      ? doc.content.slice(descHeading + 1)
      : doc.content.slice(descHeading + 1, nextHeading);
    const placeholder = sectionNodes.find(
      (n: any) => n.type === "paragraph" && n.content?.[0]?.text === "__BUGSHOT_INLINE:abc123__",
    );
    expect(placeholder).toBeDefined();
  });

  it("업로드되지 않은 refId는 placeholder를 만들지 않는다", () => {
    const doc = buildIssueAdf(
      makeCtx({ sections: { description: "![](inline:notUploaded)" } }),
      [],
    );
    const texts = findNodes(doc, "text");
    expect(texts.some((t) => t.text?.includes("BUGSHOT_INLINE"))).toBe(false);
  });

  it("inlineImageRefIds 없으면 기존 동작 유지", () => {
    const doc = buildIssueAdf(
      makeCtx({ sections: { description: "![](inline:abc)" } }),
    );
    const texts = findNodes(doc, "text");
    expect(texts.some((t) => t.text?.includes("BUGSHOT_INLINE"))).toBe(false);
  });
});
