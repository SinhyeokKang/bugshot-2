import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
  t: (key: string) => key,
}));

const sendBg = vi.fn();
vi.mock("@/lib/bg-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bg-client")>();
  return { ...actual, sendBg: (req: unknown) => sendBg(req) };
});

vi.mock("@/store/issues-store", () => ({
  useIssuesStore: (sel: (s: { patchIssue: () => void }) => unknown) =>
    sel({ patchIssue: () => {} }),
}));

import { LinearStatusBadge } from "../LinearStatusBadge";

function renderBadge() {
  return render(
    <LinearStatusBadge
      issueId="i1"
      issueIdentifier="ENG-1"
      currentState={{ name: "Todo", type: "unstarted" }}
      onStatusChanged={() => {}}
    />,
  );
}

beforeEach(() => {
  sendBg.mockReset();
});

// 빈 배열이면 팝오버가 통째로 빈 채 떴다 — 로딩 스피너가 사라진 뒤 아무것도 없어서
// "안 되는 건지 기다리는 건지" 구별이 안 된다. Jira·Notion은 이미 안내 문구가 있다.
describe("LinearStatusBadge 빈 상태", () => {
  it("상태 목록이 비면 안내 문구를 보여준다", async () => {
    sendBg.mockResolvedValue([]);
    renderBadge();

    await userEvent.click(screen.getByRole("button"));

    expect(await screen.findByText("issueList.linear.noStates")).toBeTruthy();
  });

  // `.catch(() => setStates([]))`라 조회 실패도 같은 분기로 떨어진다. Jira·Notion도 같은
  // 구조라 에러/빈목록 분리는 3곳 계열 변경 — 이번엔 현 동작을 계약으로 못박는다.
  it("조회 실패도 같은 문구로 떨어진다 (현 구조)", async () => {
    sendBg.mockRejectedValue(new Error("network down"));
    renderBadge();

    await userEvent.click(screen.getByRole("button"));

    expect(await screen.findByText("issueList.linear.noStates")).toBeTruthy();
  });

  it("목록이 있으면 안내 문구 대신 항목을 그린다", async () => {
    sendBg.mockResolvedValue([{ id: "s1", name: "In Progress", type: "started" }]);
    renderBadge();

    await userEvent.click(screen.getByRole("button"));

    expect(await screen.findByText("In Progress")).toBeTruthy();
    expect(screen.queryByText("issueList.linear.noStates")).toBeNull();
  });

  it("로딩 중에는 안내 문구를 먼저 그리지 않는다", async () => {
    sendBg.mockReturnValue(new Promise(() => {}));
    renderBadge();

    await userEvent.click(screen.getByRole("button"));

    expect(screen.queryByText("issueList.linear.noStates")).toBeNull();
  });
});
