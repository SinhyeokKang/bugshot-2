import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
  t: (key: string) => key,
}));
vi.mock("@/sidepanel/picker-control", () => ({
  applyStyles: vi.fn(),
  applyClasses: vi.fn(),
}));
vi.mock("@/sidepanel/hooks/useBoundTabId", () => ({ useBoundTabId: () => 1 }));

import { QuadStyleProp } from "../StylePropEditors";
import { useEditorStore } from "@/store/editor-store";

beforeEach(() => {
  useEditorStore.setState({
    selection: {
      selector: "#a",
      tagName: "div",
      classList: [],
      computedStyles: {
        "border-top-style": "solid",
        "border-right-style": "solid",
        "border-bottom-style": "solid",
        "border-left-style": "solid",
      },
      specifiedStyles: {},
      propSources: {},
      hasParent: false,
      hasChild: false,
      text: null,
      viewport: { width: 800, height: 600 },
      capturedAt: 0,
      frameId: 0,
    },
    styleEdits: { classList: [], inlineStyle: {}, text: "" },
    tokens: [],
  });
});

function linkToggle(): HTMLElement {
  return screen.getByRole("button", { name: "prop.editIndividual" });
}

// 4방향 링크 토글은 DESIGN §10 관용구 ②(강대비)를 raw <button>으로 손복제한 자리다.
// shadcn Button으로 이식하면서 눌림 상태와 강대비 클래스가 유지되는지 잠근다 —
// on 상태의 hover 글자색이 base variant에 먹히면 아이콘이 사라진다(§2 hover 함정).
describe("LinkToggle — 눌림 상태와 강대비", () => {
  it("linked면 aria-pressed=true다", () => {
    render(<QuadStyleProp label="border-style" />);

    expect(linkToggle().getAttribute("aria-pressed")).toBe("true");
  });

  it("linked일 때 강대비 클래스를 갖는다", () => {
    render(<QuadStyleProp label="border-style" />);

    const cls = linkToggle().className.split(/\s+/);
    expect(cls).toContain("bg-foreground");
    expect(cls).toContain("text-background");
    expect(cls).toContain("border-foreground");
  });

  // base variant의 hover:text-accent-foreground가 이기면 on 상태 hover에서 아이콘이 사라진다.
  it("linked일 때 hover 글자색을 명시적으로 덮는다", () => {
    render(<QuadStyleProp label="border-style" />);

    expect(linkToggle().className.split(/\s+/)).toContain("hover:text-background");
  });

  it("토글하면 aria-pressed가 뒤집히고 강대비가 풀린다", async () => {
    render(<QuadStyleProp label="border-style" />);

    await userEvent.click(linkToggle());

    const off = screen.getByRole("button", { name: "prop.editTogether" });
    expect(off.getAttribute("aria-pressed")).toBe("false");
    expect(off.className.split(/\s+/)).not.toContain("bg-foreground");
  });

  // 인접 Input(h-9)에 붙는 컨트롤이라 높이는 h-9로 고정된다(§10).
  it("h-9 w-9 치수를 유지한다", () => {
    render(<QuadStyleProp label="border-style" />);

    const cls = linkToggle().className.split(/\s+/);
    expect(cls).toContain("h-9");
    expect(cls).toContain("w-9");
  });
});
