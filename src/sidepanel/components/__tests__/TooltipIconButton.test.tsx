import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipIconButton } from "../TooltipIconButton";

// label 하나가 aria-label과 툴팁 본문을 겸하고 있어 잠금 사유를 label에 섞으면 접근명이
// "페이지 캡처(디바이스 모드에서 잠김)"가 된다. 사유는 툴팁 본문만 대체해야 한다.
describe("TooltipIconButton — disabledReason", () => {
  it("disabledReason이 없으면 기존 호출부와 동작이 같다", async () => {
    const onClick = vi.fn();
    render(
      <TooltipIconButton label="페이지 캡처" testId="btn" onClick={onClick}>
        <svg />
      </TooltipIconButton>,
    );
    const btn = screen.getByTestId("btn");
    expect(btn.getAttribute("aria-label")).toBe("페이지 캡처");
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disabledReason이 있어도 aria-label은 label 그대로다", () => {
    render(
      <TooltipIconButton
        label="페이지 캡처"
        testId="btn"
        ariaDisabled
        disabledReason="디바이스 모드에서는 사용할 수 없습니다"
      >
        <svg />
      </TooltipIconButton>,
    );
    expect(screen.getByTestId("btn").getAttribute("aria-label")).toBe("페이지 캡처");
  });

  it("disabledReason이 있으면 툴팁 본문이 그걸로 대체된다", async () => {
    render(
      <TooltipIconButton
        label="페이지 캡처"
        testId="btn"
        ariaDisabled
        disabledReason="디바이스 모드에서는 사용할 수 없습니다"
      >
        <svg />
      </TooltipIconButton>,
    );
    await userEvent.hover(screen.getByTestId("btn"));
    expect(
      await screen.findAllByText("디바이스 모드에서는 사용할 수 없습니다"),
    ).not.toHaveLength(0);
  });

  it("ariaDisabled면 클릭이 흡수된다 (disabled 속성이 아니라 aria-disabled)", async () => {
    const onClick = vi.fn();
    render(
      <TooltipIconButton label="페이지 캡처" testId="btn" ariaDisabled onClick={onClick}>
        <svg />
      </TooltipIconButton>,
    );
    const btn = screen.getByTestId("btn");
    expect(btn.hasAttribute("disabled")).toBe(false);
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});
