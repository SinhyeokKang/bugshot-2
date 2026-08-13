import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorIssueFields } from "@/store/editor-store";
import type { JiraIssueType, JiraProject } from "@/types/jira";
import { JiraIssueFields } from "../JiraIssueFields";

vi.mock("@/i18n", () => ({ useT: () => (key: string) => key }));

const JIRA_ACCOUNT = {
  platform: "jira" as const,
  projectKey: "WEB",
  issueTypeId: "10001",
  issueTypeName: "Bug",
  auth: { kind: "oauth" as const, cloudId: "cloud-1" },
};

vi.mock("@/store/settings-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/settings-store")>();
  return {
    ...actual,
    useSettingsStore: (sel: (s: { accounts: Record<string, unknown> }) => unknown) =>
      sel({ accounts: { jira: JIRA_ACCOUNT } }),
  };
});

const sendBg = vi.fn();
vi.mock("@/types/messages", () => ({
  sendBg: (req: unknown) => sendBg(req),
}));

const PROJECTS: JiraProject[] = [
  { id: "1", key: "WEB", name: "Web App" },
  { id: "2", key: "API", name: "API Service" },
];
const WEB_TYPES: JiraIssueType[] = [{ id: "10001", name: "Bug" }];
const API_TYPES: JiraIssueType[] = [{ id: "20001", name: "Defect" }];

function Harness({ initial }: { initial?: EditorIssueFields }) {
  const [fields, setFields] = useState<EditorIssueFields>(initial ?? {});
  return (
    <JiraIssueFields
      fields={fields}
      onChange={(patch) => setFields((f) => ({ ...f, ...patch }))}
    />
  );
}

function projectTrigger() {
  return screen.getByTestId("jira-project-combobox");
}

beforeEach(() => {
  sendBg.mockReset();
  sendBg.mockImplementation((req: { type: string; projectKey?: string }) => {
    if (req.type === "jira.listProjects") return Promise.resolve(PROJECTS);
    if (req.type === "jira.listIssueTypes")
      return Promise.resolve(req.projectKey === "API" ? API_TYPES : WEB_TYPES);
    return Promise.resolve([]);
  });
});

describe("JiraIssueFields — 프로젝트 기본값 백필", () => {
  it("fields에 projectKey가 없으면 계정 기본 프로젝트를 채운다 (제출 게이트가 이 값을 요구한다)", async () => {
    render(<Harness />);

    await waitFor(() => expect(projectTrigger().textContent).toContain("WEB"));
    // 계정 기본 프로젝트이므로 기본 이슈타입도 함께 붙는다.
    await waitFor(() => expect(screen.getByText("Bug")).toBeTruthy());
  });
});

describe("JiraIssueFields — 프로젝트 전환", () => {
  it("프로젝트를 바꾸면 이슈타입 콤보가 열린 채로 새 프로젝트의 목록을 보여준다", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await waitFor(() => expect(projectTrigger().textContent).toContain("WEB"));
    await user.click(projectTrigger());
    await user.click(await screen.findByText("API Service"));

    // 프로젝트 팝오버가 닫히며 트리거로 포커스를 되돌리는 순간 갓 열린 레이어가 dismiss되면
    // 이 단언이 깨진다 — 제출 버튼이 잠긴 이유를 알릴 유일한 단서다.
    expect(await screen.findByRole("option", { name: /Defect/ })).toBeTruthy();
  });

  it("프로젝트를 바꾸면 이슈타입·담당자·에픽·연결이슈는 비고 우선순위·참조는 남는다", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={{
          projectKey: "WEB",
          issueTypeId: "10001",
          assigneeId: "a1",
          assigneeName: "김철수",
          priorityId: "3",
          priorityName: "High",
          parentKey: "WEB-1",
          parentLabel: "WEB-1 Epic",
          relates: [{ key: "WEB-2", label: "WEB-2 Foo" }],
          cc: [{ accountId: "a2", displayName: "이영희" }],
        }}
      />,
    );

    await user.click(projectTrigger());
    await user.click(await screen.findByText("API Service"));

    await waitFor(() => expect(projectTrigger().textContent).toContain("API Service (API)"));
    // 남는 것: 우선순위·참조는 사이트 전역이라 라벨이 그대로 보인다.
    expect(screen.getByText("High")).toBeTruthy();
    expect(screen.getByText("이영희")).toBeTruthy();
    // 비는 것: 담당자·에픽 라벨이 사라진다.
    expect(screen.queryByText("김철수")).toBeNull();
    expect(screen.queryByText("WEB-1 Epic")).toBeNull();
  });

  it("같은 프로젝트를 다시 골라도 입력이 날아가지 않는다", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={{ projectKey: "WEB", issueTypeId: "10001", assigneeName: "김철수" }}
      />,
    );

    await user.click(projectTrigger());
    await user.click(await screen.findByText("Web App"));

    await waitFor(() => expect(projectTrigger().textContent).toContain("Web App (WEB)"));
    expect(screen.getByText("김철수")).toBeTruthy();
  });
});
