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
  sectionLabelKey: (id: string) => `section.${id}`,
  sectionMdLabelKey: (id: string) => `md.section.${id}`,
}));

// 모듈은 아직 없음 — import 실패가 첫 red.
import { buildMarkdownContext } from "../buildMarkdownContext";
import type { IssueSection } from "@/store/settings-ui-store";

const sectionConfig: IssueSection[] = [
  { id: "description", enabled: true, renderAs: "paragraph", builtIn: true },
  { id: "stepsToReproduce", enabled: true, renderAs: "orderedList", builtIn: true },
  { id: "media", enabled: true, renderAs: "meta", builtIn: true },
];

function baseArgs(overrides: Record<string, unknown> = {}) {
  return {
    bodyLocale: "ko" as const,
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

  it("video 모드: actionLogCaptured 전달 시 그대로 포함", () => {
    const ctx = buildMarkdownContext(
      baseArgs({ captureMode: "video", actionLogCaptured: 7 }),
    );
    expect(ctx.actionLogCaptured).toBe(7);
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

    // element 분기만 captureMode를 안 실어, 빌더들이 부정형("그 외") 판정으로 우연히 흡수했다.
    expect(ctx.captureMode).toBe("element");
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

// element-screenshot: screenshot 분기에 optional selector/tagName 주입 경로.
// 요소 캡처는 채워지고, 범위 캡처(selector 미입력)는 빈 문자열 유지.
describe("요소 캡처: screenshot + selector 주입", () => {
  it("screenshot + selector/tagName → ctx.selector·tagName 채움", () => {
    const ctx = buildMarkdownContext(
      baseArgs({ captureMode: "screenshot", selector: "button.cta", tagName: "button" }),
    );
    expect(ctx.selector).toBe("button.cta");
    expect(ctx.tagName).toBe("button");
  });

  it("screenshot + selector 미입력(범위 캡처) → ctx.selector 빈 문자열 (회귀)", () => {
    const ctx = buildMarkdownContext(baseArgs({ captureMode: "screenshot" }));
    expect(ctx.selector).toBe("");
  });
});

// 미리보기·클립보드 복사 경로의 생산지. store 접근이 없으므로 PreviewPanel이 해석 후 주입한다 —
// 여기 들어오는 값은 이미 resolveBodyLocale을 통과한 LocaleMode이지 "auto"가 아니다.
describe("buildMarkdownContext — bodyLocale", () => {
  it("인자로 받은 bodyLocale을 ctx에 그대로 싣는다", () => {
    expect(buildMarkdownContext(baseArgs({ bodyLocale: "en" })).bodyLocale).toBe("en");
    expect(buildMarkdownContext(baseArgs({ bodyLocale: "ko" })).bodyLocale).toBe("ko");
  });

  it("element 모드에서도 동일하게 실린다 (분기가 둘이라 누락되기 쉽다)", () => {
    const ctx = buildMarkdownContext(
      baseArgs({
        captureMode: "element",
        bodyLocale: "en",
        selection: {
          selector: "button.cta",
          tagName: "button",
          classList: [],
          specifiedStyles: {},
          viewport: { width: 800, height: 600 },
          capturedAt: 1_700_000_000_000,
        },
      }),
    );
    expect(ctx.bodyLocale).toBe("en");
  });
});
