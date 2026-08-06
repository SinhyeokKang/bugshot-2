import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "../dialog";
import { Popover, PopoverContent, PopoverTrigger } from "../popover";

type OutsideHandler = React.ComponentPropsWithoutRef<
  typeof DialogContent
>["onPointerDownOutside"];

function Harness({ onPointerDownOutside }: { onPointerDownOutside?: OutsideHandler }) {
  const [open, setOpen] = useState(true);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent onPointerDownOutside={onPointerDownOutside}>
        <DialogTitle>이슈 제출</DialogTitle>
        <Popover>
          <PopoverTrigger>프로젝트 선택</PopoverTrigger>
          <PopoverContent>옵션 A</PopoverContent>
        </Popover>
      </DialogContent>
    </Dialog>
  );
}

// Radix DismissableLayer는 outside 리스너를 setTimeout(0)으로 등록한다.
async function settleLayers() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

// dim(overlay) 클릭 = 다이얼로그 콘텐츠 바깥 pointerdown. Radix는 document 리스너로
// 받으므로 body를 타깃으로 발화해도 overlay 클릭과 같은 경로를 탄다.
function pointerDownOutside() {
  fireEvent.pointerDown(document.body);
}

describe("Dialog dim 클릭 가드", () => {
  it("Popover가 열려 있으면 Popover만 닫히고 Dialog는 유지된다", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await settleLayers();

    await user.click(screen.getByText("프로젝트 선택"));
    expect(await screen.findByText("옵션 A")).toBeTruthy();
    await settleLayers();

    pointerDownOutside();

    await waitFor(() => expect(screen.queryByText("옵션 A")).toBeNull());
    expect(screen.queryByText("이슈 제출")).not.toBeNull();
  });

  it("Popover가 닫혀 있으면 Dialog가 정상적으로 닫힌다", async () => {
    render(<Harness />);
    await settleLayers();

    pointerDownOutside();

    await waitFor(() => expect(screen.queryByText("이슈 제출")).toBeNull());
  });

  it("소비처가 넘긴 onPointerDownOutside는 가드와 무관하게 호출된다", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness onPointerDownOutside={spy} />);
    await settleLayers();

    await user.click(screen.getByText("프로젝트 선택"));
    expect(await screen.findByText("옵션 A")).toBeTruthy();
    await settleLayers();

    pointerDownOutside();

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("이슈 제출")).not.toBeNull();
  });
});
