import type { CaptureMode } from "@/store/editor-store";
import type { LocaleMode, TextSectionId } from "@/store/settings-ui-store";
import type { StyleDiffRow } from "@/sidepanel/components/StyleChangesTable";
import type { NetworkLogSummary, ConsoleLogSummary } from "./buildLogSummary";
import type { ActionLogSummary } from "@/types/action";
import type { NetworkRequest } from "@/types/network";
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
  COMPACT_DRAFT_FEW_SHOT_LOGREFS,
} from "./prompts/draftCompact";
import { buildRichDraftPrompt } from "./prompts/draftRich";
import {
  canRequestLogRefs,
  selectLogCandidates,
} from "./prompts/logCandidates";

type SchemaProperty =
  | { type: "string" }
  | { type: "array"; items: { type: "string"; enum: string[] } };

// opts.logRefs는 non-empty여야 한다 — enum: []는 퇴화 스키마라 nano의 문법 컴파일이
// 깨질 수 있다. 후보가 없으면 호출부가 opts를 생략한다.
export function buildAiDraftSchema(
  sectionIds: TextSectionId[],
  opts?: { logRefs: string[] },
) {
  const properties: Record<string, SchemaProperty> = {
    title: { type: "string" },
  };
  for (const id of sectionIds) {
    properties[id] = { type: "string" };
  }
  const required: string[] = ["title", ...sectionIds];
  if (opts) {
    properties.logRefs = {
      type: "array",
      items: { type: "string", enum: opts.logRefs },
    };
    required.push("logRefs");
  }
  return {
    type: "object",
    required,
    properties,
  };
}

// EditorDraft가 아닌 전용 타입 — logRefs는 setDraft 이전에 소비되는 transient 값이라
// store가 들고 있으면 안 된다.
export interface AiDraftResponse {
  title: string;
  sections: Record<string, string>;
  logRefs: string[];
}

// logRefs의 후보 대조는 여기서 하지 않는다 — 순수 JSON 디코더로 남기고,
// 검증·해석은 renderLogRefs 한 곳에만 둔다.
export function parseAiDraftResponse(
  raw: string,
  enabledSectionIds: TextSectionId[],
): AiDraftResponse | null {
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

  const logRefs = Array.isArray(parsed.logRefs)
    ? parsed.logRefs.filter((r): r is string => typeof r === "string")
    : [];

  return { title, sections, logRefs };
}

export function stripLineNumbering(text: string): string {
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
  // 매칭 200 검색 타깃 — 요약과 별개로 본문 포함 full requests. 예산 트리밍 level≥1에서 소멸.
  requests?: NetworkRequest[];
  // media는 텍스트 섹션이 아니라 여기 들어오면 안 된다 — 타입으로 차단(호출처는 사전 필터).
  enabledSections: { id: TextSectionId }[];
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
// style 축은 Record 유지(새 style이 조용히 흘러가지 않게), 후보 유무는 그 위에 얹는다 —
// 스키마가 logRefs를 실을 때만 예시도 그 키를 보여준다(안 실으면 없는 키를 가르치게 된다).
const DRAFT_FEW_SHOT: Record<
  PromptStyle,
  { base: FewShotExample[]; logRefs: FewShotExample[] } | undefined
> = {
  compact: {
    base: COMPACT_DRAFT_FEW_SHOT,
    logRefs: COMPACT_DRAFT_FEW_SHOT_LOGREFS,
  },
  rich: undefined,
};

export function buildAiDraftSessionPrompt(ctx: AiDraftSessionContext): string {
  return DRAFT_BUILDERS[ctx.caps.promptStyle](ctx);
}

export function getDraftFewShot(
  ctx: AiDraftSessionContext,
): FewShotExample[] | undefined {
  const entry = DRAFT_FEW_SHOT[ctx.caps.promptStyle];
  if (!entry) return undefined;
  return canRequestLogRefs(ctx, selectLogCandidates(ctx))
    ? entry.logRefs
    : entry.base;
}
