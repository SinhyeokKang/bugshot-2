import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

  // shadcn Button base는 inline-flex다. 블록 래퍼(MergedSideField의 div.min-w-0.flex-1) 안에
  // 놓이면 인라인 박스가 되어 디센더만큼 행이 높아지고 옆 LinkToggle(h-9)과 정렬이 어긋난다.
  // twMerge display 그룹 중재에 걸린 값이라 className을 정리하다 지우면 무음으로 되돌아간다.
  it("트리거가 blockify돼 라인박스 여백을 만들지 않는다", () => {
    render(<ValueCombobox prop="background-color" />);
    const trigger = screen.getByRole("button");
    expect(trigger.className.split(/\s+/)).toContain("flex");
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

// Enter는 cmdk의 "하이라이트 항목 선택"이라, 무엇이 하이라이트냐가 곧 Enter의 의미다.
// 현재는 Enter를 통째로 preventDefault해 자유입력을 확정할 수단이 없다(Esc·바깥 클릭뿐).
describe("ValueCombobox 자유입력 Enter 확정", () => {
  // controlled set은 store를 갱신해 value로 되돌아온다 — mock으로 끊으면 draft가 매 글자
  // 리셋돼(자기 변경 재싱크 가드) 실제와 다른 경로를 테스트하게 된다.
  function Harness({
    initial,
    prop,
    placeholder = "",
    set,
  }: {
    initial: string;
    prop: string;
    placeholder?: string;
    set: (v: string) => void;
  }) {
    const [value, setValue] = useState(initial);
    return (
      <ValueCombobox
        prop={prop}
        controlled={{
          value,
          placeholder,
          set: (v) => {
            set(v);
            setValue(v);
          },
        }}
      />
    );
  }

  function openWith(value: string, prop = "padding-top", placeholder = "") {
    const set = vi.fn();
    render(
      <Harness
        initial={value}
        prop={prop}
        placeholder={placeholder}
        set={set}
      />,
    );
    return { set, user: userEvent.setup() };
  }

  const input = () => screen.getByPlaceholderText("value.placeholder");

  it("기존 값이 있어 액션이 먼저 선택된 상태에서도 타이핑 후 Enter가 입력값을 확정한다", async () => {
    const { set, user } = openWith("10px");
    await user.click(screen.getByRole("button"));
    await user.clear(input());
    await user.type(input(), "24px");
    set.mockClear(); // 타이핑 중 라이브 적용분 제외
    await user.keyboard("{Enter}");
    expect(set).toHaveBeenLastCalledWith("24px");
    await waitFor(() =>
      expect(screen.queryByPlaceholderText("value.placeholder")).toBeNull(),
    );
  });

  it("입력이 비었으면 Enter가 초기화·unset을 실행하지 않고 팝오버도 유지한다", async () => {
    const { set, user } = openWith("");
    await user.click(screen.getByRole("button"));
    await screen.findByPlaceholderText("value.placeholder");
    set.mockClear();
    await user.keyboard("{Enter}");
    expect(set).not.toHaveBeenCalled();
    expect(input()).toBeTruthy();
  });

  it("타이핑 후 ArrowDown으로 토큰으로 옮기면 Enter가 토큰을 확정한다", async () => {
    const { set, user } = openWith("", "background-color");
    await user.click(screen.getByRole("button"));
    await user.type(input(), "col");
    set.mockClear();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(set).toHaveBeenLastCalledWith(`var(${LONG_TOKEN})`);
  });

  it("ArrowLeft로 입력 커서를 옮긴 뒤 Enter해도 현재 입력을 확정한다", async () => {
    const { set, user } = openWith("", "background-color");
    await user.click(screen.getByRole("button"));
    await user.type(input(), "col");
    await user.hover(screen.getByText(LONG_TOKEN));
    set.mockClear();
    await user.keyboard("{ArrowLeft}{Enter}");
    expect(set).not.toHaveBeenCalledWith(`var(${LONG_TOKEN})`);
    expect(set).toHaveBeenLastCalledWith("col");
  });

  it("cmdk의 vim 바인딩(Ctrl+N)으로 옮긴 뒤 Enter도 토큰을 확정한다", async () => {
    // cmdk는 vimBindings 기본값이 켜져 있어 Ctrl+N/P/J/K로도 목록을 옮긴다 —
    // 방향키만 래치하면 그 경로가 자유입력 확정으로 새어 엉뚱한 값이 들어간다.
    const { set, user } = openWith("", "background-color");
    await user.click(screen.getByRole("button"));
    await user.type(input(), "col");
    set.mockClear();
    await user.keyboard("{Control>}n{/Control}{Enter}");
    expect(set).toHaveBeenLastCalledWith(`var(${LONG_TOKEN})`);
  });

  it("미정의 토큰 참조(var(--unknown))도 자유입력으로 확정된다", async () => {
    const { set, user } = openWith("");
    await user.click(screen.getByRole("button"));
    await user.type(input(), "var(--unknown)");
    set.mockClear();
    await user.keyboard("{Enter}");
    expect(set).toHaveBeenLastCalledWith("var(--unknown)");
  });

  it("Enter 확정은 finalize를 태운다 — 단축 hex 확장", async () => {
    const { set, user } = openWith("", "background-color");
    await user.click(screen.getByRole("button"));
    await user.type(input(), "#abc");
    set.mockClear();
    await user.keyboard("{Enter}");
    expect(set).toHaveBeenLastCalledWith("#aabbcc");
  });

  it("Enter 확정은 finalize를 태운다 — length 단위 부착", async () => {
    const { set, user } = openWith("");
    await user.click(screen.getByRole("button"));
    await user.type(input(), "12");
    set.mockClear();
    await user.keyboard("{Enter}");
    expect(set).toHaveBeenLastCalledWith("12px");
  });

  it("입력 중에는 초기화·unset을 감춰 하이라이트와 Enter 결과가 어긋나지 않는다", async () => {
    const { user } = openWith("10px", "padding-top", "8px");
    await user.click(screen.getByRole("button"));
    expect(screen.queryByText("value.reset")).toBeTruthy();
    await user.type(input(), "9");
    expect(screen.queryByText("value.reset")).toBeNull();
    expect(screen.queryByText("value.unset")).toBeNull();
  });

  it("입력을 비우면 unset을 다시 표시한다", async () => {
    const { user } = openWith("10px", "padding-top", "8px");
    await user.click(screen.getByRole("button"));
    await user.type(input(), "9");
    await user.clear(input());
    expect(screen.queryByText("value.reset")).toBeNull();
    expect(screen.queryByText("value.unset")).toBeTruthy();
  });

  it("IME 조합 중 Enter는 확정하지 않는다", async () => {
    const { set, user } = openWith("");
    await user.click(screen.getByRole("button"));
    await user.type(input(), "12");
    set.mockClear();
    fireEvent.keyDown(input(), { key: "Enter", isComposing: true, keyCode: 229 });
    expect(set).not.toHaveBeenCalled();
    expect(input()).toBeTruthy();
  });

  it("IME 조합 중 Enter의 브라우저 기본 동작은 취소하지 않는다", async () => {
    const { user } = openWith("");
    await user.click(screen.getByRole("button"));
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    fireEvent(input(), event);
    expect(event.defaultPrevented).toBe(false);
  });
});
