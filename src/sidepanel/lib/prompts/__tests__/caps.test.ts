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
  it("모든 축이 두 style에 정의됨", () => {
    for (const style of ["compact", "rich"] as const) {
      for (const key of CAP_KEYS) {
        expect(PROMPT_CAPS[style][key]).toBeGreaterThan(0);
      }
    }
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
