import { describe, it, expect } from "vitest";
import { PROMPT_CAPS, type PromptCaps } from "../caps";

const CAP_KEYS: (keyof PromptCaps)[] = [
  "diffs",
  "designTokens",
  "styles",
  "networkErrors",
  "consoleErrors",
  "actions",
  "existingDraftChars",
  "userPromptChars",
];

describe("PROMPT_CAPS", () => {
  it("compact 캡이 나노 예산 기준값", () => {
    expect(PROMPT_CAPS.compact).toEqual({
      diffs: 8,
      designTokens: 5,
      styles: 12,
      networkErrors: 3,
      consoleErrors: 3,
      actions: 5,
      existingDraftChars: 400,
      userPromptChars: 600,
    });
  });

  it("rich 캡이 고급 모델 기준값 — 무제한은 MAX_SAFE_INTEGER", () => {
    expect(PROMPT_CAPS.rich).toEqual({
      diffs: 50,
      designTokens: 40,
      styles: 80,
      networkErrors: 5,
      consoleErrors: 5,
      actions: 20,
      existingDraftChars: Number.MAX_SAFE_INTEGER,
      userPromptChars: Number.MAX_SAFE_INTEGER,
    });
  });

  it("rich 캡이 모든 축에서 compact 이상", () => {
    for (const key of CAP_KEYS) {
      expect(PROMPT_CAPS.rich[key]).toBeGreaterThanOrEqual(
        PROMPT_CAPS.compact[key],
      );
    }
  });

  // JSON.stringify(Infinity) === "null" — 캡 값이 직렬화 경로에 새면 조용히 깨진다.
  it("어떤 캡도 Infinity가 아니다 (직렬화 안전)", () => {
    for (const style of ["compact", "rich"] as const) {
      for (const key of CAP_KEYS) {
        expect(Number.isFinite(PROMPT_CAPS[style][key])).toBe(true);
      }
    }
  });
});
