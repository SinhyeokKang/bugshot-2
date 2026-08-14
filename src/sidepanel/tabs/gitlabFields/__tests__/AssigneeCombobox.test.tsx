import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitlabMember } from "@/types/gitlab";
import { AssigneeCombobox } from "../AssigneeCombobox";

vi.mock("@/i18n", () => ({ useT: () => (key: string) => key }));

const { sendBg } = vi.hoisted(() => ({ sendBg: vi.fn() }));
vi.mock("@/lib/bg-client", () => ({ sendBg }));

const MEMBERS: GitlabMember[] = [
  { id: 7, username: "alice", name: "Alice" },
  { id: 8, username: "bob", name: "Bob" },
];

let pending: Array<(list: GitlabMember[]) => void>;

beforeEach(() => {
  pending = [];
  sendBg.mockReset();
  sendBg.mockImplementation(
    () => new Promise<GitlabMember[]>((resolve) => pending.push(resolve)),
  );
});

function trigger(): HTMLElement {
  const found = screen
    .getAllByRole("combobox")
    .find((el) => el.tagName === "BUTTON");
  if (!found) throw new Error("트리거 버튼을 찾지 못했다");
  return found;
}

// 멤버 id는 number라 selectedKey(string)와 맞추려면 getKey와 selectedKey를 함께
// 문자열화해야 한다. 한쪽만 바꾸면 타입은 통과하는데 매칭이 영원히 실패한다.
describe("gitlabFields/AssigneeCombobox — number id 문자열화 짝", () => {
  it("선택된 담당자 행에 체크 표시가 남는다", async () => {
    const user = userEvent.setup();
    render(
      <AssigneeCombobox
        projectId={1}
        value={{ id: 7, username: "alice" }}
        onChange={() => {}}
      />,
    );

    await user.click(trigger());
    await waitFor(() => expect(sendBg).toHaveBeenCalledTimes(1));
    await act(async () => {
      pending[0](MEMBERS);
    });

    const selected = await screen.findByRole("option", { name: /alice/ });
    expect(selected.querySelector("svg")?.getAttribute("class")).toContain(
      "opacity-100",
    );

    const other = screen.getByRole("option", { name: /bob/ });
    expect(other.querySelector("svg")?.getAttribute("class")).toContain(
      "opacity-0",
    );
  });

  it("선택된 담당자를 다시 클릭하면 해제된다", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <AssigneeCombobox
        projectId={1}
        value={{ id: 7, username: "alice" }}
        onChange={onChange}
      />,
    );

    await user.click(trigger());
    await waitFor(() => expect(sendBg).toHaveBeenCalledTimes(1));
    await act(async () => {
      pending[0](MEMBERS);
    });

    await user.click(await screen.findByRole("option", { name: /alice/ }));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("다른 담당자를 고르면 id와 username 쌍을 넘긴다", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <AssigneeCombobox
        projectId={1}
        value={{ id: 7, username: "alice" }}
        onChange={onChange}
      />,
    );

    await user.click(trigger());
    await waitFor(() => expect(sendBg).toHaveBeenCalledTimes(1));
    await act(async () => {
      pending[0](MEMBERS);
    });

    await user.click(await screen.findByRole("option", { name: /bob/ }));

    expect(onChange).toHaveBeenCalledWith({ id: 8, username: "bob" });
  });
});
