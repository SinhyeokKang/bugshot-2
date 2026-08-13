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

function Harness({
  initial,
  onPatch,
}: {
  initial?: EditorIssueFields;
  onPatch?: (patch: Partial<EditorIssueFields>) => void;
}) {
  const [fields, setFields] = useState<EditorIssueFields>(initial ?? {});
  return (
    <JiraIssueFields
      fields={fields}
      onChange={(patch) => {
        onPatch?.(patch);
        setFields((f) => ({ ...f, ...patch }));
      }}
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
  // 표시값은 `fields.projectKey ?? accountProjectKey` 파생이라 백필을 지워도 화면은 그대로다 —
  // 정작 제출 게이트가 요구하는 건 저장값이므로 store write를 직접 단언해야 그물이 된다.
  it("fields에 projectKey가 없으면 계정 기본 프로젝트를 store에 채운다", async () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} />);

    await waitFor(() =>
      expect(onPatch).toHaveBeenCalledWith({ projectKey: "WEB" }),
    );
    await waitFor(() => expect(projectTrigger().textContent).toContain("WEB"));
    // 계정 기본 프로젝트이므로 기본 이슈타입도 함께 붙는다.
    await waitFor(() => expect(screen.getByText("Bug")).toBeTruthy());
  });

  it("fields에 projectKey가 이미 있으면 계정 기본값으로 덮지 않는다", async () => {
    const onPatch = vi.fn();
    render(<Harness initial={{ projectKey: "API" }} onPatch={onPatch} />);

    await waitFor(() => expect(projectTrigger().textContent).toContain("API"));
    expect(onPatch).not.toHaveBeenCalledWith({ projectKey: "WEB" });
  });
});

describe("JiraIssueFields — 진입 시 잠금 단서", () => {
  it("계정 기본이 아닌 프로젝트로 열렸는데 이슈타입이 비면 콤보를 열어 알린다", async () => {
    render(<Harness initial={{ projectKey: "API" }} />);

    expect(await screen.findByRole("option", { name: /Defect/ })).toBeTruthy();
  });

  it("계정 기본 프로젝트로 열리면 콤보를 열지 않는다 (기본 이슈타입이 곧바로 채워진다)", async () => {
    render(<Harness initial={{ projectKey: "WEB" }} />);

    await waitFor(() =>
      expect(screen.getByTestId("jira-issue-type-combobox").textContent).toContain("Bug"),
    );
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("이슈타입이 이미 있으면 콤보를 열지 않는다", async () => {
    render(<Harness initial={{ projectKey: "API", issueTypeId: "20001" }} />);

    await waitFor(() => expect(projectTrigger().textContent).toContain("API"));
    expect(screen.queryByRole("option")).toBeNull();
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
    const onPatch = vi.fn();
    render(
      <Harness
        onPatch={onPatch}
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
    // 이슈타입·연결이슈는 전환 후 표시가 placeholder로 수렴해 화면으로 구별되지 않는다 —
    // 실제로 비워졌는지는 patch로 본다(그래야 resolveProjectChange에서 한 키를 빼면 red).
    expect(onPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        projectKey: "API",
        issueTypeId: undefined,
        assigneeId: undefined,
        assigneeName: undefined,
        parentKey: undefined,
        parentLabel: undefined,
        relates: undefined,
      }),
    );
    const patch = onPatch.mock.calls
      .map((c) => c[0] as Partial<EditorIssueFields>)
      .find((p) => p.projectKey === "API")!;
    expect(patch).not.toHaveProperty("priorityId");
    expect(patch).not.toHaveProperty("cc");
  });

  // isEpicType은 handleIssueTypeChange 안에서만 갱신되는 로컬 상태라 patch로는 안 풀린다 —
  // 에픽 이슈타입을 고른 뒤 프로젝트를 옮기면 상위 에픽 행이 숨은 채 남는다.
  it("에픽 이슈타입에서 프로젝트를 옮기면 상위 에픽 행이 되살아난다", async () => {
    const user = userEvent.setup();
    sendBg.mockImplementation((req: { type: string; projectKey?: string }) => {
      if (req.type === "jira.listProjects") return Promise.resolve(PROJECTS);
      if (req.type === "jira.listIssueTypes")
        return Promise.resolve(
          req.projectKey === "API"
            ? API_TYPES
            : [{ id: "10009", name: "Epic", hierarchyLevel: 1 }],
        );
      return Promise.resolve([]);
    });
    render(<Harness initial={{ projectKey: "WEB" }} />);

    // 에픽 이슈타입 선택 → isEpicType=true → 상위 에픽 행이 언마운트된다.
    await user.click(screen.getByTestId("jira-issue-type-combobox"));
    await user.click(await screen.findByRole("option", { name: /Epic/ }));
    await waitFor(() => expect(screen.queryByText("create.parentEpic")).toBeNull());

    await user.click(projectTrigger());
    await user.click(await screen.findByText("API Service"));

    await waitFor(() => expect(screen.getByText("create.parentEpic")).toBeTruthy());
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
