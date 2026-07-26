import { describe, it, expect } from "vitest";
import { buildCompactStylingPrompt, COMPACT_STYLING_FEW_SHOT } from "../stylingCompact";
import { buildRichStylingPrompt } from "../stylingRich";
import { BYOK_CAPABILITIES, NANO_CAPABILITIES } from "../../ai-provider";
import type { AiStylingContext } from "../../buildAiStylingPrompt";

function ctx(overrides: Partial<AiStylingContext> = {}): AiStylingContext {
  return {
    caps: BYOK_CAPABILITIES,
    tagName: "button",
    selector: "#checkout > button.primary",
    classList: ["primary", "lg"],
    specifiedStyles: {
      "background-color": "var(--brand-500)",
      color: "#fff",
      padding: "8px 16px",
    },
    tokens: [
      { name: "--brand-500", value: "#2563eb" },
      { name: "--unused", value: "#000" },
    ] as AiStylingContext["tokens"],
    editedProps: [],
    computedStyles: { display: "inline-flex" },
    viewport: { width: 1280, height: 720 },
    ...overrides,
  };
}

describe("buildCompactStylingPrompt", () => {
  it("요소 식별자·클래스·현재 스타일을 싣는다", () => {
    const p = buildCompactStylingPrompt(ctx());
    expect(p).toContain("<button>");
    expect(p).toContain("#checkout > button.primary");
    expect(p).toContain("primary lg");
    expect(p).toContain("background-color");
  });

  it("클래스가 없으면 (none)으로 표기한다 (빈 줄 대신)", () => {
    expect(buildCompactStylingPrompt(ctx({ classList: [] }))).toContain("(none)");
  });

  // compact는 responseConstraint가 구조를 강제하므로 본문에 JSON 규칙을 넣지 않는다.
  it("JSON 형식 지시문을 본문에 넣지 않는다 (compact 불변식)", () => {
    const p = buildCompactStylingPrompt(ctx({ caps: NANO_CAPABILITIES }));
    expect(p).not.toContain("Respond in JSON");
  });

  // selectRelevantTokens는 참조 → 같은 family → 나머지 순으로 채운다(cap까지 filler 허용).
  // 고정할 불변식은 "참조 토큰이 먼저 온다"이지 "미참조가 빠진다"가 아니다.
  it("값에서 참조된 토큰을 먼저 싣는다", () => {
    const p = buildCompactStylingPrompt(ctx());
    expect(p).toContain("--brand-500");
    expect(p.indexOf("--brand-500")).toBeLessThan(p.indexOf("--unused"));
  });

  it("few-shot 예시는 토큰명이 아니라 raw 색을 쓴다 (없는 토큰 모방 방지)", () => {
    const assistant = COMPACT_STYLING_FEW_SHOT[0].assistant;
    expect(assistant).toContain("#2563eb");
    expect(assistant).not.toContain("var(--");
  });
});

describe("buildRichStylingPrompt", () => {
  it("JSON 응답 형식을 본문에 명시한다 (compact와 반대)", () => {
    const p = buildRichStylingPrompt(ctx());
    expect(p).toContain("Respond in JSON");
    expect(p).toContain('"inlineStyle"');
  });

  it("요소 식별자·현재 클래스를 싣는다", () => {
    const p = buildRichStylingPrompt(ctx());
    expect(p).toContain("<button>");
    expect(p).toContain("#checkout > button.primary");
    expect(p).toContain("primary lg");
  });

  it("값에서 참조된 토큰을 먼저 싣는다", () => {
    const p = buildRichStylingPrompt(ctx());
    expect(p).toContain("--brand-500");
    expect(p.indexOf("--brand-500")).toBeLessThan(p.indexOf("--unused"));
  });

  it("두 스타일은 같은 컨텍스트에서 서로 다른 본문을 낸다 (분기 실효)", () => {
    expect(buildRichStylingPrompt(ctx())).not.toBe(buildCompactStylingPrompt(ctx()));
  });
});
