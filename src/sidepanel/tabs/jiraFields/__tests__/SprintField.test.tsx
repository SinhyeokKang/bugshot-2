import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JiraSprint } from "@/types/jira";
import { SprintField } from "../SprintField";

vi.mock("@/i18n", () => ({ useT: () => (key: string) => key }));

const JIRA_CONFIG = { projectKey: "WEB" };
vi.mock("../useJiraConfig", () => ({
  useJiraConfig: () => JIRA_CONFIG,
}));

const sendBg = vi.fn();
vi.mock("@/lib/bg-client", () => ({
  sendBg: (req: unknown) => sendBg(req),
}));

const SPRINTS: JiraSprint[] = [
  { id: 42, name: "Sprint 24", state: "active", boardName: "WEB board" },
  { id: 43, name: "Sprint 25", state: "future", boardName: "API board" },
];

function mockList(multiBoard: boolean, sprints: JiraSprint[] = SPRINTS) {
  sendBg.mockImplementation((req: { type: string }) =>
    req.type === "jira.listSprints"
      ? Promise.resolve({ sprints, multiBoard })
      : Promise.resolve([]),
  );
}

function trigger() {
  return screen.getByTestId("jira-sprint-combobox");
}

beforeEach(() => {
  sendBg.mockReset();
  mockList(false);
});

describe("SprintField", () => {
  it("열면 prop projectKey로 스프린트 목록을 조회한다", async () => {
    const user = userEvent.setup();
    render(<SprintField projectKey="API" onChange={vi.fn()} />);

    await user.click(trigger());

    await waitFor(() =>
      expect(sendBg).toHaveBeenCalledWith({
        type: "jira.listSprints",
        projectKey: "API",
      }),
    );
  });

  it("항목을 고르면 id와 이름을 함께 올린다", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SprintField projectKey="WEB" onChange={onChange} />);

    await user.click(trigger());
    await user.click(await screen.findByText("Sprint 24"));

    expect(onChange).toHaveBeenCalledWith(42, "Sprint 24");
  });

  it("선택된 값이 있으면 해제할 수 있다", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SprintField
        projectKey="WEB"
        value={42}
        fallbackLabel="Sprint 24"
        onChange={onChange}
      />,
    );

    await user.click(trigger());
    await user.click(await screen.findByText("common.deselect"));

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("선택된 값이 없으면 해제 항목을 보여주지 않는다", async () => {
    const user = userEvent.setup();
    render(<SprintField projectKey="WEB" onChange={vi.fn()} />);

    await user.click(trigger());
    await screen.findByText("Sprint 24");

    expect(screen.queryByText("common.deselect")).toBeNull();
  });

  // 보드가 하나뿐이면 보드명은 정보가 아니라 소음이다.
  it("보드가 하나면 항목에 보드명을 그리지 않는다", async () => {
    const user = userEvent.setup();
    render(<SprintField projectKey="WEB" onChange={vi.fn()} />);

    await user.click(trigger());
    await screen.findByText("Sprint 24");

    expect(screen.queryByText("WEB board")).toBeNull();
  });

  // 보드가 여럿이면 같은 이름의 스프린트가 섞일 수 있어 보드명이 구별자가 된다.
  it("보드가 여럿이면 항목에 보드명을 함께 그린다", async () => {
    const user = userEvent.setup();
    mockList(true);
    render(<SprintField projectKey="WEB" onChange={vi.fn()} />);

    await user.click(trigger());

    expect(await screen.findByText("WEB board")).toBeTruthy();
    expect(screen.getByText("API board")).toBeTruthy();
  });

  // 저장된 이름은 목록이 오기 전 트리거를 채우는 유일한 수단이다(§9의 표시 게이트가 상위에 있다).
  it("목록이 오기 전에는 fallbackLabel이 트리거에 보인다", () => {
    render(
      <SprintField
        projectKey="WEB"
        value={42}
        fallbackLabel="Sprint 24"
        onChange={vi.fn()}
      />,
    );

    expect(trigger().textContent).toContain("Sprint 24");
  });

  it("값도 fallbackLabel도 없으면 placeholder가 보인다", () => {
    render(<SprintField projectKey="WEB" onChange={vi.fn()} />);

    expect(trigger().textContent).toContain("field.sprint.select");
  });
});
