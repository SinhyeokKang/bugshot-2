import { describe, it, expect } from "vitest";
import {
  buildAiDraftPrompt,
  buildAiDraftSchema,
  buildAiDraftSessionPrompt,
  parseAiDraftResponse,
  type AiDraftContext,
  type AiDraftSessionContext,
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
    expect(prompt).toContain('border-radius: current="8px" → desired="4px"');
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

  it("element 모드: 섹션 설명에 current/desired 힌트 포함", () => {
    const prompt = buildAiDraftPrompt({ ...BASE_CTX, captureMode: "element" });
    expect(prompt).toContain("current");
    expect(prompt).toContain("desired");
  });

  it("screenshot 모드: 섹션 설명에 current/desired 힌트 없음, 스크린샷 힌트 포함", () => {
    const prompt = buildAiDraftPrompt({
      ...BASE_CTX,
      captureMode: "screenshot",
    });
    expect(prompt).not.toMatch(/current value|current 값/);
    expect(prompt).not.toMatch(/desired value|desired 값/);
    expect(prompt).toMatch(/screenshot|스크린샷/i);
  });

  it("video 모드: 섹션 설명에 current/desired 힌트 없음, 에러 로그 힌트 포함", () => {
    const prompt = buildAiDraftPrompt({
      ...BASE_CTX,
      captureMode: "video",
    });
    expect(prompt).not.toMatch(/current value|current 값/);
    expect(prompt).not.toMatch(/desired value|desired 값/);
    expect(prompt).toMatch(/error log|에러 로그/i);
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

describe("buildAiDraftSchema", () => {
  it("title + enabled section ids를 required string properties로 구성", () => {
    const schema = buildAiDraftSchema(["description", "stepsToReproduce"]);
    expect(schema).toEqual({
      type: "object",
      required: ["title", "description", "stepsToReproduce"],
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        stepsToReproduce: { type: "string" },
      },
    });
  });

  it("enabled 섹션 비어있어도 title은 required", () => {
    const schema = buildAiDraftSchema([]);
    expect(schema.required).toEqual(["title"]);
    expect(schema.properties).toEqual({ title: { type: "string" } });
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

describe("buildAiDraftPrompt — freeform", () => {
  it("freeform 모드: URL, 로그 컨텍스트 포함 (video와 유사)", () => {
    const prompt = buildAiDraftPrompt({
      ...BASE_CTX,
      captureMode: "freeform" as AiDraftContext["captureMode"],
      networkLogSummary: {
        captured: 5,
        errors: [{ method: "DELETE", path: "/api/item", status: 500, statusText: "Internal Server Error" }],
      },
      consoleLogSummary: {
        captured: 3,
        errorCount: 1,
        warnCount: 0,
        topErrors: ["ReferenceError: x is not defined"],
      },
    });
    expect(prompt).toContain("https://example.com/page");
    expect(prompt).toContain("DELETE /api/item → 500");
    expect(prompt).toContain("ReferenceError: x is not defined");
  });

  it("freeform 모드: current/desired 힌트 없음, 환경 정보 기반 힌트 포함", () => {
    const prompt = buildAiDraftPrompt({
      ...BASE_CTX,
      captureMode: "freeform" as AiDraftContext["captureMode"],
    });
    expect(prompt).not.toMatch(/current value|current 값/);
    expect(prompt).not.toMatch(/desired value|desired 값/);
    expect(prompt).toMatch(/environment|환경|URL|log|로그/i);
  });

  it("freeform 모드: selector/tagName/diffs 미포함", () => {
    const prompt = buildAiDraftPrompt({
      ...BASE_CTX,
      captureMode: "freeform" as AiDraftContext["captureMode"],
      selector: "div.card > button",
      tagName: "button",
      diffs: [{ prop: "color", asIs: "#000", toBe: "#fff" }],
    });
    expect(prompt).not.toContain("div.card > button");
    expect(prompt).not.toContain("<button>");
    expect(prompt).not.toContain('color: current="#000"');
  });
});

const SESSION_BASE: AiDraftSessionContext = {
  captureMode: "screenshot",
  locale: "ko",
  url: "https://example.com/page",
  pageTitle: "Example Page",
  enabledSections: [
    { id: "description" },
    { id: "stepsToReproduce" },
    { id: "expectedResult" },
  ],
};

describe("buildAiDraftSessionPrompt", () => {
  it("screenshot 모드: URL, 페이지 제목, 이미지 참조 지시 포함", () => {
    const prompt = buildAiDraftSessionPrompt(SESSION_BASE);
    expect(prompt).toContain("https://example.com/page");
    expect(prompt).toContain("Example Page");
    expect(prompt).toContain("screenshot");
    expect(prompt).toMatch(/image|screenshot|스크린샷/i);
  });

  it("video 모드: URL, 페이지 제목, 에러 로그 포함", () => {
    const prompt = buildAiDraftSessionPrompt({
      ...SESSION_BASE,
      captureMode: "video",
      networkLogSummary: {
        captured: 10,
        errors: [
          {
            method: "POST",
            path: "/api/pay",
            status: 500,
            statusText: "Internal Server Error",
          },
        ],
      },
      consoleLogSummary: {
        captured: 5,
        errorCount: 3,
        warnCount: 1,
        topErrors: ["Uncaught Error: payment failed"],
      },
    });
    expect(prompt).toContain("https://example.com/page");
    expect(prompt).toContain("Example Page");
    expect(prompt).toContain("POST /api/pay");
    expect(prompt).toContain("500");
    expect(prompt).toContain("3 errors");
    expect(prompt).toContain("Uncaught Error: payment failed");
  });

  it("video 모드 에러 로그 없으면 에러 관련 텍스트 미포함", () => {
    const prompt = buildAiDraftSessionPrompt({
      ...SESSION_BASE,
      captureMode: "video",
    });
    expect(prompt).toContain("https://example.com/page");
    expect(prompt).not.toContain("Network errors");
    expect(prompt).not.toContain("Console:");
  });

  it("locale ko → Korean, en → English", () => {
    const ko = buildAiDraftSessionPrompt({ ...SESSION_BASE, locale: "ko" });
    expect(ko).toContain("Korean");

    const en = buildAiDraftSessionPrompt({ ...SESSION_BASE, locale: "en" });
    expect(en).toContain("English");
  });

  it("enabledSections에 따라 출력 포맷 섹션 설명 변경", () => {
    const prompt = buildAiDraftSessionPrompt({
      ...SESSION_BASE,
      enabledSections: [
        { id: "description" },
        { id: "notes" },
      ],
    });
    expect(prompt).toContain('"description"');
    expect(prompt).toContain('"notes"');
    expect(prompt).not.toContain('"stepsToReproduce"');
    expect(prompt).not.toContain('"expectedResult"');
  });

  it("video 모드에서 이미지 참조 지시 미포함", () => {
    const prompt = buildAiDraftSessionPrompt({
      ...SESSION_BASE,
      captureMode: "video",
    });
    expect(prompt).not.toMatch(/image|이미지/i);
  });

  it("screenshot 모드: 섹션 설명에 current/desired 힌트 없음", () => {
    const prompt = buildAiDraftSessionPrompt(SESSION_BASE);
    expect(prompt).not.toMatch(/current value|current 값/);
    expect(prompt).not.toMatch(/desired value|desired 값/);
    expect(prompt).toMatch(/screenshot|스크린샷/i);
  });

  it("video 모드: 섹션 설명에 current/desired 힌트 없음, 녹화 맥락 포함", () => {
    const prompt = buildAiDraftSessionPrompt({
      ...SESSION_BASE,
      captureMode: "video",
    });
    expect(prompt).not.toMatch(/current value|current 값/);
    expect(prompt).not.toMatch(/desired value|desired 값/);
    expect(prompt).toMatch(/record|녹화/i);
  });

  it("freeform 모드: URL, 페이지 제목, 로그 컨텍스트 포함", () => {
    const prompt = buildAiDraftSessionPrompt({
      ...SESSION_BASE,
      captureMode: "freeform" as AiDraftSessionContext["captureMode"],
      networkLogSummary: {
        captured: 3,
        errors: [{ method: "GET", path: "/api/data", status: 404, statusText: "Not Found" }],
      },
      consoleLogSummary: {
        captured: 2,
        errorCount: 1,
        warnCount: 0,
        topErrors: ["TypeError: fetch failed"],
      },
    });
    expect(prompt).toContain("https://example.com/page");
    expect(prompt).toContain("Example Page");
    expect(prompt).toContain("GET /api/data");
    expect(prompt).toContain("404");
    expect(prompt).toContain("TypeError: fetch failed");
  });

  it("freeform 모드: 이미지/스크린샷/녹화 참조 지시 미포함", () => {
    const prompt = buildAiDraftSessionPrompt({
      ...SESSION_BASE,
      captureMode: "freeform" as AiDraftSessionContext["captureMode"],
    });
    expect(prompt).not.toMatch(/image|screenshot|스크린샷/i);
    expect(prompt).not.toMatch(/record|녹화/i);
  });

  it("freeform 모드: current/desired 힌트 없음", () => {
    const prompt = buildAiDraftSessionPrompt({
      ...SESSION_BASE,
      captureMode: "freeform" as AiDraftSessionContext["captureMode"],
    });
    expect(prompt).not.toMatch(/current value|current 값/);
    expect(prompt).not.toMatch(/desired value|desired 값/);
  });
});
