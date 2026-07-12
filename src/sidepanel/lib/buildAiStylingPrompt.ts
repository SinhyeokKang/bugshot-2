import type { Token } from "@/types/picker";
import type {
  FewShotExample,
  PromptStyle,
  ProviderCapabilities,
} from "./ai-provider";
import { extractJson } from "./extractJson";
import { PROMPT_CAPS } from "./prompts/caps";
import { selectStyles } from "./prompts/context";
import {
  buildCompactStylingPrompt,
  COMPACT_STYLING_FEW_SHOT,
} from "./prompts/stylingCompact";
import { buildRichStylingPrompt } from "./prompts/stylingRich";

export interface AiStylingEdits {
  inlineStyle?: Record<string, string>;
  classList?: string[];
}

export interface AiStylingContext {
  caps: ProviderCapabilities;
  tagName: string;
  selector: string;
  classList: string[];
  specifiedStyles: Record<string, string>;
  tokens: Token[];
  editedProps?: string[];
  computedStyles?: Record<string, string>;
  viewport?: { width: number; height: number };
}

const DENIED_STYLE_PROPS = new Set(["content", "animation", "will-change"]);

// animation-*/counter-*는 prefix로 차단 — 열거하면 animation-composition·-range·-timeline
// 같은 신규 longhand가 빠진다. -- prop은 토큰 정의 변조라 별도 차단.
export function isDeniedStyleProp(prop: string): boolean {
  if (prop.startsWith("--")) return true;
  if (DENIED_STYLE_PROPS.has(prop)) return true;
  return prop.startsWith("animation-") || prop.startsWith("counter-");
}

// 프롬프트 컨텍스트(디자인 토큰·computed 값)는 페이지가 통제하는 문자열이라 인젝션
// 표면이다. 키 필터만으론 값으로 나가는 외부 요청을 못 막는다 — 응답이 라이브 페이지에
// 그대로 적용되므로 원격 origin을 가리키는 값은 드롭한다.
//
// url() 형태로 좁히지 않는다: image-set("https://…")은 url() 없이도 요청을 낸다.
// CSS 이스케이프(`\75 rl(`, `\2f\2f`)는 토크나이저만 통과하는 우회 수단이라 백슬래시가
// 보이면 그대로 거절한다 — AI가 쓰는 스타일 값에 이스케이프가 필요한 경우는 없다.
// data: URI는 요청이 안 나가므로 검사 전에 들어낸다: SVG data URI는
// xmlns="http://www.w3.org/2000/svg"를 늘 포함해, 안 들어내면 정당한 값이 통째로 드롭된다.
export function isDeniedStyleValue(value: string): boolean {
  if (value.includes("\\")) return true;
  const withoutDataUris = value
    .replace(/\burl\(\s*(['"]?)\s*data:[\s\S]*?\1\s*\)/gi, "")
    .replace(/(['"])\s*data:[\s\S]*?\1/g, "");
  return /https?:|\/\//i.test(withoutDataUris);
}

const STYLING_BUILDERS: Record<
  PromptStyle,
  (ctx: AiStylingContext) => string
> = {
  compact: buildCompactStylingPrompt,
  rich: buildRichStylingPrompt,
};

// compact 본문은 거절방지를 few-shot으로 대체한다. rich는 필요 없다.
const STYLING_FEW_SHOT: Record<PromptStyle, FewShotExample[] | undefined> = {
  compact: COMPACT_STYLING_FEW_SHOT,
  rich: undefined,
};

export function buildAiStylingSystemPrompt(ctx: AiStylingContext): string {
  return STYLING_BUILDERS[ctx.caps.promptStyle](ctx);
}

export function getStylingFewShot(
  ctx: AiStylingContext,
): FewShotExample[] | undefined {
  return STYLING_FEW_SHOT[ctx.caps.promptStyle];
}

// 시스템 프롬프트에 실제로 실린 스타일 맵 — 멀티턴 delta의 기준선.
export function stylesSentInPrompt(
  ctx: AiStylingContext,
): Record<string, string> {
  return selectStyles(
    ctx.specifiedStyles,
    ctx.editedProps ?? [],
    PROMPT_CAPS[ctx.caps.promptStyle].styles,
  );
}

export function buildAiStylingResponseSchema() {
  return {
    type: "object",
    required: ["explanation", "inlineStyle"],
    properties: {
      explanation: { type: "string" },
      inlineStyle: { type: "object" },
      classList: { type: "array", items: { type: "string" } },
    },
  };
}

export function parseAiStylingResponse(raw: string): {
  explanation: string;
  edits: AiStylingEdits;
} | null {
  const json = extractJson(raw);
  if (!json) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (typeof parsed.explanation !== "string" || !parsed.explanation.trim())
    return null;

  const edits: AiStylingEdits = {};

  if (parsed.inlineStyle && typeof parsed.inlineStyle === "object") {
    const filtered: Record<string, string> = {};
    for (const [rawProp, val] of Object.entries(
      parsed.inlineStyle as Record<string, unknown>,
    )) {
      if (typeof val !== "string" || !val) continue;
      const prop = toKebab(rawProp);
      if (!isDeniedStyleProp(prop) && !isDeniedStyleValue(val)) {
        filtered[prop] = val;
      }
    }
    if (Object.keys(filtered).length > 0) edits.inlineStyle = filtered;
  }

  if (Array.isArray(parsed.classList)) {
    const classList = parsed.classList.filter(
      (c): c is string => typeof c === "string" && c.trim() !== "",
    );
    if (classList.length > 0) edits.classList = classList;
  }

  return { explanation: parsed.explanation, edits };
}

function toKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}
