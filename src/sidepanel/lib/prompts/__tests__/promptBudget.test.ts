import { describe, it, expect, vi } from "vitest";
import {
  fitDraftContext,
  isPromptOverBudget,
  trimDraftContext,
} from "../promptBudget";
import { NANO_CAPABILITIES, BYOK_CAPABILITIES, type AISession } from "../../ai-provider";
import { selectLogCandidates } from "../logCandidates";
import type { AiDraftSessionContext } from "../../buildAiDraftPrompt";

const RICH_CTX: AiDraftSessionContext = {
  caps: BYOK_CAPABILITIES,
  captureMode: "video",
  locale: "ko",
  url: "https://example.com/page",
  pageTitle: "Example Page",
  enabledSections: [{ id: "description" }, { id: "notes" }],
};

const NANO_CTX: AiDraftSessionContext = { ...RICH_CTX, caps: NANO_CAPABILITIES };

const LOGS = {
  networkLogSummary: {
    captured: 10,
    errors: [
      { id: "nr-t1", method: "POST", path: "/api/pay", status: 500, statusText: "Err" },
    ],
  },
  consoleLogSummary: {
    captured: 5,
    errorCount: 3,
    warnCount: 1,
    topErrors: [{ id: "cl-t1", message: "Uncaught Error: payment failed" }],
  },
  actionLogSummary: ["click Submit", "input email"],
};

const DRAFT = {
  title: "기존 제목",
  sections: { description: "사용자가 적어둔 현상", notes: "추가 메모" },
};

const ELEMENT_EXTRAS = {
  diffs: [{ prop: "border-radius", asIs: "8px", toBe: "4px" }],
  tokens: [{ name: "--radius-lg", value: "12px" }],
};

const FULL_CTX: AiDraftSessionContext = {
  ...NANO_CTX,
  ...LOGS,
  ...ELEMENT_EXTRAS,
  existingDraft: DRAFT,
};

// 컨텍스트 크기에 비례하는 결정적 build — 실제 프롬프트 문구에 의존하지 않는다.
const build = (c: AiDraftSessionContext) =>
  JSON.stringify({
    url: c.url,
    userPrompt: c.userPrompt ?? "",
    net: c.networkLogSummary ?? null,
    con: c.consoleLogSummary ?? null,
    act: c.actionLogSummary ?? null,
    draft: c.existingDraft ?? null,
    diffs: c.diffs ?? null,
    tokens: c.tokens ?? null,
  });

describe("trimDraftContext", () => {
  it("level 0 — 아무것도 제거하지 않는다", () => {
    const out = trimDraftContext(FULL_CTX, 0);
    expect(out.networkLogSummary).toBeDefined();
    expect(out.existingDraft).toBeDefined();
    expect(out.diffs).toBeDefined();
  });

  it("level 1 — 로그(network·console·action)를 제거", () => {
    const out = trimDraftContext(FULL_CTX, 1);
    expect(out.networkLogSummary).toBeUndefined();
    expect(out.consoleLogSummary).toBeUndefined();
    expect(out.actionLogSummary).toBeUndefined();
    expect(out.existingDraft).toBeDefined();
  });

  it("level 2 — 로그 + 기존 초안 제거", () => {
    const out = trimDraftContext(FULL_CTX, 2);
    expect(out.networkLogSummary).toBeUndefined();
    expect(out.existingDraft).toBeUndefined();
    expect(out.diffs).toBeDefined();
  });

  it("level 3 — 로그 + 초안 + diff·토큰까지 제거", () => {
    const out = trimDraftContext(FULL_CTX, 3);
    expect(out.networkLogSummary).toBeUndefined();
    expect(out.existingDraft).toBeUndefined();
    expect(out.diffs).toBeUndefined();
    expect(out.tokens).toBeUndefined();
  });

  it("원본 ctx를 변형하지 않는다 (순수)", () => {
    trimDraftContext(FULL_CTX, 3);
    expect(FULL_CTX.networkLogSummary).toBeDefined();
    expect(FULL_CTX.existingDraft).toBeDefined();
  });

  it("url·captureMode·enabledSections는 어느 level에서도 유지", () => {
    const out = trimDraftContext(FULL_CTX, 3);
    expect(out.url).toBe(FULL_CTX.url);
    expect(out.captureMode).toBe(FULL_CTX.captureMode);
    expect(out.enabledSections).toEqual(FULL_CTX.enabledSections);
  });
});

describe("fitDraftContext", () => {
  it("예산 내 컨텍스트 → level 0 유지, 무손실", () => {
    const result = fitDraftContext(FULL_CTX, build, 100_000);
    expect(result.level).toBe(0);
    expect(result.ctx.networkLogSummary).toBeDefined();
    expect(result.ctx.existingDraft).toBeDefined();
  });

  it("예산 무제한(BYOK) → level 0 즉시 no-op", () => {
    const result = fitDraftContext(
      { ...FULL_CTX, caps: BYOK_CAPABILITIES },
      build,
      BYOK_CAPABILITIES.contextBudgetChars,
    );
    expect(result.level).toBe(0);
    expect(result.ctx).toEqual({ ...FULL_CTX, caps: BYOK_CAPABILITIES });
  });

  it("거대 컨텍스트 → level이 올라가며 예산 내로 수렴", () => {
    const bigLogs: AiDraftSessionContext = {
      ...NANO_CTX,
      networkLogSummary: {
        captured: 100,
        errors: Array.from({ length: 50 }, (_, i) => ({
          id: `nr-${i}`,
          method: "GET",
          path: `/api/very/long/path/segment/number/${i}`,
          status: 500,
          statusText: "Internal Server Error",
        })),
      },
    };
    const budget = build(NANO_CTX).length + 50;
    const result = fitDraftContext(bigLogs, build, budget);

    expect(result.level).toBeGreaterThan(0);
    expect(result.prompt.length).toBeLessThanOrEqual(budget);
    expect(result.ctx.networkLogSummary).toBeUndefined();
  });

  it("절삭은 로그 → 기존 초안 → diff 순 (최소 손실 우선)", () => {
    const budget = build({ ...NANO_CTX, existingDraft: DRAFT, ...ELEMENT_EXTRAS }).length;
    const result = fitDraftContext(FULL_CTX, build, budget);

    // 로그만 버려도 맞으면 초안·diff는 살아남는다
    expect(result.level).toBe(1);
    expect(result.ctx.existingDraft).toBeDefined();
    expect(result.ctx.diffs).toBeDefined();
  });

  it("거대 단일 항목 — level 3까지 가도 던지지 않고 그대로 반환", () => {
    const huge: AiDraftSessionContext = {
      ...NANO_CTX,
      userPrompt: "x".repeat(50_000),
    };
    const result = fitDraftContext(huge, build, 1_000);

    expect(result.level).toBe(3);
    expect(result.prompt.length).toBeGreaterThan(1_000);
    expect(result.ctx.userPrompt).toBeDefined();
  });

  it("빈 컨텍스트 → level 0 + 유효한 프롬프트", () => {
    const result = fitDraftContext(NANO_CTX, build, 10_000);
    expect(result.level).toBe(0);
    expect(result.prompt.length).toBeGreaterThan(0);
  });

  it("includedSections — 초안이 실린 섹션 id 목록", () => {
    const result = fitDraftContext(FULL_CTX, build, 100_000);
    expect(result.includedSections).toEqual(["description", "notes"]);
    // 전부 실렸으면 빠진 것 없음.
    expect(result.omittedSections).toEqual([]);
  });

  it("includedSections — level 2 이상(초안 절삭)이면 빈 배열", () => {
    const result = fitDraftContext(FULL_CTX, build, 1);
    expect(result.level).toBeGreaterThanOrEqual(2);
    expect(result.includedSections).toEqual([]);
    // 예산 절삭으로 빠진 내용 있는 섹션은 omittedSections로 고지된다(병합이 원문 보존).
    expect(result.omittedSections).toEqual(["description", "notes"]);
  });

  it("includedSections — 기존 초안이 없으면 빈 배열", () => {
    const result = fitDraftContext(NANO_CTX, build, 100_000);
    expect(result.includedSections).toEqual([]);
  });

  it("includedSections — 활성 섹션이면서 내용이 있는 것만", () => {
    const result = fitDraftContext(
      {
        ...NANO_CTX,
        existingDraft: { title: "t", sections: { description: "내용", notes: "" } },
      },
      build,
      100_000,
    );
    expect(result.includedSections).toEqual(["description"]);
  });
});

function fakeSession(overrides: Partial<AISession> = {}): AISession {
  return {
    prompt: vi.fn(),
    destroy: vi.fn(),
    ...overrides,
  } as AISession;
}

describe("isPromptOverBudget", () => {
  it("measureContextUsage 미지원 → false (통과)", async () => {
    const session = fakeSession();
    await expect(isPromptOverBudget(session, "hello")).resolves.toBe(false);
  });

  it("contextWindow 미지원 → false (통과)", async () => {
    const session = fakeSession({
      measureContextUsage: vi.fn().mockResolvedValue(100),
    });
    await expect(isPromptOverBudget(session, "hello")).resolves.toBe(false);
  });

  it("지원 + 미초과 → false", async () => {
    const session = fakeSession({
      measureContextUsage: vi.fn().mockResolvedValue(100),
      contextUsage: 500,
      contextWindow: 4000,
    });
    await expect(isPromptOverBudget(session, "hello")).resolves.toBe(false);
  });

  it("지원 + 초과 → true (usage + 입력 측정치가 창을 넘음)", async () => {
    const session = fakeSession({
      measureContextUsage: vi.fn().mockResolvedValue(3800),
      contextUsage: 500,
      contextWindow: 4000,
    });
    await expect(isPromptOverBudget(session, "hello")).resolves.toBe(true);
  });

  it("responseSchema를 measureContextUsage에 함께 전달 (스키마도 컨텍스트를 먹는다)", async () => {
    const measure = vi.fn().mockResolvedValue(10);
    const session = fakeSession({
      measureContextUsage: measure,
      contextUsage: 0,
      contextWindow: 4000,
    });
    const schema = { type: "object" };
    await isPromptOverBudget(session, "hello", schema);
    expect(measure).toHaveBeenCalledWith("hello", { responseSchema: schema });
  });

  it("측정이 던지면 false (측정 실패가 기능을 막지 않는다)", async () => {
    const session = fakeSession({
      measureContextUsage: vi.fn().mockRejectedValue(new Error("boom")),
      contextUsage: 0,
      contextWindow: 4000,
    });
    await expect(isPromptOverBudget(session, "hello")).resolves.toBe(false);
  });
});

// ai-draft-log-refs: 후보·스키마·few-shot이 전부 fitted.ctx에서 파생되므로,
// 예산 절삭(level≥1)이 로그 요약을 지우면 후보도 동시에 소멸해야 한다 — 절삭 결합 계약.
describe("fitDraftContext × selectLogCandidates — 절삭 결합", () => {
  const LOGGED_CTX: AiDraftSessionContext = {
    ...NANO_CTX,
    networkLogSummary: {
      captured: 3,
      errors: [
        {
          id: "nr-1700000000000-a",
          method: "POST",
          path: "/api/pay",
          status: 500,
          statusText: "Err",
        },
      ],
    },
    consoleLogSummary: {
      captured: 2,
      errorCount: 1,
      warnCount: 0,
      topErrors: [{ id: "cl-1700000000000-a", message: "TypeError: boom" }],
    },
  };

  it("level 0 → 후보가 살아 있다", () => {
    const fitted = fitDraftContext(LOGGED_CTX, build, 100_000);
    expect(fitted.level).toBe(0);
    const c = selectLogCandidates(fitted.ctx);
    expect(c.network).toHaveLength(1);
    expect(c.console).toHaveLength(1);
  });

  it("level≥1 절삭 → selectLogCandidates(fitted.ctx)가 빈 후보", () => {
    const fitted = fitDraftContext(LOGGED_CTX, build, build(NANO_CTX).length + 10);
    expect(fitted.level).toBeGreaterThanOrEqual(1);
    const c = selectLogCandidates(fitted.ctx);
    expect(c.network).toEqual([]);
    expect(c.console).toEqual([]);
  });
});

// 코드블럭이 보존 대상이 되면 "원문 있음" 판정도 코드블럭을 빼야 한다. strip 단위·merge
// 단위 양 끝 테스트로는 이 사고 경로(빈 섹션이 includedIds에 실려 merge 가드가 풀림)가
// 안 잡힌다 — selectDraftSections 경유 통합 레벨에서 직접 단언한다.
describe("fitDraftContext — 코드블럭만 있는 섹션은 프롬프트에 실리지 않는다", () => {
  it("코드블럭만 있는 섹션은 includedSections·omittedSections 어디에도 없다", () => {
    const fitted = fitDraftContext(
      {
        ...RICH_CTX,
        existingDraft: {
          title: "t",
          sections: {
            description: "```\nGET /api → 500\n```",
            notes: "산문 메모",
          },
        },
      },
      build,
      100_000,
    );
    expect(fitted.includedSections).toEqual(["notes"]);
    expect(fitted.omittedSections).toEqual([]);
  });

  it("산문 + 코드블럭 섹션은 여전히 실린다 (산문이 있으므로)", () => {
    const fitted = fitDraftContext(
      {
        ...RICH_CTX,
        existingDraft: {
          title: "t",
          sections: { description: "산문 설명\n\n```\ncode\n```" },
        },
      },
      build,
      100_000,
    );
    expect(fitted.includedSections).toEqual(["description"]);
  });
});

// 섹션과 같은 손실 경로가 title에도 있다: level≥2에서 existingDraft가 통째로 빠지면
// 모델은 사용자의 기존 제목을 본 적 없이 새 제목을 지어낸다.
describe("fitDraftContext — title 포함 여부", () => {
  const withDraft = (ctx: AiDraftSessionContext): AiDraftSessionContext => ({
    ...ctx,
    existingDraft: {
      title: "사용자가 쓴 제목",
      sections: { description: "사용자가 쓴 본문" },
    },
  });

  it("예산에 여유가 있으면 title이 실린다", () => {
    const fitted = fitDraftContext(
      withDraft(RICH_CTX),
      (c) => `prompt:${c.existingDraft?.title ?? ""}`,
      10_000,
    );
    expect(fitted.titleIncluded).toBe(true);
  });

  it("절삭 level≥2(기존 초안 폐기)면 title도 안 실린다", () => {
    const fitted = fitDraftContext(
      withDraft(RICH_CTX),
      (c) => (c.existingDraft ? "x".repeat(500) : "x".repeat(10)),
      100,
    );
    expect(fitted.level).toBeGreaterThanOrEqual(2);
    expect(fitted.titleIncluded).toBe(false);
  });

  it("기존 제목이 없으면 titleIncluded=false", () => {
    const fitted = fitDraftContext(
      { ...RICH_CTX, existingDraft: { title: "  ", sections: {} } },
      () => "short",
      10_000,
    );
    expect(fitted.titleIncluded).toBe(false);
  });
});
