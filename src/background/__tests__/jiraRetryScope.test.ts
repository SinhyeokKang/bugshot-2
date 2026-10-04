import { describe, expect, it } from "vitest";
import { IMAGE_PLACEHOLDER, inlineImagePlaceholder } from "@/lib/adf-sentinels";
import { buildJiraDescriptionContent } from "../messages";

// A retry sends the latest remote description with only our slot nodes restored to placeholders;
// the render must leave every other node — user prose that happens to look like ours — as it is.
const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (content: unknown[]) => ({ version: 1 as const, type: "doc" as const, content });
const media = { kind: "media" as const, mediaId: "m-1" };

describe("buildJiraDescriptionContent limited to retry slots", () => {
  it("renders the slot placeholder and leaves look-alike user nodes untouched", () => {
    const user = [paragraph("logs.html"), paragraph(IMAGE_PLACEHOLDER), paragraph(inlineImagePlaceholder("r9"))];
    const content = buildJiraDescriptionContent({
      description: doc([paragraph("Intro"), paragraph(IMAGE_PLACEHOLDER), ...user]),
      uploadMap: new Map([["screenshot.webp", media]]),
      logsUrl: "https://acme.atlassian.net/secure/attachment/3/logs.html",
      bodyLocale: "en",
      only: new Set([1]),
    });
    expect((content[1] as { type: string }).type).toBe("mediaSingle");
    expect(content.slice(2)).toEqual(user);
    expect(content[0]).toEqual(paragraph("Intro"));
  });

  it("renders the whole description when no slots are given (initial submission)", () => {
    const content = buildJiraDescriptionContent({ description: doc([paragraph(IMAGE_PLACEHOLDER), paragraph(IMAGE_PLACEHOLDER)]), uploadMap: new Map([["screenshot.webp", media]]), bodyLocale: "en" });
    expect((content[0] as { type: string }).type).toBe("mediaSingle");
  });
});
