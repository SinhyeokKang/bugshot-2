import { describe, it, expect, vi } from "vitest";

vi.mock("@/i18n", () => ({
  t: (key: string) => key,
  dateBcp47: () => "en-US",
}));

vi.mock("@/store/settings-ui-store", () => ({
  POST_MEDIA_SECTION_IDS: new Set(["expectedResult", "notes"]),
  sectionMdLabelKey: (id: string) => `md.section.${id}`,
}));

vi.mock("@/lib/element-label", () => ({
  formatElementName: () => "div",
}));

import {
  AI_META_FILENAME,
  buildAiMetaAttachment,
} from "../buildAiMetaAttachment";
import type { MarkdownContext } from "../buildIssueMarkdown";

describe("buildAiMetaAttachment", () => {
  it("AI_META_FILENAME은 'bugshot.md' (placeholder 없음 — Jira/Linear/Notion 공통)", () => {
    expect(AI_META_FILENAME).toBe("bugshot.md");
  });

  it("결과 attachment의 filename은 AI_META_FILENAME과 동일", () => {
    const ctx: MarkdownContext = {
      captureMode: "screenshot",
      title: "T",
      sections: {},
      sectionConfig: [],
      url: "https://x.com",
      selector: "",
      tagName: "",
      classListBefore: [],
      classListAfter: [],
      specifiedStyles: {},
      tokens: [],
      viewport: { width: 1, height: 1 },
      capturedAt: 0,
      diffs: [],
    };
    const att = buildAiMetaAttachment(ctx);
    expect(att.filename).toBe("bugshot.md");
    expect(att.dataUrl.startsWith("data:text/markdown;base64,")).toBe(true);
  });
});
