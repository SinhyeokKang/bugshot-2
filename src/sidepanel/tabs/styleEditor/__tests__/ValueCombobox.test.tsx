import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
  t: (key: string) => key,
}));
vi.mock("@/sidepanel/picker-control", () => ({
  applyStyles: vi.fn(),
  applyClasses: vi.fn(),
}));
vi.mock("@/sidepanel/hooks/useBoundTabId", () => ({
  useBoundTabId: () => 1,
}));

import { ValueCombobox } from "../ValueCombobox";
import { useEditorStore } from "@/store/editor-store";

const LONG_TOKEN = "--color-background-surface-elevated-secondary";

beforeEach(() => {
  useEditorStore.setState({
    selection: {
      selector: "#a",
      tagName: "div",
      classList: [],
      computedStyles: { "background-color": "rgb(255, 255, 255)" },
      specifiedStyles: {},
      propSources: {},
      hasParent: false,
      hasChild: false,
      text: null,
      viewport: { width: 800, height: 600 },
      capturedAt: 0,
      frameId: 0,
    },
    styleEdits: {
      classList: [],
      inlineStyle: { "background-color": `var(${LONG_TOKEN})` },
      text: "",
    },
    tokens: [
      { name: LONG_TOKEN, value: "#ffffff", category: "color" },
    ],
  });
});

// 레이아웃 계층(폭 초과·말줄임)은 jsdom이 못 본다 — className 대조가 유일한 그물이다.
// 이 축이 깨지면 좁은 사이드패널에서 토큰 chip이 인풋 폭을 뚫는다(POSTMORTEM 2026-07-20 계열).
describe("ValueCombobox 토큰 chip 폭 봉쇄", () => {
  it("트리거 버튼이 min-w-0이라 grid 트랙보다 커지지 않는다", () => {
    render(<ValueCombobox prop="background-color" />);
    const trigger = screen.getByRole("button");
    expect(trigger.className).toContain("min-w-0");
  });

  it("chip과 그 이름 span이 축소·말줄임 가능하다", () => {
    render(<ValueCombobox prop="background-color" />);
    const name = screen.getByText(LONG_TOKEN);
    expect(name.className).toContain("min-w-0");
    expect(name.className).toContain("truncate");

    const chip = name.parentElement!;
    expect(chip.className).toContain("min-w-0");
    expect(chip.className).not.toContain("shrink-0");
  });
});
