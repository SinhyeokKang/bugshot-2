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
  sectionLabelKey: (id: string) => `section.${id}`,
  sectionMdLabelKey: (id: string) => `md.section.${id}`,
}));

// inline 이미지 resolve는 외부 의존(blob-db/IndexedDB) — 결정적으로 모킹.
// "inline:xxx" 마커를 dataURL로 치환하는 것만 흉내.
vi.mock("../resolveInlineImages", () => ({
  resolveInlineImages: vi.fn(async (markdown: string) => ({
    resolved: markdown.replace(/inline:(\S+)/g, "data:image/png;base64,RESOLVED_$1"),
    images: [],
  })),
}));

// 모듈은 아직 없음 — import 실패가 첫 red.
import { buildReportData } from "../buildReportData";
import { buildIssueMarkdown, buildIssueHtml, type MarkdownContext } from "../buildIssueMarkdown";
import type { IssueSection } from "@/store/settings-ui-store";

const sectionConfig: IssueSection[] = [
  { id: "description", enabled: true, renderAs: "paragraph", builtIn: true },
  { id: "stepsToReproduce", enabled: true, renderAs: "orderedList", builtIn: true },
  { id: "expectedResult", enabled: true, renderAs: "paragraph", builtIn: true },
  { id: "notes", enabled: false, renderAs: "paragraph", builtIn: true },
];

function makeCtx(overrides: Partial<MarkdownContext> = {}): MarkdownContext {
  return {
    captureMode: "screenshot",
    title: "T",
    sections: { description: "본문" },
    sectionConfig,
    url: "https://example.com",
    selector: "",
    tagName: "",
    classListBefore: [],
    classListAfter: [],
    specifiedStyles: {},
    tokens: [],
    viewport: { width: 800, height: 600 },
    capturedAt: 1_700_000_000_000,
    diffs: [],
    environment: [],
    ...overrides,
  };
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    title: "리포트 제목",
    sections: {
      description: "버그 설명",
      stepsToReproduce: "1단계\n2단계",
      expectedResult: "기대 결과",
      notes: "메모",
    } as Record<string, string>,
    sectionConfig,
    envRows: [
      { label: "OS", value: "macOS" },
      { label: "Page", value: "https://example.com" },
    ],
    markdownContext: makeCtx(),
    ...overrides,
  };
}

describe("buildReportData", () => {
  it("제목·env는 입력을 그대로 전달한다", async () => {
    const report = await buildReportData(baseInput());

    expect(report.title).toBe("리포트 제목");
    expect(report.env).toEqual([
      { label: "OS", value: "macOS" },
      { label: "Page", value: "https://example.com" },
    ]);
  });

  it("enabled 섹션만 config 순서대로 담는다 (disabled notes 제외)", async () => {
    const report = await buildReportData(baseInput());

    expect(report.sections.map((s) => s.id)).toEqual([
      "description",
      "stepsToReproduce",
      "expectedResult",
    ]);
  });

  it("label은 labelOverride 우선, 없으면 sectionLabelKey", async () => {
    const cfg: IssueSection[] = [
      { id: "description", enabled: true, renderAs: "paragraph", builtIn: true, labelOverride: "  나의 설명  " },
      { id: "expectedResult", enabled: true, renderAs: "paragraph", builtIn: true },
    ];
    const report = await buildReportData(baseInput({ sectionConfig: cfg }));

    expect(report.sections[0].label).toBe("나의 설명");
    expect(report.sections[1].label).toBe("section.expectedResult");
  });

  it("paragraph 섹션의 inline 마커는 dataURL로 resolve된다", async () => {
    const report = await buildReportData(
      baseInput({
        sections: {
          description: "before ![img](inline:abc123) after",
          stepsToReproduce: "1단계",
          expectedResult: "기대",
        },
      }),
    );

    const desc = report.sections.find((s) => s.id === "description");
    expect(desc?.value).not.toContain("inline:");
    expect(desc?.value).toContain("data:image/png;base64,RESOLVED_abc123");
  });

  it("orderedList 섹션은 inline 마커를 치환하지 않는다 (paragraph 전용 게이트)", async () => {
    const report = await buildReportData(
      baseInput({
        sections: {
          description: "본문",
          stepsToReproduce: "![x](inline:keepme)",
          expectedResult: "기대",
        },
      }),
    );

    const steps = report.sections.find((s) => s.id === "stepsToReproduce");
    expect(steps?.value).toContain("inline:keepme");
  });

  it("copy는 resolved 섹션이 반영된 markdownContext로 빌드한 결과와 일치한다", async () => {
    const input = baseInput();
    // 실제 호출처는 markdownContext.sections == input.sections(같은 draft) — 동일하게 맞춰 검증.
    const ctx = { ...input.markdownContext, sections: input.sections };
    const report = await buildReportData(input);

    expect(report.copy.markdown).toBe(buildIssueMarkdown(ctx));
    expect(report.copy.html).toBe(buildIssueHtml(ctx));
  });

  it("copy.markdown은 paragraph inline 마커를 dataURL로 resolve한다 (클립보드 깨짐 방지)", async () => {
    const report = await buildReportData(
      baseInput({
        sections: {
          description: "본문 ![](inline:abc123)",
          stepsToReproduce: "1단계",
          expectedResult: "기대",
        },
      }),
    );

    expect(report.copy.markdown).not.toContain("inline:");
    expect(report.copy.markdown).toContain("data:image/png;base64,RESOLVED_abc123");
  });
});
