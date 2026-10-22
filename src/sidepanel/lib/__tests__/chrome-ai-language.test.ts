import { describe, expect, it } from "vitest";
import { buildCompactStylingPrompt } from "../prompts/stylingCompact";
import { buildAiDraftTurns } from "../buildAiDraftPrompt";
import { NANO_CAPABILITIES, LOCAL_BYOK_CAPABILITIES } from "../ai-provider";

describe("Chrome compact language contract", () => {
  it("uses the provider output language in draft and styling instructions", () => {
    const caps = { ...NANO_CAPABILITIES, outputLanguage: "Japanese" as const };
    expect(buildAiDraftTurns({ caps, locale: "en", captureMode: "video", url: "https://example.com", pageTitle: "Test", enabledSections: [] }).system).toContain("Write in Japanese.");
    const styling = buildCompactStylingPrompt({ caps, tagName: "button", selector: "button", classList: [], specifiedStyles: {}, tokens: [] });
    expect(styling).toContain("Write explanation in Japanese.");
    expect(styling).not.toContain("Korean if");
  });
  it("keeps Ollama compact locale and user language behavior", () => {
    expect(buildAiDraftTurns({ caps: LOCAL_BYOK_CAPABILITIES, locale: "ko", captureMode: "video", url: "https://example.com", pageTitle: "Test", enabledSections: [] }).system).toContain("Write in Korean.");
    expect(buildCompactStylingPrompt({ caps: LOCAL_BYOK_CAPABILITIES, tagName: "button", selector: "button", classList: [], specifiedStyles: {}, tokens: [] })).toContain("Korean if the user writes Korean");
  });
});
