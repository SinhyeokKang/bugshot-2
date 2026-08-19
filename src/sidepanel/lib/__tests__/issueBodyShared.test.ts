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
}));

import {
  sectionLabel,
  listItems,
  emitMarkdownLogSummary,
  escapeMdLinkText,
  imageCell,
  type LogSummaryContext,
} from "../issueBodyShared";
import type { IssueSection } from "@/store/settings-ui-store";

function section(overrides: Partial<IssueSection> = {}): IssueSection {
  return {
    id: "description",
    enabled: true,
    renderAs: "paragraph",
    builtIn: true,
    ...overrides,
  };
}

describe("sectionLabel", () => {
  it("labelOverride가 있으면 그것을 쓴다 (사용자 지정 우선)", () => {
    expect(sectionLabel(section({ labelOverride: "우리 팀 라벨" }))).toBe("우리 팀 라벨");
  });

  // 공백만 남은 override는 "지정 안 함"으로 떨어져야 헤딩이 빈 줄로 나가지 않는다.
  it("labelOverride가 공백뿐이면 기본 라벨로 떨어진다", () => {
    expect(sectionLabel(section({ labelOverride: "   " }))).toBe("md.section.description");
  });

  it("labelOverride가 없으면 섹션 id로 기본 라벨을 찾는다", () => {
    expect(sectionLabel(section())).toBe("md.section.description");
  });
});

describe("listItems", () => {
  it("줄 단위로 쪼개고 각 줄을 trim한다", () => {
    expect(listItems("  첫째 \n둘째  ")).toEqual(["첫째", "둘째"]);
  });

  it("CRLF도 같은 줄 경계로 본다", () => {
    expect(listItems("첫째\r\n둘째")).toEqual(["첫째", "둘째"]);
  });

  it("빈 줄은 버린다", () => {
    expect(listItems("첫째\n\n  \n둘째")).toEqual(["첫째", "둘째"]);
  });

  it("내용이 없으면 빈 배열", () => {
    expect(listItems("   ")).toEqual([]);
  });
});

describe("emitMarkdownLogSummary", () => {
  const net = { captured: 12, errorCount: 3, errors: [] };
  const con = { captured: 40, errorCount: 2, warnCount: 1, topErrors: [] };

  function ctx(overrides: LogSummaryContext = {}): LogSummaryContext {
    return overrides;
  }

  it("로그가 하나도 없으면 아무것도 안 쓴다", () => {
    const lines: string[] = [];
    emitMarkdownLogSummary(lines, ctx());
    expect(lines).toEqual([]);
  });

  // logsHref 유무가 이 함수의 유일한 갈래다. 없으면 평문, 있으면 링크 — 통합하면서 optional을
  // 잃으면 linear·asana 본문에 `[logs.html](undefined)`가 나간다.
  it("logsHref가 없으면 평문 logs.html", () => {
    const lines: string[] = [];
    emitMarkdownLogSummary(lines, ctx({ networkLogSummary: net }));
    expect(lines.join("\n")).toContain("file=logs.html");
    expect(lines.join("\n")).not.toContain("](");
  });

  it("logsHref가 있으면 링크로 감싼다", () => {
    const lines: string[] = [];
    emitMarkdownLogSummary(lines, ctx({ networkLogSummary: net }), "https://cdn/logs.html");
    expect(lines.join("\n")).toContain("file=[logs.html](https://cdn/logs.html)");
  });

  it("network·console·action 3종이 다 있으면 3줄을 쓴다", () => {
    const lines: string[] = [];
    emitMarkdownLogSummary(
      lines,
      ctx({ networkLogSummary: net, consoleLogSummary: con, actionLogCaptured: 7 }),
    );
    const body = lines.join("\n");
    expect(body).toContain("logSummary.network.line n=12 errors=3");
    expect(body).toContain("logSummary.console.line n=40 errors=2 warns=1");
    expect(body).toContain("logSummary.action.line n=7");
  });

  // errorCount가 0이면 에러 수를 말하지 않는 별도 문구로 갈린다.
  it("에러가 0이면 network·console 모두 무에러 문구를 쓴다", () => {
    const lines: string[] = [];
    emitMarkdownLogSummary(
      lines,
      ctx({
        networkLogSummary: { captured: 5, errorCount: 0, errors: [] },
        consoleLogSummary: { captured: 9, errorCount: 0, warnCount: 0, topErrors: [] },
      }),
    );
    const body = lines.join("\n");
    expect(body).toContain("logSummary.network.lineNoError n=5");
    expect(body).toContain("logSummary.console.lineNoError n=9");
  });

});

describe("imageCell", () => {
  it("파일명과 url로 마크다운 이미지 셀을 만든다", () => {
    expect(imageCell("shot.png", "https://cdn/x.png")).toBe("![shot.png](https://cdn/x.png)");
  });

  // 형제 함수(defaultVideoEmbed·첨부 라인)는 escapeMdLinkText를 쓰는데 imageCell 3벌만
  // 안 썼다. `]`가 링크 텍스트를 조기 종료해 표 셀이 통째로 깨진다.
  it("링크 텍스트의 구조 문자를 이스케이프한다", () => {
    expect(imageCell("a[1].png", "https://cdn/x.png")).toBe(
      "![a\\[1\\].png](https://cdn/x.png)",
    );
  });

  it("역슬래시도 이스케이프한다", () => {
    expect(imageCell("a\\b.png", "u")).toBe("![a\\\\b.png](u)");
  });

  // 세 빌더가 각각 url·assetUrl로 필드명이 달라 media 객체를 받지 못한다 — 가드는 호출부.
  it("url은 이스케이프하지 않는다 (이미 인코딩된 값)", () => {
    expect(imageCell("x.png", "https://cdn/a[1].png")).toBe("![x.png](https://cdn/a[1].png)");
  });
});

describe("escapeMdLinkText", () => {
  // buildIssueMarkdown에 있으면 issueBodyShared → buildIssueMarkdown → issueBodyShared
  // 순환이라 leaf가 못 쓴다. 정본을 여기로 내리고 그쪽은 re-export.
  it("issueBodyShared가 정본을 소유한다", () => {
    expect(escapeMdLinkText("a[1].png")).toBe("a\\[1\\].png");
  });
});
