import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JiraProject } from "@/types/jira";
import { ProjectField } from "../ProjectField";

vi.mock("@/i18n", () => ({ useT: () => (key: string) => key }));

// ProjectField는 형제 필드와 달리 useJiraConfig 게이트가 없다 — 프로젝트 자체가 조회 스코프라
// 걸 게 없고, SubmitFieldsDialog가 jiraConfigured일 때만 렌더한다.

const sendBg = vi.fn();
vi.mock("@/lib/bg-client", () => ({
  sendBg: (req: unknown) => sendBg(req),
}));

const PROJECTS: JiraProject[] = [
  { id: "1", key: "WEB", name: "Web App" },
  { id: "2", key: "API", name: "API Service" },
];

// 서버 검색: 빈 쿼리는 전체 목록, 그 외는 이름·키 부분일치.
// 클라이언트 필터가 아니라 서버 검색인 것이 요점이다 — searchProjects가 maxResults:50이라
// 클라이언트 필터만으로는 51번째 프로젝트에 도달할 수 없다(PRD S4).
function mockSearch() {
  sendBg.mockImplementation((req: { type: string; query?: string }) => {
    if (req.type !== "jira.listProjects") return Promise.resolve([]);
    const q = req.query ?? "";
    return Promise.resolve(
      q
        ? PROJECTS.filter((p) => `${p.name} ${p.key}`.includes(q))
        : PROJECTS,
    );
  });
}

function trigger() {
  return screen.getByTestId("jira-project-combobox");
}

function optionNames(): string[] {
  return screen.getAllByRole("option").map((el) => el.textContent ?? "");
}

beforeEach(() => {
  sendBg.mockReset();
  mockSearch();
});

describe("ProjectField — 목록 조회", () => {
  it("콤보를 열면 프로젝트 목록을 조회한다", async () => {
    const user = userEvent.setup();
    render(<ProjectField onChange={vi.fn()} />);

    await user.click(trigger());

    await waitFor(() => expect(optionNames().length).toBe(PROJECTS.length));
    expect(sendBg).toHaveBeenCalledWith({
      type: "jira.listProjects",
      query: undefined,
    });
  });

  it("검색어를 입력하면 서버 검색(query)이 나간다", async () => {
    const user = userEvent.setup();
    render(<ProjectField onChange={vi.fn()} />);

    await user.click(trigger());
    await waitFor(() => expect(optionNames().length).toBe(PROJECTS.length));
    await user.type(screen.getByPlaceholderText("project.search"), "API");

    await waitFor(() =>
      expect(sendBg).toHaveBeenCalledWith({
        type: "jira.listProjects",
        query: "API",
      }),
    );
    await waitFor(() => expect(optionNames().length).toBe(1));
    expect(optionNames()[0]).toContain("API Service");
  });

  it("항목을 고르면 프로젝트 키로 onChange한다", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ProjectField onChange={onChange} />);

    await user.click(trigger());
    await waitFor(() => expect(optionNames().length).toBe(PROJECTS.length));
    await user.click(screen.getByText("API Service"));

    expect(onChange).toHaveBeenCalledWith("API");
  });

  it("접근 가능한 프로젝트가 0개면 빈 목록 문구가 뜬다", async () => {
    sendBg.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<ProjectField onChange={vi.fn()} />);

    await user.click(trigger());

    expect(await screen.findByText("project.empty")).toBeTruthy();
  });

  it("조회에 실패하면 콤보 안에 에러 문구가 뜨고 트리거는 선택된 키를 유지한다", async () => {
    sendBg.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    render(<ProjectField value="API" fallbackLabel="API" onChange={vi.fn()} />);

    await user.click(trigger());

    expect(await screen.findByText("boom")).toBeTruthy();
    expect(trigger().textContent).toContain("API");
  });
});

describe("ProjectField — 표시", () => {
  it("목록 로드 전에도 선택된 프로젝트 키가 트리거에 보인다", () => {
    render(<ProjectField value="API" fallbackLabel="API" onChange={vi.fn()} />);

    expect(trigger().textContent).toContain("API");
  });

  it("목록이 로드되면 트리거가 이름과 키를 함께 보여준다", async () => {
    const user = userEvent.setup();
    render(<ProjectField value="API" fallbackLabel="API" onChange={vi.fn()} />);

    await user.click(trigger());

    await waitFor(() => expect(trigger().textContent).toContain("API Service (API)"));
  });

  // 서버 검색이라 검색 결과에서 선택된 프로젝트가 빠진다 — 그때 라벨이 키만 남게 퇴화하면 안 된다.
  it("검색으로 선택된 프로젝트가 결과에서 빠져도 트리거 라벨이 유지된다", async () => {
    const user = userEvent.setup();
    render(<ProjectField value="API" fallbackLabel="API" onChange={vi.fn()} />);

    await user.click(trigger());
    await waitFor(() => expect(trigger().textContent).toContain("API Service (API)"));
    await user.type(screen.getByPlaceholderText("project.search"), "Web");
    await waitFor(() => expect(optionNames().length).toBe(1));

    expect(trigger().textContent).toContain("API Service (API)");
  });

  it("선택이 없으면 placeholder를 보여준다", () => {
    render(<ProjectField onChange={vi.fn()} />);

    expect(trigger().textContent).toContain("project.select");
  });

  // FieldRow의 <label>에 htmlFor가 없어 행이 7개가 되면 접근 이름 없는 combobox가 7개 나열된다.
  // 이 라벨 하나가 접근성과 e2e 판정 수단을 동시에 해결한다(design §5·§11).
  it("트리거에 접근 이름이 붙는다", () => {
    render(<ProjectField onChange={vi.fn()} />);

    expect(trigger().getAttribute("aria-label")).toBe("jira.project");
  });
});
