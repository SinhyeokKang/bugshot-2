import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateReproStepsWithAI } from "../generateReproPrefill";
import {
  LlmQuotaError,
  LlmAuthError,
  LlmEmptyResponseError,
  NANO_CAPABILITIES,
  BYOK_CAPABILITIES,
} from "../ai-provider";
import type { AISession, AIProvider } from "../ai-provider";
import { COMPACT_DRAFT_FEW_SHOT } from "../prompts/draftCompact";
import { buildAiDraftSchema } from "../buildAiDraftPrompt";

// createSession을 가짜로 만들어 (systemPrompt, fewShot) 인자와 prompt 호출 옵션을 캡처한다.
function makeCreateSession(promptImpl: (input: string, options?: unknown) => Promise<string>) {
  const calls: { systemPrompt: string; fewShot: unknown }[] = [];
  const promptCalls: { input: string; options: unknown }[] = [];
  const createSession = vi.fn(async (systemPrompt: string, fewShot?: unknown) => {
    calls.push({ systemPrompt, fewShot });
    const session: AISession = {
      prompt: vi.fn(async (input: string, options?: unknown) => {
        promptCalls.push({ input, options });
        return promptImpl(input, options);
      }) as unknown as AISession["prompt"],
      destroy: vi.fn(),
    };
    return session;
  }) as unknown as AIProvider["createSession"];
  return { createSession, calls, promptCalls };
}

function baseInput(createSession: AIProvider["createSession"]) {
  return {
    capabilities: NANO_CAPABILITIES,
    createSession,
    captureMode: "video" as const,
    locale: "en" as const,
    url: "https://ex.com",
    pageTitle: "Example",
    actionLogSummary: ["Navigated to: https://ex.com", "Clicked: Submit"],
  };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("generateReproStepsWithAI", () => {
  it("성공 시 stepsToReproduce 문자열을 반환하고 title은 무시한다", async () => {
    const { createSession } = makeCreateSession(
      async () => '{"title":"Ignore me","stepsToReproduce":"Open X\\nClick Y"}',
    );
    expect(await generateReproStepsWithAI(baseInput(createSession))).toBe("Open X\nClick Y");
  });

  it("title이 없거나 비어도 stepsToReproduce가 있으면 반환한다 (title 의존 제거)", async () => {
    const noTitle = makeCreateSession(async () => '{"stepsToReproduce":"Open X\\nClick Y"}');
    expect(await generateReproStepsWithAI(baseInput(noTitle.createSession))).toBe(
      "Open X\nClick Y",
    );
    const emptyTitle = makeCreateSession(async () => '{"title":"","stepsToReproduce":"Open X"}');
    expect(await generateReproStepsWithAI(baseInput(emptyTitle.createSession))).toBe("Open X");
  });

  it("응답의 번호 접두(1. 2.)는 제거된다", async () => {
    const { createSession } = makeCreateSession(
      async () => '{"stepsToReproduce":"1. Open the page\\n2. Click Submit"}',
    );
    expect(await generateReproStepsWithAI(baseInput(createSession))).toBe(
      "Open the page\nClick Submit",
    );
  });

  it("stepsToReproduce 단일 섹션으로 좁히고 few-shot·스키마를 실어 호출한다", async () => {
    const { createSession, calls, promptCalls } = makeCreateSession(
      async () => '{"title":"T","stepsToReproduce":"s"}',
    );
    await generateReproStepsWithAI(baseInput(createSession));

    // 섹션 목록은 `- <id>: <설명>` 줄로 나간다 — 카피가 바뀌어도 이 단언은 유효하다.
    const sys = calls[0].systemPrompt;
    expect(sys).toContain("- stepsToReproduce:");
    expect(sys).not.toContain("- description:");
    expect(sys).not.toContain("- expectedResult:");
    expect(sys).not.toContain("- notes:");

    expect(calls[0].fewShot).toEqual(COMPACT_DRAFT_FEW_SHOT);

    const opts = promptCalls[0].options as { responseSchema: unknown };
    expect(opts.responseSchema).toEqual(buildAiDraftSchema(["stepsToReproduce"]));
  });

  it("provider가 LlmQuotaError를 던지면 그대로 전파한다", async () => {
    const { createSession } = makeCreateSession(async () => {
      throw new LlmQuotaError();
    });
    await expect(generateReproStepsWithAI(baseInput(createSession))).rejects.toBeInstanceOf(
      LlmQuotaError,
    );
  });

  it("provider가 LlmAuthError를 던지면 그대로 전파한다", async () => {
    const { createSession } = makeCreateSession(async () => {
      throw new LlmAuthError();
    });
    await expect(generateReproStepsWithAI(baseInput(createSession))).rejects.toBeInstanceOf(
      LlmAuthError,
    );
  });

  it("그 밖의 에러도 그대로 전파한다", async () => {
    const { createSession } = makeCreateSession(async () => {
      throw new Error("network boom");
    });
    await expect(generateReproStepsWithAI(baseInput(createSession))).rejects.toThrow(
      "network boom",
    );
  });

  it("응답의 stepsToReproduce가 빈 문자열이면 LlmEmptyResponseError를 던진다", async () => {
    const { createSession } = makeCreateSession(
      async () => '{"title":"T","stepsToReproduce":""}',
    );
    await expect(generateReproStepsWithAI(baseInput(createSession))).rejects.toBeInstanceOf(
      LlmEmptyResponseError,
    );
  });

  it("파싱 불가 응답이면 LlmEmptyResponseError를 던진다", async () => {
    const { createSession } = makeCreateSession(async () => "not json at all");
    await expect(generateReproStepsWithAI(baseInput(createSession))).rejects.toBeInstanceOf(
      LlmEmptyResponseError,
    );
  });

  it("파싱 실패를 경고로 남기되 raw 응답 본문은 싣지 않는다 (액션 로그 파생 입력값 잔류 방지)", async () => {
    vi.mocked(console.warn).mockClear();
    const { createSession } = makeCreateSession(async () => "not json: typed p@ssw0rd");
    await expect(generateReproStepsWithAI(baseInput(createSession))).rejects.toBeInstanceOf(
      LlmEmptyResponseError,
    );
    expect(console.warn).toHaveBeenCalled();
    const logged = vi.mocked(console.warn).mock.calls.flat().join(" ");
    expect(logged).not.toContain("p@ssw0rd");
  });
});

// issue #204: 재현 단계 자동채움도 같은 AiDraftSessionContext를 재사용하므로 출력 언어가
// 따라와야 한다. 한 이슈 안에서 본문과 재현 단계의 언어가 갈리면 그게 더 나쁘다.
describe("generateReproStepsWithAI — 출력 언어", () => {
  const richInput = (
    createSession: AIProvider["createSession"],
    over: { locale?: "ko" | "en"; aiLanguage?: string } = {},
  ) => ({
    ...baseInput(createSession),
    capabilities: BYOK_CAPABILITIES,
    ...over,
  });

  it("aiLanguage 선택이 재현 단계 프롬프트에 실린다 (en UI + French)", async () => {
    const { createSession, calls } = makeCreateSession(
      async () => '{"stepsToReproduce":"Open X"}',
    );
    await generateReproStepsWithAI(
      richInput(createSession, { locale: "en", aiLanguage: "French" }),
    );
    expect(calls[0].systemPrompt).toContain("Write a bug report in French");
  });

  it("미지정(auto)이면 UI 로케일을 따른다", async () => {
    const { createSession, calls } = makeCreateSession(
      async () => '{"stepsToReproduce":"Open X"}',
    );
    await generateReproStepsWithAI(richInput(createSession, { locale: "ko" }));
    expect(calls[0].systemPrompt).toContain("Write a bug report in Korean");
  });
});
