import type { AISession } from "./ai-provider";
import type { AiDraftSessionContext } from "./buildAiDraftPrompt";
import { PROMPT_CAPS } from "./prompts/caps";
import { selectDraftSections } from "./prompts/context";
import { stripInlineImageRefs } from "./resolveInlineImages";

export type TrimLevel = 0 | 1 | 2 | 3;

const TRIM_LEVELS: TrimLevel[] = [0, 1, 2, 3];

// 손실이 작은 것부터 버린다: 로그 → 기존 초안 → 스타일 diff·토큰.
export function trimDraftContext(
  ctx: AiDraftSessionContext,
  level: TrimLevel,
): AiDraftSessionContext {
  const out: AiDraftSessionContext = { ...ctx };

  if (level >= 1) {
    delete out.networkLogSummary;
    delete out.consoleLogSummary;
    delete out.actionLogSummary;
  }
  if (level >= 2) {
    delete out.existingDraft;
  }
  if (level >= 3) {
    delete out.diffs;
    delete out.tokens;
  }

  return out;
}

// 기존 초안 중 실제로 프롬프트에 실린 섹션 id — 병합 시 "빈 문자열 = 비우기" 판정 근거.
// 빌더와 같은 selectDraftSections를 쓴다. 각자 추정하면 어긋나고, 그 틈에서
// "AI가 못 본 섹션의 빈 응답"이 비우기로 오인돼 사용자 텍스트가 삭제된다.
function includedSectionsOf(ctx: AiDraftSessionContext): string[] {
  return selectDraftSections(
    ctx.existingDraft,
    ctx.enabledSections.map((s) => s.id),
    PROMPT_CAPS[ctx.caps.promptStyle].existingDraftChars,
    stripInlineImageRefs,
  ).includedIds;
}

export function fitDraftContext(
  ctx: AiDraftSessionContext,
  build: (c: AiDraftSessionContext) => string,
  budgetChars: number,
): {
  ctx: AiDraftSessionContext;
  prompt: string;
  level: TrimLevel;
  includedSections: string[];
} {
  let last = { ctx, prompt: build(ctx), level: 0 as TrimLevel };
  if (last.prompt.length <= budgetChars) {
    return { ...last, includedSections: includedSectionsOf(last.ctx) };
  }

  for (const level of TRIM_LEVELS.slice(1)) {
    const trimmed = trimDraftContext(ctx, level);
    last = { ctx: trimmed, prompt: build(trimmed), level };
    if (last.prompt.length <= budgetChars) break;
  }

  // 최종 level에서도 초과면 그대로 반환한다 — 실측 게이트와 런타임 예외 매핑이 판정한다.
  return { ...last, includedSections: includedSectionsOf(last.ctx) };
}

// user turn 직전 실측. 세션 생성 직후 usage는 system prompt만 반영하므로
// 실제 초과가 터지는 지점은 여기다. API 미지원(구버전 Chrome·BYOK)이면 통과.
export async function isPromptOverBudget(
  session: AISession,
  input: string,
  responseSchema?: Record<string, unknown>,
): Promise<boolean> {
  const window = session.contextWindow;
  if (!session.measureContextUsage || window === undefined) return false;

  try {
    const needed = await session.measureContextUsage(
      input,
      responseSchema ? { responseSchema } : undefined,
    );
    return (session.contextUsage ?? 0) + needed > window;
  } catch {
    return false;
  }
}
