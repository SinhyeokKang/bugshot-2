import { describe, it, expect, vi } from "vitest";
import { generateReproStepsWithAI } from "../generateReproPrefill";
import { LlmQuotaError, LlmAuthError, NANO_CAPABILITIES } from "../ai-provider";
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

describe("generateReproStepsWithAI", () => {
  it("성공 시 stepsToReproduce만 추출하고 title은 무시한다", async () => {
    const { createSession } = makeCreateSession(
      async () => '{"title":"Ignore me","stepsToReproduce":"Open X\\nClick Y"}',
    );
    const r = await generateReproStepsWithAI(baseInput(createSession));
    expect(r).toEqual({ ok: true, steps: "Open X\nClick Y" });
  });

  it("stepsToReproduce 단일 섹션으로 좁히고 few-shot·스키마를 실어 호출한다", async () => {
    const { createSession, calls, promptCalls } = makeCreateSession(
      async () => '{"title":"T","stepsToReproduce":"s"}',
    );
    await generateReproStepsWithAI(baseInput(createSession));

    const sys = calls[0].systemPrompt;
    expect(sys).toContain("stepsToReproduce");
    // 다른 섹션 설명(compact SECTION_DESC.en)은 프롬프트에 없어야 한다.
    expect(sys).not.toContain("what is broken now"); // description
    expect(sys).not.toContain("what should happen instead"); // expectedResult
    expect(sys).not.toContain("any other context"); // notes

    expect(calls[0].fewShot).toEqual(COMPACT_DRAFT_FEW_SHOT);

    const opts = promptCalls[0].options as { responseSchema: unknown };
    expect(opts.responseSchema).toEqual(buildAiDraftSchema(["stepsToReproduce"]));
  });

  it("provider가 LlmQuotaError를 던지면 reason:'quota'", async () => {
    const { createSession } = makeCreateSession(async () => {
      throw new LlmQuotaError();
    });
    expect(await generateReproStepsWithAI(baseInput(createSession))).toEqual({
      ok: false,
      reason: "quota",
    });
  });

  it("provider가 LlmAuthError를 던지면 reason:'auth'", async () => {
    const { createSession } = makeCreateSession(async () => {
      throw new LlmAuthError();
    });
    expect(await generateReproStepsWithAI(baseInput(createSession))).toEqual({
      ok: false,
      reason: "auth",
    });
  });

  it("그 밖의 에러면 reason:'other'", async () => {
    const { createSession } = makeCreateSession(async () => {
      throw new Error("network boom");
    });
    expect(await generateReproStepsWithAI(baseInput(createSession))).toEqual({
      ok: false,
      reason: "other",
    });
  });

  it("응답의 stepsToReproduce가 빈 문자열이면 reason:'other'", async () => {
    const { createSession } = makeCreateSession(
      async () => '{"title":"T","stepsToReproduce":""}',
    );
    expect(await generateReproStepsWithAI(baseInput(createSession))).toEqual({
      ok: false,
      reason: "other",
    });
  });

  it("파싱 불가 응답이면 reason:'other'", async () => {
    const { createSession } = makeCreateSession(async () => "not json at all");
    expect(await generateReproStepsWithAI(baseInput(createSession))).toEqual({
      ok: false,
      reason: "other",
    });
  });
});
