import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  // 값 칩은 mono 표면이라 형제 행 텍스트(text-mono=13px)와 같은 크기여야 한다. Kbd 기본 text-xs를
  // CHIP_CLS가 text-mono로 덮지 않으면 한 줄에 13px 텍스트 + 12px 칩이 섞인다(POSTMORTEM 2026-07-17
  // "표면 하나 누락" 재발 패턴). tailwind-merge라 렌더된 className에 text-xs가 남으면 안 덮였다는 뜻.
  it("input value chip이 text-mono로 렌더된다 (Kbd 기본 text-xs를 덮음)", () => {
    render(<ActionLogContent entries={CHIP_ENTRIES} />);
    const chip = row("in1").querySelector('[data-testid="action-value-chip"]') as HTMLElement;
    expect(chip.className).toContain("text-mono");
    expect(chip.className).not.toContain("text-xs");
  });
});

describe("ActionLogContent — 영상 seek 동기화(onSeek 공급)", () => {
  it("행 클릭이 onSeek(timestamp)을 발화한다", async () => {
    const onSeek = vi.fn();
    render(<ActionLogContent entries={ENTRIES} syncBaseMs={0} onSeek={onSeek} />);

    await userEvent.click(row("a1"));

    expect(onSeek).toHaveBeenCalledWith(1000);
  });

  it("mm:ss 칩 클릭은 stopPropagation으로 onSeek을 한 번만 발화(행 이중발화 없음)", async () => {
    const onSeek = vi.fn();
    render(<ActionLogContent entries={ENTRIES} syncBaseMs={0} onSeek={onSeek} />);

    const chip = row("a1").querySelector('[data-testid="log-rel-time"]') as HTMLElement;
    await userEvent.click(chip);

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(1000);
  });
});
