import { describe, it, expect } from "vitest";
import {
  buildAiStylingSystemPrompt,
  buildAiStylingResponseSchema,
  parseAiStylingResponse,
  buildStyleContextBlock,
  type AiStylingContext,
} from "../buildAiStylingPrompt";
import { mergeAiEdits, replaceRawWithTokens } from "../aiStylingPostProcess";

const BASE_CTX: AiStylingContext = {
  tagName: "button",
  selector: "div.card > button",
  classList: ["btn", "btn-primary"],
  specifiedStyles: {
    "font-size": "14px",
    color: "#333",
    "border-radius": "4px",
  },
  tokens: [],
};

describe("buildAiStylingSystemPrompt", () => {
  it("요소 정보 포함", () => {
    const prompt = buildAiStylingSystemPrompt(BASE_CTX);
    expect(prompt).toContain("<button>");
    expect(prompt).toContain("div.card > button");
    expect(prompt).toContain("btn btn-primary");
  });

  it("specifiedStyles 포함", () => {
    const prompt = buildAiStylingSystemPrompt(BASE_CTX);
    expect(prompt).toContain("font-size: 14px");
    expect(prompt).toContain("color: #333");
    expect(prompt).toContain("border-radius: 4px");
  });

  it("specifiedStyles 최대 30개로 자름", () => {
    const styles: Record<string, string> = {};
    for (let i = 0; i < 35; i++) styles[`prop-${i}`] = `val-${i}`;
    const prompt = buildAiStylingSystemPrompt({
      ...BASE_CTX,
      specifiedStyles: styles,
    });
    expect(prompt).toContain("prop-29");
    expect(prompt).not.toContain("prop-30");
  });

  it("클래스 없으면 (none)", () => {
    const prompt = buildAiStylingSystemPrompt({
      ...BASE_CTX,
      classList: [],
    });
    expect(prompt).toContain("(none)");
  });

  it("specifiedStyles 비어있으면 Current styles 섹션 생략", () => {
    const prompt = buildAiStylingSystemPrompt({
      ...BASE_CTX,
      specifiedStyles: {},
    });
    expect(prompt).not.toContain("Current styles:");
  });

  it("토큰 포함 + family 우선 규칙", () => {
    const prompt = buildAiStylingSystemPrompt({
      ...BASE_CTX,
      tokens: [
        { name: "--color-primary", value: "#0066ff", category: "color" },
        { name: "--spacing-md", value: "16px", category: "length" },
      ],
    });
    expect(prompt).toContain("--color-primary: #0066ff");
    expect(prompt).toContain("--spacing-md: 16px");
    expect(prompt).toContain("same family");
  });

  it("토큰 비어있으면 Design tokens 섹션 생략", () => {
    const prompt = buildAiStylingSystemPrompt(BASE_CTX);
    expect(prompt).not.toContain("Design tokens");
  });

  it("금지 속성 목록 포함", () => {
    const prompt = buildAiStylingSystemPrompt(BASE_CTX);
    expect(prompt).toContain("content");
    expect(prompt).toContain("animation");
    expect(prompt).toContain("will-change");
  });

  it("-- 금지는 property key 한정, var(--token) 값 참조는 권장임을 명확히", () => {
    const prompt = buildAiStylingSystemPrompt(BASE_CTX);
    expect(prompt).toMatch(/property keys/i);
    expect(prompt).toMatch(/var\(--token\)/);
  });
});

describe("buildStyleContextBlock", () => {
  it("현재 스타일과 클래스를 블록으로 직렬화", () => {
    const block = buildStyleContextBlock({
      ...BASE_CTX,
      specifiedStyles: { "font-size": "14px", color: "#333" },
      classList: ["btn", "primary"],
    });
    expect(block).toContain("[Current state]");
    expect(block).toContain("font-size: 14px");
    expect(block).toContain("color: #333");
    expect(block).toContain("Classes: btn primary");
  });

  it("스타일 비어있으면 스타일 라인 생략", () => {
    const block = buildStyleContextBlock({
      ...BASE_CTX,
      specifiedStyles: {},
      classList: ["btn"],
    });
    expect(block).toContain("[Current state]");
    expect(block).not.toContain("font-size");
    expect(block).toContain("Classes: btn");
  });

  it("클래스 비어있으면 (none)", () => {
    const block = buildStyleContextBlock({
      ...BASE_CTX,
      specifiedStyles: { color: "red" },
      classList: [],
    });
    expect(block).toContain("Classes: (none)");
  });
});

describe("buildAiStylingResponseSchema", () => {
  it("explanation과 inlineStyle 필수, classList 선택", () => {
    const schema = buildAiStylingResponseSchema();
    expect(schema.required).toEqual(["explanation", "inlineStyle"]);
    expect(schema.properties).toHaveProperty("explanation");
    expect(schema.properties).toHaveProperty("inlineStyle");
    expect(schema.properties).toHaveProperty("classList");
    expect(schema.properties).not.toHaveProperty("text");
  });
});

describe("parseAiStylingResponse", () => {
  it("유효한 JSON 파싱", () => {
    const raw = JSON.stringify({
      explanation: "Changed color",
      inlineStyle: { color: "#0066ff" },
    });
    const result = parseAiStylingResponse(raw);
    expect(result).toEqual({
      explanation: "Changed color",
      edits: { inlineStyle: { color: "#0066ff" } },
    });
  });

  it("markdown fence 제거", () => {
    const raw = '```json\n{"explanation":"ok","inlineStyle":{"color":"red"}}\n```';
    const result = parseAiStylingResponse(raw);
    expect(result?.explanation).toBe("ok");
    expect(result?.edits.inlineStyle).toEqual({ color: "red" });
  });

  it("deny-list 속성 필터링 (animation-name, content 등)", () => {
    const raw = JSON.stringify({
      explanation: "Styled",
      inlineStyle: {
        color: "red",
        "animation-name": "spin",
        content: '"hello"',
        "will-change": "transform",
        "counter-increment": "section",
        "font-size": "16px",
      },
    });
    const result = parseAiStylingResponse(raw);
    expect(result?.edits.inlineStyle).toEqual({
      color: "red",
      "font-size": "16px",
    });
  });

  it("기존 allowlist에 없던 속성도 통과 (font-family, text-decoration 등)", () => {
    const raw = JSON.stringify({
      explanation: "Styled",
      inlineStyle: {
        "font-family": "Arial, sans-serif",
        "text-decoration": "underline",
        "grid-template-columns": "1fr 1fr",
        "flex-grow": "1",
        "border-width": "2px",
        "border-style": "solid",
        outline: "none",
        "word-break": "break-all",
        "box-sizing": "border-box",
        "list-style": "none",
        "align-self": "center",
        "text-transform": "uppercase",
      },
    });
    const result = parseAiStylingResponse(raw);
    expect(result?.edits.inlineStyle).toEqual({
      "font-family": "Arial, sans-serif",
      "text-decoration": "underline",
      "grid-template-columns": "1fr 1fr",
      "flex-grow": "1",
      "border-width": "2px",
      "border-style": "solid",
      outline: "none",
      "word-break": "break-all",
      "box-sizing": "border-box",
      "list-style": "none",
      "align-self": "center",
      "text-transform": "uppercase",
    });
  });

  it("커스텀 속성(--*) 필터링", () => {
    const raw = JSON.stringify({
      explanation: "Token set",
      inlineStyle: {
        color: "red",
        "--my-custom-color": "blue",
        "--spacing": "8px",
      },
    });
    const result = parseAiStylingResponse(raw);
    expect(result?.edits.inlineStyle).toEqual({ color: "red" });
  });

  it("animation shorthand도 필터링", () => {
    const raw = JSON.stringify({
      explanation: "Animated",
      inlineStyle: {
        animation: "spin 1s infinite",
        "animation-duration": "2s",
        "animation-delay": "0.5s",
        opacity: "0.5",
      },
    });
    const result = parseAiStylingResponse(raw);
    expect(result?.edits.inlineStyle).toEqual({ opacity: "0.5" });
  });

  it("열거 안 된 animation-*/counter-* 변형도 prefix로 필터링", () => {
    const raw = JSON.stringify({
      explanation: "Animated",
      inlineStyle: {
        "animation-composition": "add",
        "animation-range": "entry",
        "animation-timeline": "scroll()",
        "counter-set": "x 1",
        color: "red",
      },
    });
    const result = parseAiStylingResponse(raw);
    expect(result?.edits.inlineStyle).toEqual({ color: "red" });
  });

  it("z-index, transform 등 통과", () => {
    const raw = JSON.stringify({
      explanation: "Positioned",
      inlineStyle: {
        "z-index": "10",
        transform: "translateY(-4px)",
        cursor: "pointer",
        visibility: "hidden",
        top: "0",
      },
    });
    const result = parseAiStylingResponse(raw);
    expect(result?.edits.inlineStyle).toEqual({
      "z-index": "10",
      transform: "translateY(-4px)",
      cursor: "pointer",
      visibility: "hidden",
      top: "0",
    });
  });

  it("explanation 없으면 null", () => {
    const raw = JSON.stringify({ inlineStyle: { color: "red" } });
    expect(parseAiStylingResponse(raw)).toBeNull();
  });

  it("explanation 빈 문자열이면 null", () => {
    const raw = JSON.stringify({ explanation: "  ", inlineStyle: { color: "red" } });
    expect(parseAiStylingResponse(raw)).toBeNull();
  });

  it("잘못된 JSON이면 null", () => {
    expect(parseAiStylingResponse("not json")).toBeNull();
  });

  it("classList 파싱", () => {
    const raw = JSON.stringify({
      explanation: "Updated classes",
      classList: ["btn", "btn-lg", "active"],
    });
    const result = parseAiStylingResponse(raw);
    expect(result?.edits.classList).toEqual(["btn", "btn-lg", "active"]);
  });

  it("classList에서 빈 문자열 필터링", () => {
    const raw = JSON.stringify({
      explanation: "ok",
      classList: ["btn", "", "  ", "active"],
    });
    const result = parseAiStylingResponse(raw);
    expect(result?.edits.classList).toEqual(["btn", "active"]);
  });

  it("text 필드 무시", () => {
    const raw = JSON.stringify({
      explanation: "Changed text",
      text: "Hallucinated text",
    });
    const result = parseAiStylingResponse(raw);
    expect(result?.edits).toEqual({});
  });

  it("inlineStyle 값이 문자열이 아니면 무시", () => {
    const raw = JSON.stringify({
      explanation: "ok",
      inlineStyle: { color: "red", "font-size": 16, opacity: null },
    });
    const result = parseAiStylingResponse(raw);
    expect(result?.edits.inlineStyle).toEqual({ color: "red" });
  });

  it("inlineStyle 값이 빈 문자열이면 무시", () => {
    const raw = JSON.stringify({
      explanation: "ok",
      inlineStyle: { color: "red", "font-size": "" },
    });
    const result = parseAiStylingResponse(raw);
    expect(result?.edits.inlineStyle).toEqual({ color: "red" });
  });

  it("변경 없이 explanation만 있으면 빈 edits", () => {
    const raw = JSON.stringify({ explanation: "No changes needed" });
    const result = parseAiStylingResponse(raw);
    expect(result?.explanation).toBe("No changes needed");
    expect(result?.edits).toEqual({});
  });

  it("camelCase 속성을 kebab-case로 변환", () => {
    const raw = JSON.stringify({
      explanation: "배경색 변경",
      inlineStyle: {
        backgroundColor: "red",
        fontSize: "16px",
        borderTopLeftRadius: "8px",
      },
    });
    const result = parseAiStylingResponse(raw);
    expect(result?.edits.inlineStyle).toEqual({
      "background-color": "red",
      "font-size": "16px",
      "border-top-left-radius": "8px",
    });
  });

  it("camelCase deny-list 속성은 변환 후에도 필터링", () => {
    const raw = JSON.stringify({
      explanation: "ok",
      inlineStyle: { animationName: "spin", color: "blue" },
    });
    const result = parseAiStylingResponse(raw);
    expect(result?.edits.inlineStyle).toEqual({ color: "blue" });
  });

  it("실제 모델 응답: camelCase 변환 + 할루시네이션 텍스트 무시", () => {
    const raw = JSON.stringify({
      explanation: "배경색을 빨간색으로 변경",
      inlineStyle: { backgroundColor: "red" },
      classList: ["informative-alert"],
      text: "This text will appear within the red background",
    });
    const result = parseAiStylingResponse(raw);
    expect(result?.edits.inlineStyle).toEqual({ "background-color": "red" });
    expect(result?.edits.classList).toEqual(["informative-alert"]);
    expect(result?.edits).not.toHaveProperty("text");
  });

  it("kebab-case와 camelCase 혼용 시 모두 처리", () => {
    const raw = JSON.stringify({
      explanation: "Mixed case",
      inlineStyle: {
        color: "red",
        "font-size": "14px",
        backgroundColor: "blue",
        borderRadius: "4px",
      },
    });
    const result = parseAiStylingResponse(raw);
    expect(result?.edits.inlineStyle).toEqual({
      color: "red",
      "font-size": "14px",
      "background-color": "blue",
      "border-radius": "4px",
    });
  });

  it("shorthand 속성도 그대로 통과", () => {
    const raw = JSON.stringify({
      explanation: "Rounded corners",
      inlineStyle: { "border-radius": "12px" },
    });
    const result = parseAiStylingResponse(raw);
    expect(result?.edits.inlineStyle).toEqual({
      "border-radius": "12px",
    });
  });
});

describe("mergeAiEdits", () => {
  const base = {
    classList: ["btn", "primary"],
    inlineStyle: { color: "red", "font-size": "14px" },
    text: "Hello",
  };

  it("inlineStyle 병합 (기존 유지 + 추가)", () => {
    const result = mergeAiEdits(base, {
      inlineStyle: { "font-size": "18px", "font-weight": "bold" },
    });
    expect(result.inlineStyle).toEqual({
      color: "red",
      "font-size": "18px",
      "font-weight": "bold",
    });
  });

  it("classList 교체 (전체)", () => {
    const result = mergeAiEdits(base, {
      classList: ["btn", "btn-lg"],
    });
    expect(result.classList).toEqual(["btn", "btn-lg"]);
  });

  it("text는 항상 기존값 유지", () => {
    const result = mergeAiEdits(base, {});
    expect(result.text).toBe("Hello");
  });

  it("변경 없으면 기존 유지", () => {
    const result = mergeAiEdits(base, {});
    expect(result).toEqual(base);
  });

  it("모든 필드 동시 변경 (text는 기존 유지)", () => {
    const result = mergeAiEdits(base, {
      inlineStyle: { opacity: "0.5" },
      classList: ["new-class"],
    });
    expect(result).toEqual({
      inlineStyle: { color: "red", "font-size": "14px", opacity: "0.5" },
      classList: ["new-class"],
      text: "Hello",
    });
  });
});

describe("replaceRawWithTokens", () => {
  const tokens = [
    { name: "--font-size-sm", value: "12px", category: "length" as const },
    { name: "--font-size-md", value: "16px", category: "length" as const },
    { name: "--font-size-lg", value: "20px", category: "length" as const },
    { name: "--color-primary", value: "#0066ff", category: "color" as const },
    { name: "--color-danger", value: "#ff0000", category: "color" as const },
    { name: "--color-warning", value: "#ff8800", category: "color" as const },
    { name: "--color-purple", value: "#7d3be4", category: "color" as const },
    { name: "--color-gray", value: "#5f656d", category: "color" as const },
    { name: "--spacing-sm", value: "8px", category: "length" as const },
    { name: "--spacing-md", value: "16px", category: "length" as const },
  ];

  it("raw 값을 매칭 토큰으로 치환", () => {
    const result = replaceRawWithTokens(
      { color: "#0066ff" },
      tokens,
      {},
    );
    expect(result).toEqual({ color: "var(--color-primary)" });
  });

  it("이미 var() 참조면 그대로 유지", () => {
    const result = replaceRawWithTokens(
      { color: "var(--color-primary)" },
      tokens,
      {},
    );
    expect(result).toEqual({ color: "var(--color-primary)" });
  });

  it("매칭 토큰 없으면 원래 값 유지", () => {
    const result = replaceRawWithTokens(
      { color: "#999" },
      tokens,
      {},
    );
    expect(result).toEqual({ color: "#999" });
  });

  it("같은 family 토큰 우선", () => {
    const result = replaceRawWithTokens(
      { "font-size": "16px" },
      tokens,
      { "line-height": "var(--font-size-sm)" },
    );
    expect(result).toEqual({ "font-size": "var(--font-size-md)" });
  });

  it("family 매치 없으면 전체 토큰에서 매칭", () => {
    const result = replaceRawWithTokens(
      { "font-size": "16px" },
      tokens,
      {},
    );
    expect(result).toEqual({ "font-size": "var(--font-size-md)" });
  });

  it("family 우선: --spacing보다 --font-size family 매치", () => {
    const result = replaceRawWithTokens(
      { "font-size": "16px" },
      tokens,
      { padding: "var(--font-size-lg)" },
    );
    expect(result).toEqual({ "font-size": "var(--font-size-md)" });
  });

  it("color fuzzy: family 내 인접 hex 토큰 치환", () => {
    const result = replaceRawWithTokens(
      { color: "#0060f0" },
      tokens,
      { "border-color": "var(--color-danger)" },
    );
    expect(result).toEqual({ color: "var(--color-primary)" });
  });

  it("color fuzzy: hue가 완전히 다르면 raw 유지", () => {
    const result = replaceRawWithTokens(
      { color: "#00ff00" },
      tokens,
      { "border-color": "var(--color-danger)" },
    );
    expect(result).toEqual({ color: "#00ff00" });
  });

  it("color fuzzy: named color → 가장 가까운 family 토큰", () => {
    const result = replaceRawWithTokens(
      { color: "red" },
      tokens,
      { "border-color": "var(--color-primary)" },
    );
    expect(result).toEqual({ color: "var(--color-danger)" });
  });

  it("color fuzzy: rgb() → 가장 가까운 family 토큰", () => {
    const result = replaceRawWithTokens(
      { color: "rgb(255, 0, 10)" },
      tokens,
      { "border-color": "var(--color-primary)" },
    );
    expect(result).toEqual({ color: "var(--color-danger)" });
  });

  it("color fuzzy: 여러 후보 중 hue 기준 가장 가까운 토큰 선택", () => {
    const result = replaceRawWithTokens(
      { color: "#ff2200" },
      tokens,
      { "border-color": "var(--color-warning)" },
    );
    expect(result).toEqual({ color: "var(--color-danger)" });
  });

  it("color fuzzy: purple vs gray — hue 기준으로 보라색 토큰 선택", () => {
    const result = replaceRawWithTokens(
      { "background-color": "purple" },
      tokens,
      { color: "var(--color-primary)" },
    );
    expect(result).toEqual({ "background-color": "var(--color-purple)" });
  });

  it("color fuzzy: family 없으면 fuzzy 안 함 (exact만)", () => {
    const result = replaceRawWithTokens(
      { color: "#0060f0" },
      tokens,
      {},
    );
    expect(result).toEqual({ color: "#0060f0" });
  });

  it("length는 fuzzy 안 함: family 내에서도 exact만", () => {
    const result = replaceRawWithTokens(
      { "font-size": "15px" },
      tokens,
      { "line-height": "var(--font-size-sm)" },
    );
    expect(result).toEqual({ "font-size": "15px" });
  });

  it("color fuzzy: 3자리 hex도 파싱", () => {
    const result = replaceRawWithTokens(
      { color: "#f00" },
      tokens,
      { "border-color": "var(--color-primary)" },
    );
    expect(result).toEqual({ color: "var(--color-danger)" });
  });
});
