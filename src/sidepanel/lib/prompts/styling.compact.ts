import type { FewShotExample } from "../ai-provider";
import type { AiStylingContext } from "../buildAiStylingPrompt";
import { PROMPT_CAPS } from "./caps";
import {
  extractVarRefs,
  selectRelevantTokens,
  selectStyles,
} from "./context";

// 소형 모델의 "저는 웹페이지를 수정할 수 없습니다" 거절은 명령문("You CAN and MUST
// change CSS")보다 예시 1개로 훨씬 강하게 잡힌다. 예시가 systemPrompt 문자열 밖에
// 있어야 본문의 "JSON 규칙 없음" 불변식과 충돌하지 않는다.
//
// 예시 값은 raw 색이다 — var(--brand-500) 같은 토큰명을 쓰면 소형 모델이 그 이름을
// 그대로 모방해, 대상 페이지에 없는 토큰을 참조하는 CSS를 낸다.
export const COMPACT_STYLING_FEW_SHOT: FewShotExample[] = [
  {
    user: "make the background blue",
    assistant:
      '{"explanation":"Set the background to blue.","inlineStyle":{"background-color":"#2563eb"}}',
  },
];

export function buildCompactStylingPrompt(ctx: AiStylingContext): string {
  const caps = PROMPT_CAPS.compact;
  const lines: string[] = [];

  lines.push("Modify CSS on this element.");
  lines.push(`Element: <${ctx.tagName}> at ${ctx.selector}`);
  lines.push(`Classes: ${ctx.classList.join(" ") || "(none)"}`);

  const styles = selectStyles(
    ctx.specifiedStyles,
    ctx.editedProps ?? [],
    caps.styles,
  );
  const specEntries = Object.entries(styles);
  if (specEntries.length > 0) {
    lines.push("Current styles:");
    for (const [prop, val] of specEntries) {
      lines.push(`  ${prop}: ${val}`);
    }
  }

  const tokenEntries = selectRelevantTokens(
    ctx.tokens,
    extractVarRefs(ctx.specifiedStyles),
    caps.designTokens,
  );
  if (tokenEntries.length > 0) {
    lines.push("Design tokens:");
    for (const t of tokenEntries) {
      lines.push(`  ${t.name}: ${t.value}`);
    }
  }

  lines.push("");
  lines.push("Use var(--token) when a token matches the value you want.");
  lines.push("explanation: one sentence on what you changed (Korean if the user writes Korean).");
  lines.push("inlineStyle: CSS properties in kebab-case.");

  return lines.join("\n");
}
