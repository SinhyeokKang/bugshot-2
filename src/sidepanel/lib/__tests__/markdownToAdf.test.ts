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

import { markdownToAdf } from "../markdownToAdf";

function findAllNodes(nodes: any[], type: string): any[] {
  const result: any[] = [];
  function walk(node: any) {
    if (node.type === type) result.push(node);
    if (node.content) node.content.forEach(walk);
  }
  nodes.forEach(walk);
  return result;
}

function findAllText(nodes: any[]): any[] {
  return findAllNodes(nodes, "text");
}

function findMarks(nodes: any[], markType: string): any[] {
  return findAllText(nodes).filter(
    (n) => n.marks?.some((m: any) => m.type === markType),
  );
}

describe("markdownToAdf", () => {
  it("plain text → paragraph + textNode", () => {
    const result = markdownToAdf("hello world");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("paragraph");
    const texts = findAllText(result);
    expect(texts.some((t) => t.text === "hello world")).toBe(true);
  });

  it("**bold** → strong mark", () => {
    const result = markdownToAdf("**bold text**");
    const strongs = findMarks(result, "strong");
    expect(strongs.length).toBeGreaterThanOrEqual(1);
    expect(strongs[0].text).toBe("bold text");
  });

  it("*italic* → em mark", () => {
    const result = markdownToAdf("*italic text*");
    const ems = findMarks(result, "em");
    expect(ems.length).toBeGreaterThanOrEqual(1);
    expect(ems[0].text).toBe("italic text");
  });

  it("`code` → code mark", () => {
    const result = markdownToAdf("`inline code`");
    const codes = findMarks(result, "code");
    expect(codes.length).toBeGreaterThanOrEqual(1);
    expect(codes[0].text).toBe("inline code");
  });

  it("~~strike~~ → strike mark", () => {
    const result = markdownToAdf("~~deleted~~");
    const strikes = findMarks(result, "strike");
    expect(strikes.length).toBeGreaterThanOrEqual(1);
    expect(strikes[0].text).toBe("deleted");
  });

  it("[link](url) → link mark", () => {
    const result = markdownToAdf("[click here](https://example.com)");
    const links = findMarks(result, "link");
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0].text).toBe("click here");
    expect(links[0].marks.find((m: any) => m.type === "link").attrs.href).toBe(
      "https://example.com",
    );
  });

  it("**bold** and *italic* → 각각 올바른 mark", () => {
    const result = markdownToAdf("**bold** and *italic*");
    const strongs = findMarks(result, "strong");
    const ems = findMarks(result, "em");
    expect(strongs.some((t) => t.text === "bold")).toBe(true);
    expect(ems.some((t) => t.text === "italic")).toBe(true);
  });

  it("- item1\\n- item2 → bulletList", () => {
    const result = markdownToAdf("- item1\n- item2");
    const bullets = findAllNodes(result, "bulletList");
    expect(bullets.length).toBe(1);
    const items = findAllNodes(bullets, "listItem");
    expect(items.length).toBe(2);
  });

  it("1. first\\n2. second → orderedList", () => {
    const result = markdownToAdf("1. first\n2. second");
    const ordered = findAllNodes(result, "orderedList");
    expect(ordered.length).toBe(1);
    const items = findAllNodes(ordered, "listItem");
    expect(items.length).toBe(2);
  });

  it("--- → rule 노드", () => {
    const result = markdownToAdf("before\n\n---\n\nafter");
    const rules = findAllNodes(result, "rule");
    expect(rules.length).toBe(1);
  });

  it("softbreak → hardBreak", () => {
    const result = markdownToAdf("line1\nline2");
    const breaks = findAllNodes(result, "hardBreak");
    expect(breaks.length).toBeGreaterThanOrEqual(1);
  });

  it("hard break (backslash+newline) → hardBreak", () => {
    const result = markdownToAdf("line1\\\nline2");
    const breaks = findAllNodes(result, "hardBreak");
    expect(breaks.length).toBe(1);
    const texts = findAllText(result);
    expect(texts.some((t) => t.text === "line1")).toBe(true);
    expect(texts.some((t) => t.text === "line2")).toBe(true);
  });

  it("bare URL → link mark (linkify)", () => {
    const result = markdownToAdf("visit https://example.com today");
    const links = findMarks(result, "link");
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0].text).toBe("https://example.com");
    expect(links[0].marks.find((m: any) => m.type === "link").attrs.href).toBe(
      "https://example.com",
    );
  });

  it("```code``` → codeBlock", () => {
    const result = markdownToAdf("```js\nconsole.log(1)\n```");
    const codeBlocks = findAllNodes(result, "codeBlock");
    expect(codeBlocks.length).toBe(1);
    expect(codeBlocks[0].attrs?.language).toBe("js");
    const texts = findAllText(codeBlocks);
    expect(texts[0].text).toBe("console.log(1)\n");
  });

  it("```code``` without language → codeBlock without language attr", () => {
    const result = markdownToAdf("```\nhello\n```");
    const codeBlocks = findAllNodes(result, "codeBlock");
    expect(codeBlocks.length).toBe(1);
    expect(codeBlocks[0].attrs).toBeUndefined();
  });

  it("> quote → blockquote", () => {
    const result = markdownToAdf("> quoted text");
    const blockquotes = findAllNodes(result, "blockquote");
    expect(blockquotes.length).toBe(1);
    const paragraphs = findAllNodes(blockquotes, "paragraph");
    expect(paragraphs.length).toBe(1);
    const texts = findAllText(blockquotes);
    expect(texts.some((t) => t.text === "quoted text")).toBe(true);
  });

  it("> **bold** inside blockquote → blockquote with strong mark", () => {
    const result = markdownToAdf("> **bold text**");
    const blockquotes = findAllNodes(result, "blockquote");
    expect(blockquotes.length).toBe(1);
    const strongs = findMarks(blockquotes[0].content!, "strong");
    expect(strongs.length).toBe(1);
    expect(strongs[0].text).toBe("bold text");
  });

  it("빈 문자열 → noValue paragraph", () => {
    const result = markdownToAdf("");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("paragraph");
    const texts = findAllText(result);
    expect(texts.some((t) => t.text === "md.noValue")).toBe(true);
  });

  it("공백만 → noValue paragraph", () => {
    const result = markdownToAdf("   \n  ");
    expect(result).toHaveLength(1);
    const texts = findAllText(result);
    expect(texts.some((t) => t.text === "md.noValue")).toBe(true);
  });
});
