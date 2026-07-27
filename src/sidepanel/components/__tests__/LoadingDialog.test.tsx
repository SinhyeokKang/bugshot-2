import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoadingDialog } from "../LoadingDialog";

const BASE = {
  open: true,
  icon: <span data-testid="icon" />,
  title: "영상을 자르는 중",
  description: "이 패널을 열어둔 채 기다려 주세요.",
};

describe("LoadingDialog", () => {
  it("percent를 주면 진행률 바를 그린다", () => {
    render(<LoadingDialog {...BASE} percent={47} progressLabel="자르기 진행률" />);

    const bar = screen.getByRole("progressbar", { name: "자르기 진행률" });
    expect(bar.getAttribute("aria-valuenow")).toBe("47");
    expect(screen.queryByText("47%")).toBeTruthy();
  });

  it("percent가 없으면 진행률 바를 그리지 않는다", () => {
    render(<LoadingDialog {...BASE} />);

    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByTestId("icon")).toBeTruthy();
  });

  // 이 컴포넌트의 계약 = 작업이 끝날 때까지 사용자가 빠져나갈 수 없다. 닫는 컨트롤이 하나라도
  // 생기면 "모든 액션 차단"이 깨지므로 버튼 부재를 못으로 박는다.
  it("사용자가 닫을 수 있는 컨트롤이 없다", () => {
    render(<LoadingDialog {...BASE} percent={10} />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("open이 false면 아무것도 렌더하지 않는다", () => {
    render(<LoadingDialog {...BASE} open={false} percent={10} />);

    expect(screen.queryByTestId("loading-dialog")).toBeNull();
  });
});
