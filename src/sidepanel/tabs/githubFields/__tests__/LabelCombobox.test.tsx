import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GithubLabel } from "@/types/github";
import { LabelCombobox } from "../LabelCombobox";

vi.mock("@/i18n", () => ({ useT: () => (key: string) => key }));

const { sendBg } = vi.hoisted(() => ({ sendBg: vi.fn() }));
vi.mock("@/types/messages", () => ({ sendBg }));

// 호출마다 수동 resolve 가능한 Promise를 돌려준다. 이전 스코프의 응답을
// "실제로 늦게" 도착시켜야 race가 재현된다.
let pending: Array<(list: GithubLabel[]) => void>;

beforeEach(() => {
  pending = [];
  sendBg.mockReset();
  sendBg.mockImplementation(
    () => new Promise<GithubLabel[]>((resolve) => pending.push(resolve)),
  );
});

// 팝오버가 열리면 cmdk의 CommandInput도 role="combobox"를 갖는다.
// 트리거는 그중 button 요소 하나뿐이다.
function trigger(): HTMLElement {
  const found = screen
    .getAllByRole("combobox")
    .find((el) => el.tagName === "BUTTON");
  if (!found) throw new Error("트리거 버튼을 찾지 못했다");
  return found;
}

describe("githubFields/LabelCombobox — 저장소 교체 race", () => {
  it("저장소가 바뀌면 이전 저장소의 늦은 응답이 목록을 채우지 않고 새 저장소로 재조회한다", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <LabelCombobox owner="o" repo="A" value={undefined} onChange={() => {}} />,
    );

    // 1. 저장소 A로 열어 조회를 띄운다. 응답은 아직 오지 않았다.
    await user.click(trigger());
    await waitFor(() => expect(sendBg).toHaveBeenCalledTimes(1));
    expect(sendBg.mock.calls[0][0]).toMatchObject({
      type: "github.getLabels",
      repo: "A",
    });

    // 2. 닫는다.
    await user.keyboard("{Escape}");

    // 3. 저장소를 B로 바꾼다.
    rerender(
      <LabelCombobox owner="o" repo="B" value={undefined} onChange={() => {}} />,
    );

    // 4. 그제서야 A의 응답이 도착한다.
    await act(async () => {
      pending[0]([{ id: 1, name: "a-only", color: "f00" }]);
    });

    // 5. 다시 연다.
    await user.click(trigger());

    // 6. B로 재조회해야 하고, A의 라벨이 남아 있으면 안 된다.
    await waitFor(() => expect(sendBg).toHaveBeenCalledTimes(2));
    expect(sendBg.mock.calls[1][0]).toMatchObject({
      type: "github.getLabels",
      repo: "B",
    });
    expect(screen.queryByText("a-only")).toBeNull();
  });

  it("저장소가 그대로면 닫았다 다시 열어도 재조회하지 않는다", async () => {
    const user = userEvent.setup();
    render(
      <LabelCombobox owner="o" repo="A" value={undefined} onChange={() => {}} />,
    );

    await user.click(trigger());
    await waitFor(() => expect(sendBg).toHaveBeenCalledTimes(1));
    await act(async () => {
      pending[0]([{ id: 1, name: "bug", color: "f00" }]);
    });
    await waitFor(() => expect(screen.getByText("bug")).toBeTruthy());

    await user.keyboard("{Escape}");
    await user.click(trigger());

    expect(sendBg).toHaveBeenCalledTimes(1);
    expect(screen.getByText("bug")).toBeTruthy();
  });
});
