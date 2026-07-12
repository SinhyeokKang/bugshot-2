import type { AiStylingContext } from "../buildAiStylingPrompt";
import { PROMPT_CAPS } from "./caps";
import {
  extractLayoutContext,
  extractVarRefs,
  oneLine,
  selectRelevantTokens,
  selectStyles,
} from "./context";

export function buildRichStylingPrompt(ctx: AiStylingContext): string {
  const caps = PROMPT_CAPS.rich;
  const lines: string[] = [];

  lines.push(
    "You are a CSS expert editing a live web page. Achieve the user's intent with the smallest change that works.",
    'Respond in JSON: { "explanation": "...", "inlineStyle": {...} }',
    "",
    `Element: <${ctx.tagName}> at ${ctx.selector}`,
    `Current classes: ${ctx.classList.join(" ") || "(none)"}`,
  );

  const styles = selectStyles(
    ctx.specifiedStyles,
    ctx.editedProps ?? [],
    caps.styles,
  );
  const specEntries = Object.entries(styles);
  if (specEntries.length > 0) {
    lines.push("", "Current styles:");
    for (const [prop, val] of specEntries) {
      lines.push(`  ${prop}: ${val}`);
    }
  }

  // 레이아웃 컨텍스트가 없으면 "가운데 정렬해줘" 같은 요청은 원리적으로 못 푼다 —
  // margin:auto가 맞는지 justify-content가 맞는지 판단할 근거가 생긴다.
  if (ctx.computedStyles) {
    const layout = extractLayoutContext(ctx.computedStyles);
    const layoutEntries = Object.entries(layout);
    if (layoutEntries.length > 0) {
      lines.push("", "Computed layout:");
      for (const [prop, val] of layoutEntries) {
        lines.push(`  ${prop}: ${val}`);
      }
    }
  }
  if (ctx.viewport) {
    lines.push(`Viewport: ${ctx.viewport.width}x${ctx.viewport.height}`);
  }

  const tokenEntries = selectRelevantTokens(
    ctx.tokens,
    extractVarRefs(ctx.specifiedStyles),
    caps.designTokens,
  );
  if (tokenEntries.length > 0) {
    lines.push("", "Design tokens (use var() references, prefer tokens from the same family as those already in use):");
    for (const t of tokenEntries) {
      lines.push(`  ${t.name}: ${t.value}`);
    }
  }

  lines.push(
    "",
    "Rules:",
    "- explanation: one or two sentences on what you changed. State any assumption you relied on and the side effect it carries if that assumption is wrong (Korean if user writes Korean)",
    "- inlineStyle: CSS property-value pairs in kebab-case",
    "- Prefer design tokens over raw values. When a matching token exists, use var(--token-name). Prioritize tokens from the same family already used on this element",
    "- classList: optional, the COMPLETE class list. Keep all existing classes, only add/remove what the user asked for",
    "- Do NOT use these as property keys (they will be ignored): content, animation, animation-*, will-change, counter-*, or any name starting with -- (referencing a token via var(--token) in a value is encouraged)",
    "- Do NOT include any other fields",
    "- Output only valid JSON, no markdown fences",
  );

  return lines.map(oneLine).join("\n");
}
