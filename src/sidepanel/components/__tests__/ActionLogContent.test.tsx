import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActionLogContent } from "../ActionLogContent";
import type { ActionEntry } from "@/types/action";

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
  t: (key: string) => key,
  dateBcp47: () => "en-US",
}));

const ENTRIES: ActionEntry[] = [
  { id: "a1", kind: "click", timestamp: 1000, pageUrl: "https://example.com/", target: "Submit" },
];

function row(id: string): HTMLElement {
  const el = document.querySelector(`[data-entry-id="${id}"]`);
  if (!el) throw new Error(`row ${id} not found`);
  return el as HTMLElement;
}

describe("ActionLogContent — mono 표면", () => {
  it("콘텐츠 span이 font-mono다(콘솔 인라인과 통일)", () => {
    render(<ActionLogContent entries={ENTRIES} />);
    const content = row("a1").querySelector(".flex-1") as HTMLElement;
    expect(content.className).toContain("font-mono");
  });

  it("콘텐츠 span에 leading-relaxed가 남지 않는다(text-xs 16px 행간에 합류)", () => {
    render(<ActionLogContent entries={ENTRIES} />);
    const content = row("a1").querySelector(".flex-1") as HTMLElement;
    expect(content.className).not.toContain("leading-relaxed");
  });
});
