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
  parseAiDraftResponse,
  type AiDraftSessionContext,
} from "./buildAiDraftPrompt";

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
    const parsed = parseAiDraftResponse(raw, ["stepsToReproduce"]);
    const steps = parsed?.sections.stepsToReproduce?.trim();
    if (!steps) return { ok: false, reason: "other" };
    return { ok: true, steps };
  } catch (err) {
    return { ok: false, reason: classify(err) };
  } finally {
    session.destroy();
  }
}

function classify(err: unknown): "quota" | "auth" | "other" {
  if (err instanceof LlmAuthError) return "auth";
  if (err instanceof LlmQuotaError) return "quota";
  return "other";
}
