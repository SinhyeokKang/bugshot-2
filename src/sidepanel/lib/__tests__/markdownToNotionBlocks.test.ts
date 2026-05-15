import { describe, it, expect, vi } from "vitest";

vi.mock("@/i18n", () => ({
  t: (key: string, params?: Record<string, string | number>) => {
    if (params) {
      let s = key;
      for (const [k, v] of Object.entries(params)) s += ` ${k}=${v}`;
      return s;
    }
    return key;
  },
}));

import { markdownToNotionBlocks } from "../markdownToNotionBlocks";

describe("markdownToNotionBlocks", () => {
  it("plain text → rich_paragraph", () => {
    const result = markdownToNotionBlocks("hello world");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("rich_paragraph");
    if (result[0].type !== "rich_paragraph") return;
    expect(result[0].richText).toHaveLength(1);
    expect(result[0].richText[0].text.content).toBe("hello world");
  });

  it("**bold** → bold annotation", () => {
    const result = markdownToNotionBlocks("**bold text**");
    expect(result[0].type).toBe("rich_paragraph");
    if (result[0].type !== "rich_paragraph") return;
    const boldItem = result[0].richText.find((rt) => rt.annotations?.bold);
    expect(boldItem).toBeDefined();
    expect(boldItem!.text.content).toBe("bold text");
  });

  it("*italic* → italic annotation", () => {
    const result = markdownToNotionBlocks("*italic text*");
    expect(result[0].type).toBe("rich_paragraph");
    if (result[0].type !== "rich_paragraph") return;
    const italicItem = result[0].richText.find((rt) => rt.annotations?.italic);
    expect(italicItem).toBeDefined();
    expect(italicItem!.text.content).toBe("italic text");
  });

  it("~~strike~~ → strikethrough annotation", () => {
    const result = markdownToNotionBlocks("~~deleted~~");
    expect(result[0].type).toBe("rich_paragraph");
    if (result[0].type !== "rich_paragraph") return;
    const strikeItem = result[0].richText.find(
      (rt) => rt.annotations?.strikethrough,
    );
    expect(strikeItem).toBeDefined();
    expect(strikeItem!.text.content).toBe("deleted");
  });

  it("`code` → code annotation", () => {
    const result = markdownToNotionBlocks("`inline code`");
    expect(result[0].type).toBe("rich_paragraph");
    if (result[0].type !== "rich_paragraph") return;
    const codeItem = result[0].richText.find((rt) => rt.annotations?.code);
    expect(codeItem).toBeDefined();
    expect(codeItem!.text.content).toBe("inline code");
  });

  it("[link](url) → richText with link", () => {
    const result = markdownToNotionBlocks("[click](https://example.com)");
    expect(result[0].type).toBe("rich_paragraph");
    if (result[0].type !== "rich_paragraph") return;
    const linkItem = result[0].richText.find((rt) => rt.text.link);
    expect(linkItem).toBeDefined();
    expect(linkItem!.text.content).toBe("click");
    expect(linkItem!.text.link!.url).toBe("https://example.com");
  });

  it("- item1\\n- item2 → rich_bulleted_list_item 블록", () => {
    const result = markdownToNotionBlocks("- item1\n- item2");
    const bullets = result.filter(
      (b) => b.type === "rich_bulleted_list_item",
    );
    expect(bullets.length).toBe(2);
    if (bullets[0].type !== "rich_bulleted_list_item") return;
    expect(bullets[0].richText[0].text.content).toBe("item1");
  });

  it("1. first\\n2. second → rich_numbered_list_item 블록", () => {
    const result = markdownToNotionBlocks("1. first\n2. second");
    const numbered = result.filter(
      (b) => b.type === "rich_numbered_list_item",
    );
    expect(numbered.length).toBe(2);
    if (numbered[0].type !== "rich_numbered_list_item") return;
    expect(numbered[0].richText[0].text.content).toBe("first");
  });

  it("--- → divider 블록", () => {
    const result = markdownToNotionBlocks("before\n\n---\n\nafter");
    const dividers = result.filter((b) => b.type === "divider");
    expect(dividers.length).toBe(1);
  });

  it("**bold** and *italic* → 혼합 annotation", () => {
    const result = markdownToNotionBlocks("**bold** and *italic*");
    expect(result[0].type).toBe("rich_paragraph");
    if (result[0].type !== "rich_paragraph") return;
    const boldItem = result[0].richText.find((rt) => rt.annotations?.bold);
    const italicItem = result[0].richText.find((rt) => rt.annotations?.italic);
    expect(boldItem).toBeDefined();
    expect(boldItem!.text.content).toBe("bold");
    expect(italicItem).toBeDefined();
    expect(italicItem!.text.content).toBe("italic");
  });

  it("빈 문자열 → noValue paragraph", () => {
    const result = markdownToNotionBlocks("");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("paragraph");
    if (result[0].type !== "paragraph") return;
    expect(result[0].text).toBe("md.noValue");
  });

  it("공백만 → noValue paragraph", () => {
    const result = markdownToNotionBlocks("   \n  ");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("paragraph");
    if (result[0].type !== "paragraph") return;
    expect(result[0].text).toBe("md.noValue");
  });
});
