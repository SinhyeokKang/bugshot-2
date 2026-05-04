import { describe, it, expect } from "vitest";
import {
  buildAiDraftPrompt,
  parseAiDraftResponse,
  type AiDraftContext,
} from "../buildAiDraftPrompt";

const BASE_CTX: AiDraftContext = {
  captureMode: "element",
  locale: "ko",
  url: "https://example.com/page",
  pageTitle: "Example Page",
  enabledSections: [
    { id: "description", renderAs: "paragraph" },
    { id: "stepsToReproduce", renderAs: "orderedList" },
    { id: "expectedResult", renderAs: "paragraph" },
  ],
};

describe("buildAiDraftPrompt", () => {
  it("element 모드: diffs, tokens, selector 포함", () => {
    const prompt = buildAiDraftPrompt({
      ...BASE_CTX,
      selector: "div.card > button",
      tagName: "button",
      diffs: [{ prop: "border-radius", asIs: "8px", toBe: "4px" }],
      tokens: [{ name: "--radius-xxl", value: "16px" }],
    });
    expect(prompt).toContain("<button>");
    expect(prompt).toContain("div.card > button");
    expect(prompt).toContain('border-radius: "8px" → "4px"');
    expect(prompt).toContain("--radius-xxl: 16px");
  });

  it("video 모드: networkLogSummary, consoleLogSummary 포함", () => {
    const prompt = buildAiDraftPrompt({
      ...BASE_CTX,
      captureMode: "video",
      networkLogSummary: {
        captured: 10,
        errors: [{ method: "GET", path: "/api/users", status: 500, statusText: "Internal Server Error" }],
      },
      consoleLogSummary: {
        captured: 5,
        errorCount: 2,
        warnCount: 1,
        topErrors: ["TypeError: Cannot read property 'id' of null"],
      },
    });
    expect(prompt).toContain("GET /api/users → 500");
    expect(prompt).toContain("2 errors, 1 warnings");
    expect(prompt).toContain("TypeError: Cannot read property");
  });

  it("screenshot 모드: url, pageTitle만 포함", () => {
    const prompt = buildAiDraftPrompt({
      ...BASE_CTX,
      captureMode: "screenshot",
      selector: "div.card",
      tagName: "div",
      diffs: [{ prop: "color", asIs: "red", toBe: "blue" }],
    });
    expect(prompt).toContain("https://example.com/page");
    expect(prompt).toContain("Example Page");
    expect(prompt).not.toContain("div.card");
    expect(prompt).not.toContain('color: "red"');
  });

  it("locale ko → Korean, en → English", () => {
    const koPrompt = buildAiDraftPrompt({ ...BASE_CTX, locale: "ko" });
    expect(koPrompt).toContain("Korean");

    const enPrompt = buildAiDraftPrompt({ ...BASE_CTX, locale: "en" });
    expect(enPrompt).toContain("English");
  });

  it("enabledSections가 JSON 키 지시에 반영", () => {
    const prompt = buildAiDraftPrompt({
      ...BASE_CTX,
      enabledSections: [
        { id: "description", renderAs: "paragraph" },
        { id: "notes", renderAs: "paragraph" },
      ],
    });
    expect(prompt).toContain('"description"');
    expect(prompt).toContain('"notes"');
    expect(prompt).not.toContain('"stepsToReproduce"');
  });

  it("diffs 20개 초과 시 20개로 절삭", () => {
    const diffs = Array.from({ length: 25 }, (_, i) => ({
      prop: `prop-${i}`,
      asIs: "a",
      toBe: "b",
    }));
    const prompt = buildAiDraftPrompt({
      ...BASE_CTX,
      diffs,
      selector: "div",
      tagName: "div",
    });
    expect(prompt).toContain("prop-19");
    expect(prompt).not.toContain("prop-20");
  });

  it("tokens 10개 초과 시 10개로 절삭", () => {
    const tokens = Array.from({ length: 15 }, (_, i) => ({
      name: `--token-${i}`,
      value: `${i}px`,
    }));
    const prompt = buildAiDraftPrompt({
      ...BASE_CTX,
      tokens,
      selector: "div",
      tagName: "div",
    });
    expect(prompt).toContain("--token-9");
    expect(prompt).not.toContain("--token-10");
  });
});

describe("parseAiDraftResponse", () => {
  const ids = ["description", "stepsToReproduce", "expectedResult"] as const;

  it("정상 JSON → EditorDraft 변환", () => {
    const raw = JSON.stringify({
      title: "버튼 radius 불일치",
      description: "CTA 버튼의 radius가 다릅니다",
      stepsToReproduce: "페이지 접속\nCTA 버튼 확인",
      expectedResult: "8px 적용",
    });
    const result = parseAiDraftResponse(raw, [...ids]);
    expect(result).toEqual({
      title: "버튼 radius 불일치",
      sections: {
        description: "CTA 버튼의 radius가 다릅니다",
        stepsToReproduce: "페이지 접속\nCTA 버튼 확인",
        expectedResult: "8px 적용",
      },
    });
  });

  it("markdown 펜스 감싼 JSON 처리", () => {
    const raw = '```json\n{"title":"Test","description":"desc"}\n```';
    const result = parseAiDraftResponse(raw, ["description"]);
    expect(result).toEqual({
      title: "Test",
      sections: { description: "desc" },
    });
  });

  it("title 누락 시 null", () => {
    const raw = JSON.stringify({ description: "no title" });
    expect(parseAiDraftResponse(raw, ["description"])).toBeNull();
  });

  it("잘못된 JSON 시 null", () => {
    expect(parseAiDraftResponse("not json at all", ["description"])).toBeNull();
  });

  it("enabled 아닌 섹션 키 무시", () => {
    const raw = JSON.stringify({
      title: "Test",
      description: "desc",
      notes: "should be ignored",
    });
    const result = parseAiDraftResponse(raw, ["description"]);
    expect(result?.sections).toEqual({ description: "desc" });
    expect(result?.sections).not.toHaveProperty("notes");
  });

  it("빈 sections 허용 (title만 있어도 OK)", () => {
    const raw = JSON.stringify({ title: "Title only" });
    const result = parseAiDraftResponse(raw, ["description"]);
    expect(result).toEqual({ title: "Title only", sections: {} });
  });

  it("값이 string이 아닌 섹션 키 무시", () => {
    const raw = JSON.stringify({
      title: "Test",
      description: 123,
      stepsToReproduce: ["step1", "step2"],
    });
    const result = parseAiDraftResponse(raw, [...ids]);
    expect(result?.sections).toEqual({});
  });

  it("title 80자 초과 시 절삭", () => {
    const longTitle = "A".repeat(100);
    const raw = JSON.stringify({ title: longTitle, description: "desc" });
    const result = parseAiDraftResponse(raw, ["description"]);
    expect(result?.title).toHaveLength(80);
  });

  it("stepsToReproduce 번호 prefix 제거", () => {
    const raw = JSON.stringify({
      title: "Test",
      stepsToReproduce: "1. 페이지 접속\n2. 버튼 확인\n3) 에러 확인",
    });
    const result = parseAiDraftResponse(raw, ["stepsToReproduce"]);
    expect(result?.sections.stepsToReproduce).toBe(
      "페이지 접속\n버튼 확인\n에러 확인",
    );
  });
});
