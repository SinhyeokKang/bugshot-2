import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GithubStatusBadge } from "../GithubStatusBadge";

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
  t: (key: string) => key,
}));

const sendBg = vi.fn();
vi.mock("@/types/messages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/types/messages")>();
  return { ...actual, sendBg: (req: unknown) => sendBg(req) };
});

vi.mock("@/store/issues-store", () => ({
  useIssuesStore: (sel: (s: { patchIssue: () => void }) => unknown) =>
    sel({ patchIssue: () => {} }),
}));

function renderBadge() {
  return render(
    <GithubStatusBadge
      ghStatus={{ kind: "open" }}
      issueId="i1"
      owner="o"
      repo="r"
      number={1}
      onStatusChanged={() => {}}
    />,
  );
}

// 스피너를 든 버튼이 순수 disabled면 갱신 중 포커스·접근명을 잃는다. aria-disabled로 바꾸면
// 클릭이 실제로 들어오므로 **재오픈 가드가 반드시 짝**이어야 한다 — 없으면 갱신 중 재클릭이
// 두 번째 상태 변경 요청을 만든다.
describe("GithubStatusBadge — 갱신 중 재클릭 가드", () => {
  beforeEach(() => {
    sendBg.mockReset();
  });

  it("상태를 고르면 요청이 한 번 나간다", async () => {
    sendBg.mockReturnValue(new Promise(() => {})); // 영원히 pending → updating 유지
    renderBadge();

    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(await screen.findByText("issueList.github.status.closedCompleted"));

    expect(sendBg).toHaveBeenCalledTimes(1);
  });

  it("갱신 중에는 트리거를 다시 눌러도 팝오버가 안 열리고 요청도 안 는다", async () => {
    sendBg.mockReturnValue(new Promise(() => {}));
    renderBadge();

    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(await screen.findByText("issueList.github.status.closedCompleted"));
    await waitFor(() =>
      expect(screen.getByRole("button").getAttribute("aria-disabled")).toBe("true"),
    );

    await userEvent.click(screen.getByRole("button"));

    expect(
      screen.queryByText("issueList.github.status.closedNotPlanned"),
    ).toBeNull();
    expect(sendBg).toHaveBeenCalledTimes(1);
  });

  it("갱신 중 트리거는 순수 disabled가 아니다 (포커스·접근명 보존)", async () => {
    sendBg.mockReturnValue(new Promise(() => {}));
    renderBadge();

    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(await screen.findByText("issueList.github.status.closedCompleted"));

    await waitFor(() =>
      expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false),
    );
  });
});
