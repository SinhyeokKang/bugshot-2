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

  it("video 모드 → table 없음, videoAttached 텍스트", () => {
    const doc = buildIssueAdf(makeCtx({ captureMode: "video" }));
    const tables = findNodes(doc, "table");
    expect(tables).toHaveLength(0);
    const texts = findNodes(doc, "text");
    expect(texts.some((t) => t.text === "md.videoAttached")).toBe(true);
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
});
