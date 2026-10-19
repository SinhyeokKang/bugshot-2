import type { CaptureMode } from "@/store/editor-store";
import type { LocaleMode } from "@/store/settings-ui-store";
import type { ActionLogSummary } from "@/types/action";
import {
  AiContextOverflowError,
  LlmEmptyResponseError,
  type AIProvider,
  type AISession,
  type ProviderCapabilities,
} from "./ai-provider";
import {
  buildAiDraftSchema,
  buildAiDraftTurns,
  getDraftFewShot,
  stripLineNumbering,
  type AiDraftSessionContext,
} from "./buildAiDraftPrompt";
import type { AiLanguage } from "./aiLanguage";
import { extractJson } from "./extractJson";
import { fewShotChars, isTextOverBudget } from "./prompts/promptBudget";

export interface ReproPrefillInput {
  capabilities: ProviderCapabilities;
  createSession: AIProvider["createSession"];
  captureMode: CaptureMode;
  locale: LocaleMode;
  aiLanguage?: AiLanguage;
  url: string;
  pageTitle: string;
  actionLogSummary: ActionLogSummary;
  signal?: AbortSignal;
}

// 기존 AI draft 파이프라인을 stepsToReproduce 단일 섹션으로 좁혀 재사용. userPrompt·이미지·diff
// 없음(재현 단계는 액션 로그만으로 충분). title은 스키마상 강제되지만 응답에서 무시한다.
const REQUEST_MESSAGE = "Write the reproduction steps from the actions above.";

// 성공 시 steps 문자열 반환. provider 에러(quota/auth 등)는 그대로 전파하고, 응답이 비거나
// 파싱 불가면 LlmEmptyResponseError를 던진다 — 호출부가 toastLlmError로 통일 처리.
export async function generateReproStepsWithAI(
  input: ReproPrefillInput,
): Promise<string> {
  const ctx: AiDraftSessionContext = {
    caps: input.capabilities,
    captureMode: input.captureMode,
    locale: input.locale,
    aiLanguage: input.aiLanguage,
    url: input.url,
    pageTitle: input.pageTitle,
    actionLogSummary: input.actionLogSummary,
    enabledSections: [{ id: "stepsToReproduce" }],
  };
  // compact은 액션 컨텍스트가 user 턴에 실린다 — 요청 문장을 그 뒤에 붙여 "above"가 성립한다.
  const turns = buildAiDraftTurns(ctx);
  const systemPrompt = turns.system;
  const message = [turns.user, REQUEST_MESSAGE].filter(Boolean).join("\n");
  const schema = buildAiDraftSchema(["stepsToReproduce"]);
  const fewShot = getDraftFewShot(ctx);
  if (
    isTextOverBudget(
      systemPrompt.length + fewShotChars(fewShot),
      message,
      input.capabilities.contextBudgetChars,
    )
  ) {
    throw new AiContextOverflowError();
  }

  const session: AISession = await input.createSession(
    systemPrompt,
    fewShot,
  );
  try {
    const raw = await session.prompt(message, {
      responseSchema: schema,
      signal: input.signal,
    });
    const steps = parseSteps(raw);
    if (!steps) {
      // raw는 액션 로그 파생이라 사용자 입력이 섞일 수 있다 — 본문은 남기지 않는다.
      console.warn("[bugshot] repro prefill: AI returned no usable steps");
      throw new LlmEmptyResponseError();
    }
    return steps;
  } finally {
    session.destroy();
  }
}

// stepsToReproduce만 추출한다 — title은 스키마상 강제되지만 이 경로는 무시하므로,
// title 누락/빈값으로 응답 전체를 버리지 않는다(작은 모델이 title을 자주 빠뜨림).
function parseSteps(raw: string): string | null {
  const json = extractJson(raw);
  if (!json) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const val = parsed.stepsToReproduce;
  if (typeof val !== "string") return null;
  return stripLineNumbering(val).trim() || null;
}
