import { describe, expect, it, vi } from "vitest";

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

import { buildSlackBody } from "../buildSlackBody";
import type { MarkdownContext } from "../buildIssueMarkdown";

function makeCtx(over: Partial<MarkdownContext> = {}): MarkdownContext {
  return {
    captureMode: "screenshot",
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
    ...over,
  };
}

describe("buildSlackBody — 환경 정보", () => {
  it("OS·Page를 *볼드* 불릿 줄로 낸다 (mrkdwn 헤딩 없음)", () => {
    const { body } = buildSlackBody({ ctx: makeCtx({ os: "macOS" }) });
    expect(body).toContain("• *OS*: macOS");
    expect(body).toContain("• *Page*: https://example.com");
    // 헤딩 마크다운(##)을 쓰지 않는다.
    expect(body).not.toContain("## ");
  });

  it("환경 값의 < > & 를 escapeMrkdwn으로 이스케이프", () => {
    const { body } = buildSlackBody({
      ctx: makeCtx({ environment: [{ label: "UA", value: "a<b>c&d" }] }),
    });
    expect(body).toContain("a&lt;b&gt;c&amp;d");
  });
});

describe("buildSlackBody — 섹션", () => {
  it("섹션 내용에 markdownToMrkdwn을 적용한다 (**bold** → *bold*)", () => {
    const { body } = buildSlackBody({
      ctx: makeCtx({ sections: { description: "this is **bold**" } }),
    });
    expect(body).toContain("this is *bold*");
    expect(body).not.toContain("**bold**");
  });

  it("빈 섹션은 md.noValue로 폴백", () => {
    const { body } = buildSlackBody({ ctx: makeCtx({ sections: {} }) });
    expect(body).toContain("md.noValue");
  });

  it("orderedList 섹션은 번호 줄로 낸다", () => {
    const { body } = buildSlackBody({
      ctx: makeCtx({
        sections: { stepsToReproduce: "first\nsecond" },
        sectionConfig: [
          { id: "stepsToReproduce", enabled: true, renderAs: "orderedList", builtIn: true },
        ],
      }),
    });
    expect(body).toContain("1. first");
    expect(body).toContain("2. second");
  });
});

describe("buildSlackBody — 로그 안내 문구", () => {
  it("첫 문장은 mrkdwn *볼드*, italic 래핑 제거", () => {
    const { body } = buildSlackBody({ ctx: makeCtx({ actionLogCaptured: 5 }) });
    expect(body).toContain("*logSummary.logs.lead*");
    expect(body).toContain("logSummary.logs.detail file=logs.html");
    expect(body).not.toContain("_logSummary.logs.detail");
  });
});

describe("buildSlackBody — footer", () => {
  it("footer는 mrkdwn 링크 형식", () => {
    const { body } = buildSlackBody({ ctx: makeCtx() });
    expect(body).toContain("_Reported via <https://bug-shot.com|BugShot>_");
  });

  it("이미지/영상은 본문에 임베드하지 않는다 (attached 비어 있음)", () => {
    const { attached } = buildSlackBody({ ctx: makeCtx() });
    expect(attached).toEqual([]);
  });
});
