import type { AISession } from "../ai-provider";
import type { AiDraftSessionContext } from "../buildAiDraftPrompt";
import { stripPreservedContent } from "../markdownBlocks";
import { PROMPT_CAPS } from "./caps";
import { selectDraftSections } from "./context";

export type TrimLevel = 0 | 1 | 2 | 3;

const MAX_TRIM_LEVEL = 3;

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
    delete out.requests; // 매칭 후보도 로그와 한 덩어리로 소멸(selectLogCandidates 재실행이 빈 매칭 반환)
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

// 기존 초안 중 실제로 프롬프트에 실린 것 — 병합 시 사용자 원문 보호 판정의 근거.
// 빌더와 같은 selectDraftSections를 쓴다(단일 출처 이유는 그 함수 주석 참조).
function selectionOf(ctx: AiDraftSessionContext) {
  return selectDraftSections(
    ctx.existingDraft,
    ctx.enabledSections.map((s) => s.id),
    PROMPT_CAPS[ctx.caps.promptStyle].existingDraftChars,
  );
}

// 기존 초안 중 내용이 있는(=프롬프트에 실릴 자격이 있는) 활성 섹션.
// includedSections와의 차집합이 "AI가 못 본 채 원문만 남는" 섹션이다.
function contentfulSectionsOf(ctx: AiDraftSessionContext): string[] {
  const draft = ctx.existingDraft;
  if (!draft) return [];
  return ctx.enabledSections
    .map((s) => s.id)
    .filter((id) => stripPreservedContent(draft.sections[id] ?? ""));
}

export interface FittedDraftContext {
  ctx: AiDraftSessionContext;
  prompt: string;
  level: TrimLevel;
  includedSections: string[];
  // 예산 때문에 프롬프트에서 빠진 기존 초안 섹션 — 병합이 원문을 보존하므로 AI가 손대지
  // 않는다. 고지 없이 넘어가면 "AI 초안을 눌렀는데 아무것도 안 바뀐" 침묵이 된다.
  omittedSections: string[];
  // 기존 제목이 프롬프트에 실렸는가. 안 실렸으면 모델은 그 제목을 본 적 없이 새로
  // 지어낸다 — 섹션과 같은 손실 경로라 호출부가 원문 제목을 지켜야 한다.
  titleIncluded: boolean;
}

export function fitDraftContext(
  ctx: AiDraftSessionContext,
  build: (c: AiDraftSessionContext) => string,
  budgetChars: number,
): FittedDraftContext {
  const contentful = contentfulSectionsOf(ctx);
  const settle = (last: {
    ctx: AiDraftSessionContext;
    prompt: string;
    level: TrimLevel;
  }): FittedDraftContext => {
    const { includedIds, titleIncluded } = selectionOf(last.ctx);
    return {
      ...last,
      includedSections: includedIds,
      omittedSections: contentful.filter((id) => !includedIds.includes(id)),
      titleIncluded,
    };
  };

  let last = { ctx, prompt: build(ctx), level: 0 as TrimLevel };
  if (last.prompt.length <= budgetChars) return settle(last);

  for (let level = 1; level <= MAX_TRIM_LEVEL; level++) {
    const trimmed = trimDraftContext(ctx, level as TrimLevel);
    last = { ctx: trimmed, prompt: build(trimmed), level: level as TrimLevel };
    if (last.prompt.length <= budgetChars) break;
  }

  // 최종 level에서도 초과면 그대로 반환한다 — 실측 게이트와 런타임 예외 매핑이 판정한다.
  return settle(last);
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
