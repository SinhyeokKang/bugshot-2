import { describe, it, expect } from "vitest";
import { injectLogsLink, LOGS_LINK_LABEL } from "../adf-logs-link";

function logsParagraph() {
  return {
    type: "paragraph",
    content: [
      { type: "text", text: "첨부된 ", marks: [{ type: "em" }] },
      { type: "text", text: LOGS_LINK_LABEL, marks: [{ type: "em" }] },
      { type: "text", text: "을 열면…", marks: [{ type: "em" }] },
    ],
  };
}

describe("injectLogsLink", () => {
  it("adds a link mark to the logs.html text node", () => {
    const content = [logsParagraph()];
    const linked = injectLogsLink(content, "https://x.atlassian.net/secure/attachment/1/logs.html");
    expect(linked).toBe(true);
    const node = (content[0] as { content: { text: string; marks: { type: string; attrs?: unknown }[] }[] }).content[1];
    expect(node.marks).toEqual([
      { type: "em" },
      { type: "link", attrs: { href: "https://x.atlassian.net/secure/attachment/1/logs.html" } },
    ]);
  });

  it("returns false and leaves content untouched when no logs.html node exists", () => {
    const content = [
      { type: "paragraph", content: [{ type: "text", text: "no match here" }] },
    ];
    const before = JSON.stringify(content);
    expect(injectLogsLink(content, "https://x/y")).toBe(false);
    expect(JSON.stringify(content)).toBe(before);
  });

  it("does not double-link a node that already has a link mark", () => {
    const content = [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: LOGS_LINK_LABEL,
            marks: [{ type: "em" }, { type: "link", attrs: { href: "https://old/url" } }],
          },
        ],
      },
    ];
    expect(injectLogsLink(content, "https://new/url")).toBe(false);
    const node = (content[0] as { content: { marks: { type: string; attrs?: { href?: string } }[] }[] }).content[0];
    expect(node.marks.filter((m) => m.type === "link")).toHaveLength(1);
    expect(node.marks.find((m) => m.type === "link")?.attrs?.href).toBe("https://old/url");
  });

  it("ignores non-paragraph nodes and nodes without content", () => {
    const content = [
      { type: "rule" },
      { type: "heading", attrs: { level: 2 } },
      logsParagraph(),
    ];
    expect(injectLogsLink(content, "https://x/y")).toBe(true);
  });
});
