import type { CaptureMode } from "@/store/editor-store";
import type { IssueSectionId, LocaleMode } from "@/store/settings-ui-store";
import type { StyleDiffRow } from "@/sidepanel/components/StyleChangesTable";
import type { NetworkLogSummary, ConsoleLogSummary } from "./buildLogSummary";
import type { ActionLogSummary } from "@/types/action";
import type { EditorDraft } from "@/store/editor-store";
import type { FewShotExample, ProviderCapabilities } from "./ai-provider";
import { extractJson } from "./extractJson";
import {
  buildCompactDraftPrompt,
  COMPACT_DRAFT_FEW_SHOT,
} from "./prompts/draft.compact";
import { buildRichDraftPrompt } from "./prompts/draft.rich";

const MAX_TITLE_LENGTH = 80;

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

export function buildAiDraftSessionPrompt(ctx: AiDraftSessionContext): string {
  return ctx.caps.promptStyle === "compact"
    ? buildCompactDraftPrompt(ctx)
    : buildRichDraftPrompt(ctx);
}

// compact은 예시로 출력 형태를 잡는다. rich는 규칙 문장으로 충분하다.
export function getDraftFewShot(
  ctx: AiDraftSessionContext,
): FewShotExample[] | undefined {
  return ctx.caps.promptStyle === "compact" ? COMPACT_DRAFT_FEW_SHOT : undefined;
}
