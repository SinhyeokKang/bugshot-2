import type { CaptureMode } from "@/store/editor-store";
import type { IssueSectionId, LocaleMode } from "@/store/settings-ui-store";
import type { StyleDiffRow } from "@/sidepanel/components/StyleChangesTable";
import type { NetworkLogSummary, ConsoleLogSummary } from "./buildLogSummary";
import type { ActionLogSummary } from "@/types/action";
import type { EditorDraft } from "@/store/editor-store";
import type {
  FewShotExample,
  PromptStyle,
  ProviderCapabilities,
} from "./ai-provider";
import { extractJson } from "./extractJson";
import { MAX_TITLE_LENGTH } from "./prompts/caps";
import {
  buildCompactDraftPrompt,
  COMPACT_DRAFT_FEW_SHOT,
} from "./prompts/draftCompact";
import { buildRichDraftPrompt } from "./prompts/draftRich";

export function buildAiDraftSchema(sectionIds: IssueSectionId[]) {
  const properties: Record<string, { type: "string" }> = {
    title: { type: "string" },
  };
  for (const id of sectionIds) {
    properties[id] = { type: "string" };
  }
  return {
    type: "object",
    required: ["title", ...sectionIds],
    properties,
  };
}

export function parseAiDraftResponse(
  raw: string,
  enabledSectionIds: IssueSectionId[],
): EditorDraft | null {
  const json = extractJson(raw);
  if (!json) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (typeof parsed.title !== "string" || !parsed.title.trim()) return null;

  const title = parsed.title.slice(0, MAX_TITLE_LENGTH);

  const sections: Record<string, string> = {};
  for (const id of enabledSectionIds) {
    if (typeof parsed[id] === "string") {
      let val = parsed[id] as string;
      if (id === "stepsToReproduce") {
        val = stripLineNumbering(val);
      }
      sections[id] = val;
    }
  }

  return { title, sections };
}

function stripLineNumbering(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/^\d+[\.\)]\s*/, ""))
    .join("\n");
}

export interface AiDraftSessionContext {
  caps: ProviderCapabilities;
  captureMode: CaptureMode;
  locale: LocaleMode;
  url: string;
  pageTitle: string;
  selector?: string;
  tagName?: string;
  diffs?: StyleDiffRow[];
  tokens?: { name: string; value: string }[];
  userPrompt?: string;
  networkLogSummary?: NetworkLogSummary;
  consoleLogSummary?: ConsoleLogSummary;
  actionLogSummary?: ActionLogSummary;
  enabledSections: { id: IssueSectionId }[];
  existingDraft?: { title: string; sections: Record<string, string> };
}

// Record로 분기해야 PromptStyle에 값이 늘 때 컴파일 에러가 난다. 삼항은 새 style을
// 조용히 rich로 흘려보낸다 — 창이 가장 좁은 프로바이더가 가장 큰 본문을 받는 방향이다.
const DRAFT_BUILDERS: Record<
  PromptStyle,
  (ctx: AiDraftSessionContext) => string
> = {
  compact: buildCompactDraftPrompt,
  rich: buildRichDraftPrompt,
};

// compact은 예시로 출력 형태를 잡는다. rich는 규칙 문장으로 충분하다.
const DRAFT_FEW_SHOT: Record<PromptStyle, FewShotExample[] | undefined> = {
  compact: COMPACT_DRAFT_FEW_SHOT,
  rich: undefined,
};

export function buildAiDraftSessionPrompt(ctx: AiDraftSessionContext): string {
  return DRAFT_BUILDERS[ctx.caps.promptStyle](ctx);
}

export function getDraftFewShot(
  ctx: AiDraftSessionContext,
): FewShotExample[] | undefined {
  return DRAFT_FEW_SHOT[ctx.caps.promptStyle];
}
