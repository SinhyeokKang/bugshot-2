import type { LocaleMode, TextSectionId } from "@/store/settings-ui-store";
import type { FewShotExample } from "../ai-provider";
import type { AiDraftSessionContext } from "@/sidepanel/lib/buildAiDraftPrompt";
import {
  supportsActionLog,
  supportsConsoleNetworkLog,
} from "@/sidepanel/lib/captureLogSupport";
import { MAX_TITLE_LENGTH, PROMPT_CAPS } from "./caps";
import { oneLine, selectDraftSections } from "./context";
import { canRequestLogRefs, selectLogCandidates } from "./logCandidates";

// 지시는 전부 긍정형이다. 소형 모델은 부정 지시("Do not X")에서 오히려 X를 활성화한다.
// JSON 형식 규칙("output only JSON" / "no extra fields" / "빈 문자열 사용")은
// responseConstraint가 구조적으로 강제하므로 넣지 않는다 — 순수 토큰 낭비다.
// 이미지 언급도 0이다 — 이 본문을 쓰는 프로바이더는 이미지를 못 받는다.
const SECTION_DESC: Record<LocaleMode, Record<TextSectionId, string>> = {
  ko: {
    description: "지금 무엇이 잘못됐는지",
    stepsToReproduce: "한 줄에 한 동작씩",
    expectedResult: "대신 어떻게 동작해야 하는지",
    notes: "그 밖의 참고 사항",
  },
  en: {
    description: "what is broken now",
    stepsToReproduce: "one action per line",
    expectedResult: "what should happen instead",
    notes: "any other context",
  },
};

// 소형 모델은 규칙 문장보다 예시 1개에 훨씬 강하게 정렬된다. 산문 서두·필드 누락을
// 말로 금지하는 대신(부정 지시는 역효과) 형태를 한 번 보여준다.
export const COMPACT_DRAFT_FEW_SHOT: FewShotExample[] = [
  {
    user: "The submit button does nothing on the checkout page.",
    assistant:
      '{"title":"Submit button does nothing on checkout","description":"Clicking Submit on the checkout page produces no response.","stepsToReproduce":"Open the checkout page\\nClick Submit","expectedResult":"The order is submitted.","notes":""}',
  },
];

// logRefs 후보가 있을 때의 변형. 값을 채운 예시(["n1"])는 금지 — 실제 런에 없는 ref를
// 가르친다(console-only 캡처엔 n1이 없다). 빈 배열이 기본값임을 형태로 보여준다.
export const COMPACT_DRAFT_FEW_SHOT_LOGREFS: FewShotExample[] = [
  {
    user: COMPACT_DRAFT_FEW_SHOT[0].user,
    assistant:
      '{"title":"Submit button does nothing on checkout","description":"Clicking Submit on the checkout page produces no response.","stepsToReproduce":"Open the checkout page\\nClick Submit","expectedResult":"The order is submitted.","notes":"","logRefs":[]}',
  },
];

export function buildCompactDraftPrompt(ctx: AiDraftSessionContext): string {
  const caps = PROMPT_CAPS.compact;
  const lang = ctx.locale === "ko" ? "Korean" : "English";
  const desc = SECTION_DESC[ctx.locale];
  const lines: string[] = [];

  lines.push("You are a QA engineer. Write a bug report from the context below.");
  lines.push("Use only facts stated in the context.");
  lines.push("");
  lines.push(`Page: ${ctx.url} (${ctx.pageTitle})`);

  if (ctx.captureMode === "element") {
    if (ctx.tagName && ctx.selector) {
      lines.push(`Element: <${ctx.tagName}> at ${ctx.selector}`);
    }
    if (ctx.diffs && ctx.diffs.length > 0) {
      lines.push("Style changes (current → desired):");
      for (const d of ctx.diffs.slice(0, caps.diffs)) {
        lines.push(`  ${d.prop}: ${d.asIs} → ${d.toBe}`);
      }
    }
    if (ctx.tokens && ctx.tokens.length > 0) {
      lines.push("Design tokens:");
      for (const tk of ctx.tokens.slice(0, caps.designTokens)) {
        lines.push(`  ${tk.name}: ${tk.value}`);
      }
    }
  }

  const cand = selectLogCandidates(ctx);
  const hasLogRefs = canRequestLogRefs(ctx, cand);
  if (supportsConsoleNetworkLog(ctx.captureMode)) {
    if (cand.network.length > 0) {
      lines.push("Network errors:");
      for (const e of cand.network) {
        lines.push(`  [${e.ref}] ${e.method} ${e.path} → ${e.status}`);
      }
    }
    if (cand.console.length > 0) {
      lines.push("Console errors:");
      for (const e of cand.console) {
        lines.push(`  [${e.ref}] ${e.message}`);
      }
    }
  }
  if (supportsActionLog(ctx.captureMode) && ctx.actionLogSummary?.length) {
    lines.push("User actions (rewrite as reproduction steps):");
    for (const a of ctx.actionLogSummary.slice(0, caps.actions)) {
      lines.push(`  ${a}`);
    }
  }

  // element 모드에서만 싣는다. 다른 모드는 이 텍스트가 곧 user turn으로 나가므로
  // system prompt에도 넣으면 가장 좁은 창에서 같은 문장을 두 번 계상한다.
  const userPrompt = ctx.userPrompt?.trim();
  if (userPrompt && ctx.captureMode === "element") {
    lines.push(`User says: ${userPrompt.slice(0, caps.userPromptChars)}`);
  }

  const { parts } = selectDraftSections(
    ctx.existingDraft,
    ctx.enabledSections.map((s) => s.id),
    caps.existingDraftChars,
  );
  // 사용자 초안은 줄 단위로 분해해 push한다 — 통짜로 넣으면 마지막 oneLine이
  // stepsToReproduce의 단계 구분 개행까지 접는다(인젝션 방어 대상은 페이지 문자열뿐).
  if (parts.length > 0) {
    lines.push("Draft so far (improve it):");
    lines.push(...parts.flatMap((p) => p.split(/\r?\n/)));
  }

  lines.push("");
  lines.push("Sections:");
  lines.push(`- title: one short line, at most ${MAX_TITLE_LENGTH} characters`);
  for (const sec of ctx.enabledSections) {
    lines.push(`- ${sec.id}: ${desc[sec.id]}`);
  }
  if (hasLogRefs) {
    lines.push(
      "- logRefs: tags of the log entries above (n1, c1) that directly show this bug; an empty array is the normal result. The app inserts the full log — keep raw bodies and stack traces out of the other fields",
    );
  }
  lines.push("");
  lines.push(`Write in ${lang}.`);

  return lines.map(oneLine).join("\n");
}
