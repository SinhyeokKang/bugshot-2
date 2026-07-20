import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActionLogContent } from "../ActionLogContent";
import type { ActionEntry } from "@/types/action";

const VERB_TEMPLATES: Record<string, string> = {
  "actionLog.verb.input": "Entered {value} in {field}",
  "actionLog.verb.drag": "Dragged {source}",
};

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => VERB_TEMPLATES[key] ?? key,
  t: (key: string) => key,
  dateBcp47: () => "en-US",
}));

const ENTRIES: ActionEntry[] = [
  { id: "a1", kind: "click", timestamp: 1000, pageUrl: "https://example.com/", target: "Submit" },
];

const CHIP_ENTRIES: ActionEntry[] = [
  { id: "in1", kind: "input", timestamp: 2000, pageUrl: "https://example.com/", fieldLabel: "Email", value: "hello@example.com" },
  { id: "in2", kind: "input", timestamp: 3000, pageUrl: "https://example.com/", fieldLabel: "Password", masked: true },
  { id: "dr1", kind: "drag", timestamp: 4000, pageUrl: "https://example.com/", dragSource: { name: "10743" } },
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

  it("콘텐츠 span에 leading-relaxed가 남지 않는다(text-mono 18px 행간에 합류)", () => {
    render(<ActionLogContent entries={ENTRIES} />);
    const content = row("a1").querySelector(".flex-1") as HTMLElement;
    expect(content.className).not.toContain("leading-relaxed");
  });
});

describe("ActionLogContent — Kbd chip 통일", () => {
  it("input value chip이 shadcn Kbd로 렌더 + testid 보존", () => {
    render(<ActionLogContent entries={CHIP_ENTRIES} />);
    const chip = row("in1").querySelector('[data-testid="action-value-chip"]') as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.getAttribute("data-slot")).toBe("kbd");
  });

  it("masked input chip도 Kbd + testid + aria-label 보존", () => {
    render(<ActionLogContent entries={CHIP_ENTRIES} />);
    const chip = row("in2").querySelector('[data-testid="action-value-chip"]') as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.getAttribute("data-slot")).toBe("kbd");
    expect(chip.getAttribute("aria-label")).toBe("actionLog.maskedValue");
  });

  it("drag source chip이 Kbd로 렌더", () => {
    render(<ActionLogContent entries={CHIP_ENTRIES} />);
    const chip = row("dr1").querySelector('[data-slot="kbd"]') as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain("10743");
  });
});
