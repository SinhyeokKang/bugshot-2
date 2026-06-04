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

// 모듈은 아직 없음 — import 실패가 첫 red.
import { buildMarkdownContext } from "../buildMarkdownContext";
import type { IssueSection } from "@/store/settings-ui-store";

const sectionConfig: IssueSection[] = [
  { id: "description", enabled: true, renderAs: "paragraph", builtIn: true },
  { id: "stepsToReproduce", enabled: true, renderAs: "orderedList", builtIn: true },
];

function baseArgs(overrides: Record<string, unknown> = {}) {
  return {
    captureMode: "screenshot" as const,
    title: "Test Issue",
    resolvedSections: { description: "본문", stepsToReproduce: "1단계\n2단계" },
    sectionConfig,
    os: "macOS",
    browser: "Chrome 120",
    url: "https://example.com/page",
    environment: [],
    viewport: { width: 1920, height: 1080 },
    capturedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("buildMarkdownContext", () => {
  it("screenshot 모드: captureMode·빈 selector·인자 viewport/capturedAt 반영", () => {
    const ctx = buildMarkdownContext(baseArgs({ captureMode: "screenshot" }));

    expect(ctx.captureMode).toBe("screenshot");
    expect(ctx.selector).toBe("");
    expect(ctx.tokens).toEqual([]);
    expect(ctx.diffs).toEqual([]);
    expect(ctx.viewport).toEqual({ width: 1920, height: 1080 });
    expect(ctx.capturedAt).toBe(1_700_000_000_000);
    expect(ctx.sections).toEqual({ description: "본문", stepsToReproduce: "1단계\n2단계" });
  });

  it("video 모드: captureMode video + 로그 요약 전달 시 포함", () => {
    const ctx = buildMarkdownContext(
      baseArgs({
        captureMode: "video",
        networkLogSummary: { captured: 3, errors: [] },
        consoleLogSummary: { captured: 5, errorCount: 1, warnCount: 0 },
      }),
    );

    expect(ctx.captureMode).toBe("video");
    expect(ctx.networkLogSummary).toEqual({ captured: 3, errors: [] });
    expect(ctx.consoleLogSummary).toEqual({ captured: 5, errorCount: 1, warnCount: 0 });
  });

  it("freeform 모드: captureMode freeform + 인자 viewport/capturedAt 반영", () => {
    const ctx = buildMarkdownContext(
      baseArgs({
        captureMode: "freeform",
        viewport: { width: 800, height: 600 },
        capturedAt: 42,
      }),
    );

    expect(ctx.captureMode).toBe("freeform");
    expect(ctx.viewport).toEqual({ width: 800, height: 600 });
    expect(ctx.capturedAt).toBe(42);
  });

  it("element 모드: selection에서 selector/viewport/capturedAt 채움", () => {
    const ctx = buildMarkdownContext(
      baseArgs({
        captureMode: "element",
        selection: {
          selector: "div.container",
          tagName: "div",
          classList: ["container"],
          specifiedStyles: { color: "#000" },
          viewport: { width: 1280, height: 720 },
          capturedAt: 999,
        },
        styleEditsClassList: ["container", "active"],
        tokens: [],
        diffs: [],
      }),
    );

    expect(ctx.selector).toBe("div.container");
    expect(ctx.tagName).toBe("div");
    expect(ctx.classListBefore).toEqual(["container"]);
    expect(ctx.classListAfter).toEqual(["container", "active"]);
    expect(ctx.viewport).toEqual({ width: 1280, height: 720 });
    expect(ctx.capturedAt).toBe(999);
  });

  it("element 모드 엣지: 변경된 prop의 값에 등장하는 토큰만 relevantTokens로 남긴다", () => {
    const ctx = buildMarkdownContext(
      baseArgs({
        captureMode: "element",
        selection: {
          selector: "button",
          tagName: "button",
          classList: [],
          specifiedStyles: { color: "var(--brand)", padding: "var(--space)" },
          viewport: { width: 100, height: 100 },
          capturedAt: 1,
        },
        styleEditsClassList: [],
        // color만 변경 → padding의 --space 토큰은 제외돼야 함
        diffs: [{ prop: "color", asIs: "#000", toBe: "#fff" }],
        tokens: [
          { name: "--brand", value: "#111" },
          { name: "--space", value: "8px" },
        ],
      }),
    );

    expect(ctx.tokens).toEqual([{ name: "--brand", value: "#111" }]);
  });
});
