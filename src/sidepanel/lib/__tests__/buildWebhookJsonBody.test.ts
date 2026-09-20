import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  withLocale: <T,>(_locale: string, fn: () => T): T => fn(),
  t: (key: string) => key,
  dateBcp47: () => "en-US",
}));

vi.mock("@/store/settings-ui-store", () => ({
  sectionMdLabelKey: (id: string) => `md.section.${id}`,
}));

import { buildWebhookJsonBody } from "../buildWebhookJsonBody";
import type { MarkdownContext } from "../buildIssueMarkdown";

function makeCtx(overrides: Partial<MarkdownContext> = {}): MarkdownContext {
  return {
    bodyLocale: "ko",
    captureMode: "screenshot",
    title: "버튼이 안 눌린다",
    sections: { description: "본문" },
    sectionConfig: [
      { id: "description", enabled: true, renderAs: "paragraph", builtIn: true },
    ],
    url: "https://example.com",
    selector: "#pay",
    tagName: "button",
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

// sections 맵은 {{sections.<id>}}로 수신 서버에 직행한다. 본문(body)은 sectionConfig를
// 존중하는데 이 맵만 안 하면, 같은 payload 안에서 이슈 구성 축 두 개가 어긋나 사용자가
// 끈 섹션이 나간다. 섹션 토글은 "이건 안 보낸다"는 명시적 컨트롤이다.
describe("buildWebhookJsonBody — sections 맵은 sectionConfig를 따른다", () => {
  it("비활성 섹션은 sections 맵에서 빠진다", () => {
    const { sections } = buildWebhookJsonBody(makeCtx({
      sections: { description: "보낸다", notes: "내부 메모라 껐다" },
      sectionConfig: [
        { id: "description", enabled: true, renderAs: "paragraph", builtIn: true },
        { id: "notes", enabled: false, renderAs: "paragraph", builtIn: true },
      ],
    }));

    expect(sections.description).toBe("보낸다");
    expect(sections).not.toHaveProperty("notes");
  });

  it("비활성 섹션의 내부 마커가 새지 않는다", () => {
    // placeholderSectionImages는 enabled && paragraph만 치환한다. 끈 섹션을 맵에 남기면
    // 치환도 안 된 inline:<refId> 원문이 그대로 나간다 — 파일 헤더가 선언한 "무음 유실 금지"의
    // 정반대다.
    const { sections } = buildWebhookJsonBody(makeCtx({
      sections: { description: "보낸다", notes: "![x](inline:ref-1)" },
      sectionConfig: [
        { id: "description", enabled: true, renderAs: "paragraph", builtIn: true },
        { id: "notes", enabled: false, renderAs: "paragraph", builtIn: true },
      ],
    }));

    expect(JSON.stringify(sections)).not.toContain("inline:");
  });

  it("활성 paragraph 섹션의 인라인 마커는 대체 문구로 바뀐다 (기존 동작 유지)", () => {
    const { sections } = buildWebhookJsonBody(makeCtx({
      sections: { description: "![x](inline:ref-1)" },
      sectionConfig: [
        { id: "description", enabled: true, renderAs: "paragraph", builtIn: true },
      ],
    }));

    expect(sections.description).not.toContain("inline:");
    expect(sections.description).toContain("webhook.attachmentNotInline");
  });

  it("sectionConfig에 없는 섹션도 맵에서 빠진다", () => {
    // draft.sections는 무필터로 넘어온다(buildEditorCapture). config에 없는 잔재가
    // 남아 있으면 그것도 사용자가 의도한 전송 대상이 아니다.
    const { sections } = buildWebhookJsonBody(makeCtx({
      sections: { description: "보낸다", expectedResult: "config에 없는 잔재" },
    }));

    expect(sections).not.toHaveProperty("expectedResult");
  });
});

// json 템플릿 모드는 파일을 한 장도 보내지 않는다(캡처 미디어도, logs.html도). 그런데 본문의
// 로그 요약 리드는 "리포트가 첨부되어 있다 · logs.html에서 확인하라"고 말한다 — 수신처(Slack·
// Discord)에 그런 파일은 없다. 인라인 이미지 자리를 대체 문구로 바꾸는 것과 같은 축이다.
describe("buildWebhookJsonBody — 없는 첨부를 가리키지 않는다", () => {
  const withLogs = makeCtx({
    actionLogCaptured: 12,
    consoleLogSummary: { captured: 3, errorCount: 0, warnCount: 0, topErrors: [] },
  });

  it("로그 요약에 첨부 리드 문구가 없다", () => {
    const { body } = buildWebhookJsonBody(withLogs);
    expect(body).not.toContain("logSummary.logs.lead");
    expect(body).not.toContain("logs.html");
  });

  it("로그 요약 섹션과 건수 줄은 그대로 남는다", () => {
    const { body } = buildWebhookJsonBody(withLogs);
    expect(body).toContain("logSummary.title");
    expect(body).toContain("logSummary.action.line");
    expect(body).toContain("logSummary.console.lineNoError");
  });
});
