import type { CaptureMode } from "@/store/editor-store";
import type { IssueSectionId, LocaleMode } from "@/store/settings-ui-store";
import type { AiDraftSessionContext } from "../buildAiDraftPrompt";
import { stripInlineImageRefs } from "../resolveInlineImages";
import {
  supportsActionLog,
  supportsConsoleNetworkLog,
} from "@/sidepanel/lib/captureLogSupport";
import { MAX_TITLE_LENGTH, PROMPT_CAPS } from "./caps";
import { oneLine, selectDraftSections } from "./context";

const SECTION_DESC_BASE: Record<LocaleMode, Record<IssueSectionId, string>> = {
  ko: {
    description: "현재 관찰되는 문제 현상만 구체적으로 (기대 동작·해결책은 쓰지 말 것)",
    stepsToReproduce: "재현 과정을 줄바꿈으로 구분된 단계로 작성 (번호 없이)",
    expectedResult: "수정 후 기대되는 동작",
    notes: "추가 참고 사항. 확신이 서지 않는 추론은 여기에 '가설:' 접두로 분리. 없으면 빈 문자열",
  },
  en: {
    description: "describe only the currently observed problem (do not include expected behavior or fixes)",
    stepsToReproduce: "write reproduction steps as newline-separated lines (no numbering)",
    expectedResult: "expected behavior after fix",
    notes: "additional notes. Put any unconfirmed inference here prefixed with 'Hypothesis:'. Leave empty string if nothing to add",
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

export function buildRichDraftPrompt(ctx: AiDraftSessionContext): string {
  const caps = PROMPT_CAPS.rich;
  const lang = ctx.locale === "ko" ? "Korean" : "English";
  const lines: string[] = [];

  lines.push(
    `You are a senior QA engineer. Write a bug report in ${lang} that a developer can act on without asking follow-up questions.`,
  );
  lines.push("");
  lines.push("Before writing, work through the context internally:");
  lines.push("1. Align the user's description with the action timeline.");
  lines.push("2. Treat only the console/network errors near that moment as causal candidates.");
  lines.push("3. Verify against the screenshot and style changes.");
  lines.push("4. State only what the context confirms. Put inference in notes, prefixed as a hypothesis.");
  lines.push("");
  lines.push("Context:");
  lines.push(`- Page: ${ctx.url} (${ctx.pageTitle})`);
  lines.push(`- Capture mode: ${ctx.captureMode}`);

  if (ctx.captureMode === "screenshot") {
    lines.push("- The user attached a screenshot. Read it to ground the visual context.");
  }

  if (ctx.captureMode === "element") {
    if (ctx.tagName && ctx.selector) {
      lines.push(`- Element: <${ctx.tagName}> at ${ctx.selector}`);
    }
    if (ctx.diffs && ctx.diffs.length > 0) {
      lines.push("- Style changes (current → desired):");
      for (const d of ctx.diffs.slice(0, caps.diffs)) {
        lines.push(`  ${d.prop}: current="${d.asIs}" → desired="${d.toBe}"`);
      }
    }
    if (ctx.tokens && ctx.tokens.length > 0) {
      lines.push("- Design tokens:");
      for (const tk of ctx.tokens.slice(0, caps.designTokens)) {
        lines.push(`  ${tk.name}: ${tk.value}`);
      }
    }
  }

  if (supportsConsoleNetworkLog(ctx.captureMode)) {
    if (ctx.captureMode === "video") {
      lines.push("- The user recorded a screen video of the bug. They will describe what happened.");
    } else if (ctx.captureMode === "freeform") {
      lines.push("- The user is writing an issue without a capture. They will describe the bug based on environment info and logs.");
    }
    // screenshot은 위에서 이미 캡처를 설명했다 — 여기서 서술 줄을 또 넣지 않는다.
    if (ctx.networkLogSummary && ctx.networkLogSummary.errors.length > 0) {
      lines.push("- Network errors:");
      for (const e of ctx.networkLogSummary.errors.slice(0, caps.networkErrors)) {
        lines.push(`  ${e.method} ${e.path} → ${e.status} ${e.statusText}`);
      }
    }
    if (ctx.consoleLogSummary) {
      const c = ctx.consoleLogSummary;
      if (c.errorCount > 0 || c.warnCount > 0) {
        lines.push(`- Console: ${c.errorCount} errors, ${c.warnCount} warnings`);
        for (const msg of c.topErrors.slice(0, caps.consoleErrors)) {
          lines.push(`  ${msg}`);
        }
      }
    }
  }

  // action log는 이슈에 실리는 모든 모드(supportsActionLog)에서 재현 단서다 — AI도 같은 데이터를 본다.
  // console/network와 별도 게이트로 둔다: 매트릭스가 갈라져도 compact(동일 구조)와 어긋나지 않게.
  if (supportsActionLog(ctx.captureMode) && ctx.actionLogSummary && ctx.actionLogSummary.length > 0) {
    lines.push("- User actions (rephrase these into concise user-facing reproduction steps — do not copy the raw entries verbatim):");
    for (const a of ctx.actionLogSummary.slice(0, caps.actions)) {
      lines.push(`  ${a}`);
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

  const { parts } = selectDraftSections(
    ctx.existingDraft,
    ctx.enabledSections.map((s) => s.id),
    caps.existingDraftChars,
    stripInlineImageRefs,
  );
  // 줄 단위로 분해해 push — 통짜로 넣으면 마지막 oneLine이 stepsToReproduce의 단계
  // 구분 개행까지 접는다(인젝션 방어 대상은 페이지 통제 문자열뿐, 사용자 초안이 아니다).
  if (parts.length > 0) {
    lines.push("");
    lines.push(
      "Current draft (the user already wrote this — use it as reference, then improve and complete it):",
    );
    for (const p of parts) {
      const [first, ...rest] = p.split(/\r?\n/);
      lines.push(`- ${first}`);
      for (const cont of rest) lines.push(`  ${cont}`);
    }
  }

  const desc = getSectionDesc(ctx.locale, ctx.captureMode);
  lines.push("");
  lines.push("Output a JSON object with these exact keys:");
  lines.push(
    `- "title": one line, at most ${MAX_TITLE_LENGTH} characters, shaped as "[affected thing] symptom (condition)". State the symptom, not a guess at the cause`,
  );
  for (const sec of ctx.enabledSections) {
    lines.push(`- "${sec.id}": ${desc[sec.id]}`);
  }

  lines.push("");
  lines.push("Rules:");
  lines.push("- Output only valid JSON. No markdown fences or extra text.");
  lines.push("- Base the report on the user's description and provided context. Never invent details not given.");
  lines.push("- Only reference logs, errors, or context that plausibly relate to the described bug. Ignore unrelated entries.");
  lines.push("- When quoting a log or error, copy the original snippet verbatim rather than paraphrasing it.");
  lines.push("- The description states only the current problem (as-is). Put any expected or desired behavior in expectedResult, never in description.");
  lines.push("- Every sentence carries an observed fact or a concrete value: exact values, selectors, error text, observed behavior. One new piece of information per sentence, stated once.");
  lines.push("- Keep every section as brief as its content allows.");
  lines.push("- Write plain text. Markdown picture embeds such as ![](...) do not belong in any field.");
  lines.push("- If a section has no relevant information, use an empty string.");
  lines.push(
    ctx.locale === "ko"
      ? `- Write all string values in ${lang}, in a terse technical bug-report tone — no greetings, no softening, no redundant honorific padding.`
      : `- Write all string values in ${lang}.`,
  );

  return lines.map(oneLine).join("\n");
}
