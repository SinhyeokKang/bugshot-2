import type { Token } from "@/types/picker";
import type { FewShotExample, ProviderCapabilities } from "./ai-provider";
import { extractJson } from "./extractJson";
import { PROMPT_CAPS } from "./prompts/caps";
import { selectStyles } from "./prompts/context";
import {
  buildCompactStylingPrompt,
  COMPACT_STYLING_FEW_SHOT,
} from "./prompts/styling.compact";
import { buildRichStylingPrompt } from "./prompts/styling.rich";

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

export function buildAiStylingSystemPrompt(ctx: AiStylingContext): string {
  return ctx.caps.promptStyle === "compact"
    ? buildCompactStylingPrompt(ctx)
    : buildRichStylingPrompt(ctx);
}

// compact 본문은 거절방지를 few-shot으로 대체한다. rich는 필요 없다.
export function getStylingFewShot(
  ctx: AiStylingContext,
): FewShotExample[] | undefined {
  return ctx.caps.promptStyle === "compact"
    ? COMPACT_STYLING_FEW_SHOT
    : undefined;
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
      if (!isDeniedStyleProp(prop)) {
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
