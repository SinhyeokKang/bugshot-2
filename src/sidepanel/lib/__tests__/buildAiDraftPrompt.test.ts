import { describe, it, expect } from "vitest";
import {
  buildAiDraftSchema,
  buildAiDraftSessionPrompt,
  parseAiDraftResponse,
  type AiDraftSessionContext,
} from "../buildAiDraftPrompt";

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

  it("video 모드: action log 요약 포함", () => {
    const prompt = buildAiDraftSessionPrompt({
      ...SESSION_BASE,
      captureMode: "video",
      actionLogSummary: ["click Submit 버튼", "input email"],
    });
    expect(prompt).toContain("User actions");
    expect(prompt).toContain("click Submit 버튼");
  });

  it("freeform 모드: action log는 제외 (video 전용)", () => {
    const prompt = buildAiDraftSessionPrompt({
      ...SESSION_BASE,
      captureMode: "freeform",
      actionLogSummary: ["click Submit 버튼", "input email"],
    });
    expect(prompt).not.toContain("User actions");
    expect(prompt).not.toContain("click Submit 버튼");
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

  const SESSION_ELEMENT_BASE: AiDraftSessionContext = {
    captureMode: "element",
    locale: "ko",
    url: "https://example.com/page",
    pageTitle: "Example Page",
    enabledSections: [
      { id: "description" },
      { id: "stepsToReproduce" },
      { id: "expectedResult" },
    ],
  };

  it("element 모드: selector, tagName, diffs, tokens 포함", () => {
    const prompt = buildAiDraftSessionPrompt({
      ...SESSION_ELEMENT_BASE,
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

  it("element 모드: userPrompt 없으면 User context 줄 미포함", () => {
    const prompt = buildAiDraftSessionPrompt(SESSION_ELEMENT_BASE);
    expect(prompt).not.toContain("- User context:");
  });

  it("element 모드: userPrompt 있으면 User context 줄 포함", () => {
    const prompt = buildAiDraftSessionPrompt({
      ...SESSION_ELEMENT_BASE,
      userPrompt: "다크 모드에서 텍스트가 안 보임",
    });
    expect(prompt).toContain("- User context: 다크 모드에서 텍스트가 안 보임");
  });

  it("element 모드: multiline userPrompt는 둘째 줄부터 들여쓰기로 이어짐", () => {
    const prompt = buildAiDraftSessionPrompt({
      ...SESSION_ELEMENT_BASE,
      userPrompt: "다크 모드에서만 발생\n폼 검증 실패 시 재현",
    });
    expect(prompt).toContain("- User context: 다크 모드에서만 발생\n  폼 검증 실패 시 재현");
  });

  it("screenshot 모드: userPrompt 있어도 User context 줄 미포함", () => {
    const prompt = buildAiDraftSessionPrompt({
      ...SESSION_BASE,
      userPrompt: "이 화면에서 버튼이 잘림",
    });
    expect(prompt).not.toContain("- User context:");
  });

  it("video 모드: userPrompt 있어도 User context 줄 미포함", () => {
    const prompt = buildAiDraftSessionPrompt({
      ...SESSION_BASE,
      captureMode: "video",
      userPrompt: "녹화 중간에 에러 발생",
    });
    expect(prompt).not.toContain("- User context:");
  });

  it("freeform 모드: userPrompt 있어도 User context 줄 미포함", () => {
    const prompt = buildAiDraftSessionPrompt({
      ...SESSION_BASE,
      captureMode: "freeform",
      userPrompt: "환경 정보로 작성",
    });
    expect(prompt).not.toContain("- User context:");
  });

  it("element 모드: 로그 요약이 있어도 로그 줄 미포함", () => {
    const prompt = buildAiDraftSessionPrompt({
      ...SESSION_ELEMENT_BASE,
      networkLogSummary: {
        captured: 10,
        errors: [
          {
            method: "GET",
            path: "/api/x",
            status: 500,
            statusText: "Internal Server Error",
          },
        ],
      },
      consoleLogSummary: {
        captured: 5,
        errorCount: 2,
        warnCount: 1,
        topErrors: ["TypeError: x"],
      },
    });
    expect(prompt).not.toContain("Network errors");
    expect(prompt).not.toContain("Console:");
    expect(prompt).not.toContain("GET /api/x");
  });

  it("element 모드: 섹션 설명에 current/desired 힌트 포함", () => {
    const prompt = buildAiDraftSessionPrompt(SESSION_ELEMENT_BASE);
    expect(prompt).toMatch(/current value|current 값/);
    expect(prompt).toMatch(/desired value|desired 값/);
  });

  it("element 모드: enabledSections가 JSON 키 지시에 반영", () => {
    const prompt = buildAiDraftSessionPrompt({
      ...SESSION_ELEMENT_BASE,
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

  it("description 지시는 현상(as-is)만 + 기대 동작 배제 명시 (ko)", () => {
    const prompt = buildAiDraftSessionPrompt({
      ...SESSION_BASE,
      enabledSections: [{ id: "description" }],
    });
    const descLine = prompt
      .split("\n")
      .find((l) => l.includes('"description"'))!;
    expect(descLine).toMatch(/현상|현재/);
    expect(descLine).toMatch(/기대|해결|말 것|쓰지/);
  });

  it("description 지시는 현상(as-is)만 + 기대 동작 배제 명시 (en)", () => {
    const prompt = buildAiDraftSessionPrompt({
      ...SESSION_BASE,
      locale: "en",
      enabledSections: [{ id: "description" }],
    });
    const descLine = prompt
      .split("\n")
      .find((l) => l.includes('"description"'))!;
    expect(descLine).toMatch(/current|observed/i);
    expect(descLine).toMatch(/not.*(expected|fix|desired)/i);
  });

  it("Rules에 description/expectedResult 경계 규칙 포함", () => {
    const prompt = buildAiDraftSessionPrompt(SESSION_BASE);
    expect(prompt).toMatch(/description.*expectedResult|expectedResult.*description/);
  });

  it("Rules에 무관 컨텍스트 배제 지시 포함", () => {
    const prompt = buildAiDraftSessionPrompt(SESSION_BASE);
    expect(prompt).toMatch(/plausibly relate|unrelated/i);
  });

  it("Rules에 출력 언어 못박기 포함 (ko → Korean / en → English)", () => {
    const ko = buildAiDraftSessionPrompt(SESSION_BASE);
    expect(ko).toMatch(/all string values in Korean/i);
    const en = buildAiDraftSessionPrompt({ ...SESSION_BASE, locale: "en" });
    expect(en).toMatch(/all string values in English/i);
  });

  it("video 모드: action log를 재현 단계로 변환하라는 지시 (verbatim 복사 금지)", () => {
    const prompt = buildAiDraftSessionPrompt({
      ...SESSION_BASE,
      captureMode: "video",
      actionLogSummary: ["click Submit 버튼", "input email"],
    });
    expect(prompt).toMatch(/rephrase|reproduction steps/i);
    expect(prompt).toMatch(/verbatim/i);
  });

  it("element 모드: diffs 20개 초과 시 20개로 절삭", () => {
    const diffs = Array.from({ length: 25 }, (_, i) => ({
      prop: `prop-${i}`,
      asIs: "a",
      toBe: "b",
    }));
    const prompt = buildAiDraftSessionPrompt({
      ...SESSION_ELEMENT_BASE,
      selector: "div",
      tagName: "div",
      diffs,
    });
    expect(prompt).toContain("prop-19");
    expect(prompt).not.toContain("prop-20");
  });

  it("element 모드: tokens 10개 초과 시 10개로 절삭", () => {
    const tokens = Array.from({ length: 15 }, (_, i) => ({
      name: `--token-${i}`,
      value: `${i}px`,
    }));
    const prompt = buildAiDraftSessionPrompt({
      ...SESSION_ELEMENT_BASE,
      selector: "div",
      tagName: "div",
      tokens,
    });
    expect(prompt).toContain("--token-9");
    expect(prompt).not.toContain("--token-10");
  });
});
