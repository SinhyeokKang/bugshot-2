import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OriginFilterBar } from "../OriginFilterBar";

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
  t: (key: string) => key,
  dateBcp47: () => "en-US",
}));

const ORIGINS = ["https://example.com", "https://widget.stripe.com"];

function pills(): HTMLElement[] {
  return screen.getAllByTestId("origin-filter");
}

// DESIGN §10의 토글 관용구 ①은 data-active + aria-pressed + cn() 3요소인데, 정규 선례로
// 이름이 박힌 이 컴포넌트가 aria-pressed만 빼고 있었다. 시각 축(data-active)은 이미 e2e가
// 보고, 스크린리더 축은 여기가 유일한 그물이다.
describe("OriginFilterBar — 눌림 상태 노출", () => {
  it("선택된 pill만 aria-pressed=true다", () => {
    render(<OriginFilterBar originKeys={ORIGINS} value={ORIGINS[0]} onChange={vi.fn()} />);

    const [first, second] = pills();
    expect(first.getAttribute("aria-pressed")).toBe("true");
    expect(second.getAttribute("aria-pressed")).toBe("false");
  });

  // 미선택은 속성 누락이 아니라 명시적 false여야 한다 — 누락이면 스크린리더가 토글로 읽지 않는다.
  it("아무것도 선택 안 됐으면 전부 aria-pressed=false다", () => {
    render(<OriginFilterBar originKeys={ORIGINS} value={null} onChange={vi.fn()} />);

    for (const pill of pills()) {
      expect(pill.getAttribute("aria-pressed")).toBe("false");
    }
  });

  it("선택이 바뀌면 aria-pressed가 따라 뒤집힌다", async () => {
    const { rerender } = render(
      <OriginFilterBar originKeys={ORIGINS} value={ORIGINS[0]} onChange={vi.fn()} />,
    );
    rerender(<OriginFilterBar originKeys={ORIGINS} value={ORIGINS[1]} onChange={vi.fn()} />);

    const [first, second] = pills();
    expect(first.getAttribute("aria-pressed")).toBe("false");
    expect(second.getAttribute("aria-pressed")).toBe("true");
  });

  it("클릭이 여전히 onChange를 부른다 (속성 추가가 동작을 안 바꾼다)", async () => {
    const onChange = vi.fn();
    render(<OriginFilterBar originKeys={ORIGINS} value={null} onChange={onChange} />);

    await userEvent.click(pills()[1]);

    expect(onChange).toHaveBeenCalledWith(ORIGINS[1]);
  });

  // 클래스 문자열 보존 = 시각 변화 0. 템플릿 concat → cn() 전환이 이 축을 안 건드리는지 고정한다.
  it("선택 pill의 배경 클래스가 유지된다", () => {
    render(<OriginFilterBar originKeys={ORIGINS} value={ORIGINS[0]} onChange={vi.fn()} />);

    expect(pills()[0].className).toContain("bg-muted");
    expect(pills()[1].className).not.toContain("bg-muted");
  });
});
