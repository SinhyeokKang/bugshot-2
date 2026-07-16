import type { CaptureMode } from "@/store/editor-store";
import type { LocaleMode } from "@/store/settings-ui-store";
import type { ActionLogSummary } from "@/types/action";
import {
  LlmAuthError,
  LlmQuotaError,
  type AIProvider,
  type AISession,
  type ProviderCapabilities,
} from "./ai-provider";
import {
  buildAiDraftSchema,
  buildAiDraftSessionPrompt,
  getDraftFewShot,
  stripLineNumbering,
  type AiDraftSessionContext,
} from "./buildAiDraftPrompt";
import { extractJson } from "./extractJson";

export interface ReproPrefillInput {
  capabilities: ProviderCapabilities;
  createSession: AIProvider["createSession"];
  captureMode: CaptureMode;
  locale: LocaleMode;
  url: string;
  pageTitle: string;
  actionLogSummary: ActionLogSummary;
}

export type ReproPrefillResult =
  | { ok: true; steps: string }
  | { ok: false; reason: "quota" | "auth" | "other" };

// 기존 AI draft 파이프라인을 stepsToReproduce 단일 섹션으로 좁혀 재사용. userPrompt·이미지·diff
// 없음(재현 단계는 액션 로그만으로 충분). title은 스키마상 강제되지만 응답에서 무시한다.
const REQUEST_MESSAGE = "Write the reproduction steps from the actions above.";

export async function generateReproStepsWithAI(
  input: ReproPrefillInput,
): Promise<ReproPrefillResult> {
  const ctx: AiDraftSessionContext = {
    caps: input.capabilities,
    captureMode: input.captureMode,
    locale: input.locale,
    url: input.url,
    pageTitle: input.pageTitle,
    actionLogSummary: input.actionLogSummary,
    enabledSections: [{ id: "stepsToReproduce" }],
  };
  const systemPrompt = buildAiDraftSessionPrompt(ctx);
  const schema = buildAiDraftSchema(["stepsToReproduce"]);

  let session: AISession;
  try {
    session = await input.createSession(systemPrompt, getDraftFewShot(ctx));
  } catch (err) {
    return { ok: false, reason: classify(err) };
  }
  try {
    const raw = await session.prompt(REQUEST_MESSAGE, { responseSchema: schema });
    const steps = parseSteps(raw);
    if (!steps) {
      // title을 요구하는 parseAiDraftResponse와 달리 steps만 본다 — 그래도 빈/파싱실패면 여기서 로깅.
      console.warn("[bugshot] repro prefill: AI returned no usable steps. Raw:", raw);
      return { ok: false, reason: "other" };
    }
    return { ok: true, steps };
  } catch (err) {
    console.warn("[bugshot] repro prefill: AI call failed", err);
    return { ok: false, reason: classify(err) };
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

function classify(err: unknown): "quota" | "auth" | "other" {
  if (err instanceof LlmAuthError) return "auth";
  if (err instanceof LlmQuotaError) return "quota";
  return "other";
}
