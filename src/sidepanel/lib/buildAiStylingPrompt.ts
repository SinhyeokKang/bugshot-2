export interface AiStylingEdits {
  inlineStyle?: Record<string, string>;
  classList?: string[];
}

import type { Token } from "@/types/picker";

export interface AiStylingContext {
  tagName: string;
  selector: string;
  classList: string[];
  specifiedStyles: Record<string, string>;
  tokens: Token[];
}

const MAX_STYLES = 30;
const MAX_TOKENS = 20;

const ALLOWED_STYLE_PROPS = new Set([
  "display",
  "position",
  "flex-direction",
  "flex-wrap",
  "justify-content",
  "align-items",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "gap",
  "row-gap",
  "column-gap",
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "overflow",
  "overflow-x",
  "overflow-y",
  "white-space",
  "text-overflow",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "color",
  "background-color",
  "background-image",
  "opacity",
  "border",
  "border-color",
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "box-shadow",
  "filter",
  "backdrop-filter",
  "mix-blend-mode",
  "transform",
  "top",
  "right",
  "bottom",
  "left",
  "z-index",
  "cursor",
  "pointer-events",
  "visibility",
  "transition-property",
  "transition-duration",
  "transition-timing-function",
  "transition-delay",
]);

export function buildAiStylingSystemPrompt(ctx: AiStylingContext): string {
  const lines: string[] = [];

  lines.push(
    "You are a CSS styling tool. You DIRECTLY modify CSS styles on a live web page.",
    "The user describes a visual change. You respond with the exact CSS to apply.",
    "You CAN and MUST change CSS. That is your only job.",
    'Respond in JSON: { "explanation": "...", "inlineStyle": {...} }',
    "",
    `Element: <${ctx.tagName}> at ${ctx.selector}`,
    `Current classes: ${ctx.classList.join(" ") || "(none)"}`,
  );

  const specEntries = Object.entries(ctx.specifiedStyles).slice(0, MAX_STYLES);
  if (specEntries.length > 0) {
    lines.push("", "Current styles:");
    for (const [prop, val] of specEntries) {
      lines.push(`  ${prop}: ${val}`);
    }
  }

  const tokenEntries = ctx.tokens.slice(0, MAX_TOKENS);
  if (tokenEntries.length > 0) {
    lines.push("", "Design tokens (use var() references, prefer tokens from the same family as those already in use):");
    for (const t of tokenEntries) {
      lines.push(`  ${t.name}: ${t.value}`);
    }
  }

  lines.push(
    "",
    "Rules:",
    "- explanation: one sentence describing what CSS you changed (Korean if user writes Korean)",
    "- inlineStyle: CSS property-value pairs in kebab-case",
    "- Prefer design tokens over raw values. When a matching token exists, use var(--token-name). Prioritize tokens from the same family already used on this element",
    "- classList: optional, the COMPLETE class list. Keep all existing classes, only add/remove what the user asked for",
    "- Do NOT include any other fields",
    "- Output only valid JSON, no markdown fences",
  );

  return lines.join("\n");
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
      if (ALLOWED_STYLE_PROPS.has(prop)) {
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

function extractJson(raw: string): string | null {
  const stripped = raw
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return stripped.slice(start, end + 1);
}
