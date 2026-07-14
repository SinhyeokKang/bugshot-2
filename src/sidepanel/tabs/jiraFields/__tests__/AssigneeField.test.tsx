import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JiraUser } from "@/types/jira";
import { AssigneeField } from "../AssigneeField";

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
}));

// 실제 훅은 useMemo로 참조를 고정한다 — 매 렌더 새 객체를 주면 디바운스 타이머가 계속 취소돼 로딩에 갇힌다.
const JIRA_CONFIG = { projectKey: "BUG" };
vi.mock("../useJiraConfig", () => ({
  useJiraConfig: () => JIRA_CONFIG,
}));

const sendBg = vi.fn();
vi.mock("@/types/messages", () => ({
  sendBg: (req: unknown) => sendBg(req),
}));

const USERS: JiraUser[] = [
  { accountId: "a1", displayName: "김철수" } as JiraUser,
  { accountId: "a2", displayName: "이영희" } as JiraUser,
  { accountId: "a3", displayName: "홍길동" } as JiraUser,
];

// 서버 검색: 빈 쿼리는 전체 디렉터리, 그 외는 이름 부분일치.
function mockSearch() {
  sendBg.mockImplementation((req: { type: string; query?: string }) => {
    if (req.type !== "jira.searchUsers") return Promise.resolve([]);
    const q = req.query ?? "";
    return Promise.resolve(
      q ? USERS.filter((u) => u.displayName.includes(q)) : USERS,
    );
  });
}

function Harness() {
  const [value, setValue] = useState<string | undefined>(undefined);
  return (
    <AssigneeField value={value} onChange={(id) => setValue(id)} />
  );
}

// 목록에 실제로 보이는 담당자 이름들 (선택해제 액션 항목 제외).
function optionNames(): string[] {
  return screen
    .getAllByRole("option")
    .map((el) => el.textContent ?? "")
    .filter((text) => !text.includes("common.deselect"));
}

// 트리거 버튼과 cmdk 검색 입력이 둘 다 role=combobox라 DOM 순서로 가른다 (팝오버는 뒤에 portal).
function trigger() {
  return screen.getAllByRole("combobox")[0];
}

function searchInput() {
  return screen.getByPlaceholderText("field.assignee.search");
}

async function openField(user: ReturnType<typeof userEvent.setup>) {
  await user.click(trigger());
  await waitFor(() => expect(optionNames().length).toBe(USERS.length));
}

describe("AssigneeField 선택자 상단 고정", () => {
  beforeEach(() => {
    sendBg.mockReset();
    mockSearch();
  });

  it("검색 없이 골랐다가 다시 열면 선택된 담당자가 맨 위에 온다", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await openField(user);
    await user.click(screen.getByText("홍길동"));

    await openField(user);
    expect(optionNames()[0]).toContain("홍길동");
  });

  it("검색해서 골랐다가 다시 열어도 선택된 담당자가 맨 위에 온다", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(trigger());
    await user.type(searchInput(), "홍길");
    await waitFor(() => expect(optionNames()).toEqual(["홍길동"]));
    await user.click(screen.getByText("홍길동"));

    await openField(user);
    expect(optionNames()[0]).toContain("홍길동");
  });

  it("검색어를 입력한 동안에는 상단 고정 없이 검색 결과 순서를 유지한다", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await openField(user);
    await user.click(screen.getByText("김철수"));

    await openField(user);
    await user.type(searchInput(), "이");
    await waitFor(() => expect(optionNames()).toEqual(["이영희"]));
  });
});
