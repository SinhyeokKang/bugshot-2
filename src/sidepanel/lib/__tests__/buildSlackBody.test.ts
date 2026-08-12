import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  // 빌더 진입점이 withLocale로 감싸져 있다 — 모킹에서 빠지면 통째로 죽는다(패스스루).
  withLocale: <T>(_locale: string, fn: () => T): T => fn(),
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
    bodyLocale: "ko",
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
          { id: "media", enabled: true, renderAs: "meta", builtIn: true },
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

// errors[]는 dedup+cap된 표시용 샘플이라 개수로 쓰면 심각도가 축소된다 —
// 같은 요청이 3번 실패해도 "에러 1건"으로 나갔다(8개 빌더 공통 드리프트).
describe("buildSlackBody — 네트워크 에러 건수", () => {
  it("dedup 전 전체 건수(errorCount)를 인쇄한다", () => {
    const { body } = buildSlackBody({
      ctx: makeCtx({
        networkLogSummary: {
          captured: 7,
          errorCount: 3,
          errors: [{ id: "nr-t1", method: "PUT", path: "/evaluation", status: 400, statusText: "Bad" }],
        },
      }),
    });
    expect(body).toContain("logSummary.network.line n=7 errors=3");
  });
});
