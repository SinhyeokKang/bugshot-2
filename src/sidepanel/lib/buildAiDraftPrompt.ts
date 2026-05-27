import type { CaptureMode } from "@/store/editor-store";
import type {
  IssueSectionId,
  LocaleMode,
} from "@/store/settings-ui-store";
import type { StyleDiffRow } from "@/sidepanel/components/StyleChangesTable";
import type { NetworkLogSummary, ConsoleLogSummary } from "./buildLogSummary";
import type { ActionLogSummary } from "@/types/action";
import type { EditorDraft } from "@/store/editor-store";

const MAX_DIFFS = 20;
const MAX_TOKENS = 10;
const MAX_TITLE_LENGTH = 80;

const SECTION_DESC_BASE: Record<LocaleMode, Record<IssueSectionId, string>> = {
  ko: {
    description: "발생 현상을 구체적으로 설명",
    stepsToReproduce: "재현 과정을 줄바꿈으로 구분된 단계로 작성 (번호 없이)",
    expectedResult: "수정 후 기대되는 동작",
    notes: "추가 참고 사항. 없으면 빈 문자열",
  },
  en: {
    description: "describe the issue in detail",
    stepsToReproduce: "write reproduction steps as newline-separated lines (no numbering)",
    expectedResult: "expected behavior after fix",
    notes: "additional notes. Leave empty string if nothing to add",
  },
};

const MODE_HINTS: Record<CaptureMode, Record<LocaleMode, Partial<Record<IssueSectionId, string>>>> = {
  element: {
    ko: { description: " (current 값이 현재 문제 상태)", expectedResult: " (desired 값 기준으로 작성)" },
    en: { description: " (current value is the problem)", expectedResult: " (use the desired value)" },
  },
  screenshot: {
    ko: { description: " (스크린샷과 사용자 설명 기반)" },
    en: { description: " (based on the screenshot and user description)" },
  },
  video: {
    ko: { description: " (사용자 설명과 에러 로그 기반)" },
    en: { description: " (based on user description and error logs)" },
  },
  freeform: {
    ko: { description: " (URL, 로그 등 재현 환경 정보 기반)" },
    en: { description: " (based on URL, logs, and environment)" },
  },
};

function getSectionDesc(
  locale: LocaleMode,
  mode: CaptureMode,
): Record<IssueSectionId, string> {
  const base = { ...SECTION_DESC_BASE[locale] };
  const hints = MODE_HINTS[mode]?.[locale] ?? {};
  for (const [key, suffix] of Object.entries(hints)) {
    base[key as IssueSectionId] += suffix;
  }
  return base;
}

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
}

export function buildAiDraftSessionPrompt(ctx: AiDraftSessionContext): string {
  const lang = ctx.locale === "ko" ? "Korean" : "English";
  const lines: string[] = [];

  lines.push(`You are a QA assistant. Write a bug report draft in ${lang}.`);
  lines.push("");
  lines.push("Context:");
  lines.push(`- Page: ${ctx.url} (${ctx.pageTitle})`);
  lines.push(`- Capture mode: ${ctx.captureMode}`);

  if (ctx.captureMode === "screenshot") {
    lines.push("- The user will provide a screenshot image and a description of the bug. Analyze the screenshot to understand the visual context.");
  }

  if (ctx.captureMode === "element") {
    if (ctx.tagName && ctx.selector) {
      lines.push(`- Element: <${ctx.tagName}> at ${ctx.selector}`);
    }
    if (ctx.diffs && ctx.diffs.length > 0) {
      lines.push("- Style changes (current → desired):");
      for (const d of ctx.diffs.slice(0, MAX_DIFFS)) {
        lines.push(`  ${d.prop}: current="${d.asIs}" → desired="${d.toBe}"`);
      }
    }
    if (ctx.tokens && ctx.tokens.length > 0) {
      lines.push("- Design tokens:");
      for (const tk of ctx.tokens.slice(0, MAX_TOKENS)) {
        lines.push(`  ${tk.name}: ${tk.value}`);
      }
    }
  }

  if (ctx.captureMode === "video" || ctx.captureMode === "freeform") {
    if (ctx.captureMode === "video") {
      lines.push("- The user recorded a screen video of the bug. They will describe what happened.");
    } else {
      lines.push("- The user is writing an issue without a capture. They will describe the bug based on environment info and logs.");
    }
    if (ctx.networkLogSummary && ctx.networkLogSummary.errors.length > 0) {
      lines.push("- Network errors:");
      for (const e of ctx.networkLogSummary.errors) {
        lines.push(`  ${e.method} ${e.path} → ${e.status} ${e.statusText}`);
      }
    }
    if (ctx.consoleLogSummary) {
      const c = ctx.consoleLogSummary;
      if (c.errorCount > 0 || c.warnCount > 0) {
        lines.push(`- Console: ${c.errorCount} errors, ${c.warnCount} warnings`);
        for (const msg of c.topErrors) {
          lines.push(`  ${msg}`);
        }
      }
    }
    // action log는 video(녹화 타임라인과 묶일 때)에서만 의미가 강하므로 freeform에서는 제외.
    if (ctx.captureMode === "video" && ctx.actionLogSummary && ctx.actionLogSummary.length > 0) {
      lines.push("- User actions (reference only — context for understanding, do not copy verbatim into stepsToReproduce):");
      for (const a of ctx.actionLogSummary) {
        lines.push(`  ${a}`);
      }
    }
  }

  const userPrompt = ctx.userPrompt?.trim();
  if (userPrompt && ctx.captureMode === "element") {
    const [first, ...rest] = userPrompt.split(/\r?\n/);
    lines.push(`- User context: ${first}`);
    for (const cont of rest) {
      lines.push(`  ${cont}`);
    }
  }

  const desc = getSectionDesc(ctx.locale, ctx.captureMode);
  lines.push("");
  lines.push("Output a JSON object with these exact keys:");
  lines.push('- "title": one short line, as brief as possible');
  for (const sec of ctx.enabledSections) {
    lines.push(`- "${sec.id}": ${desc[sec.id]}`);
  }

  lines.push("");
  lines.push("Rules:");
  lines.push("- Output only valid JSON. No markdown fences or extra text.");
  lines.push("- Base the report on the user's description and provided context. Never invent details not given.");
  lines.push("- If a section has no relevant information, use an empty string.");

  return lines.join("\n");
}

function extractJson(raw: string): string | null {
  const stripped = raw
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return stripped.slice(start, end + 1);
}
