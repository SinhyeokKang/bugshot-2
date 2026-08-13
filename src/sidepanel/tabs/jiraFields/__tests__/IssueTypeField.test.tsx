import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JiraIssueType } from "@/types/jira";
import { IssueTypeField } from "../IssueTypeField";

vi.mock("@/i18n", () => ({ useT: () => (key: string) => key }));

// 계정 객체는 상수여야 한다 — projectKey/account가 effect dep이라 매 렌더 새 객체면 조회가 반복된다
// (AssigneeField.test.tsx의 JIRA_CONFIG 주석과 같은 함정).
const JIRA_ACCOUNT = {
  platform: "jira" as const,
  projectKey: "WEB",
  issueTypeId: "10001",
  issueTypeName: "Bug",
  auth: { kind: "oauth" as const, cloudId: "cloud-1" },
};

// IssueTypeField는 useJiraConfig가 아니라 useSettingsStore를 직접 구독한다(:19).
// 그래서 셋업 선례는 AssigneeField.test.tsx가 아니라 IssueTab.test.tsx의 importOriginal 패턴이다
// — spread를 빼면 isJiraAccountComplete·jiraSiteId 같은 다른 export가 사라진다.
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

const ISSUE_TYPES: JiraIssueType[] = [
  { id: "10001", name: "Bug" },
  { id: "10002", name: "Task" },
];

function trigger() {
  return screen.getAllByRole("combobox")[0];
}

beforeEach(() => {
  sendBg.mockReset();
  sendBg.mockResolvedValue(ISSUE_TYPES);
});

describe("IssueTypeField — 조회 스코프", () => {
  it("계정 기본 프로젝트가 아니라 prop projectKey로 조회한다", async () => {
    const user = userEvent.setup();
    render(<IssueTypeField projectKey="API" onChange={vi.fn()} />);

    await user.click(trigger());

    await waitFor(() =>
      expect(sendBg).toHaveBeenCalledWith({
        type: "jira.listIssueTypes",
        projectKey: "API",
      }),
    );
  });
});

// R2: defaultId 자동 적용 경로가 둘이다 — useEffect의 onChange(:56-58)와
// 파생값 effectiveValue = value ?? defaultId(:53, 라벨·체크마크를 직접 먹인다).
// effect만 가드하면 화면엔 선택된 것처럼 보이는데 실제 값은 비어 create.requiredMissing으로 죽는다.
describe("IssueTypeField — 계정 기본 이슈타입 자동 주입 가드", () => {
  it("계정 기본 프로젝트에서는 기본 이슈타입이 자동 선택된다 (기존 동작 보존)", () => {
    const onChange = vi.fn();
    render(<IssueTypeField projectKey="WEB" onChange={onChange} />);

    expect(onChange).toHaveBeenCalledWith("10001");
  });

  it("계정 기본 프로젝트에서는 트리거에 계정 기본 이슈타입명이 보인다", () => {
    render(<IssueTypeField projectKey="WEB" onChange={vi.fn()} />);

    expect(trigger().textContent).toContain("Bug");
  });

  it("다른 프로젝트에서는 계정 기본 이슈타입이 값으로 주입되지 않는다", () => {
    const onChange = vi.fn();
    render(<IssueTypeField projectKey="API" onChange={onChange} />);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("다른 프로젝트에서는 트리거 라벨에도 계정 기본 이슈타입명이 새지 않는다", () => {
    render(<IssueTypeField projectKey="API" onChange={vi.fn()} />);

    expect(trigger().textContent).not.toContain("Bug");
    expect(trigger().textContent).toContain("field.issueType.select");
  });

  it("다른 프로젝트에서 목록을 열면 계정 기본 이슈타입에 체크마크가 없다", async () => {
    const user = userEvent.setup();
    render(<IssueTypeField projectKey="API" onChange={vi.fn()} />);

    await user.click(trigger());
    const option = await screen.findByRole("option", { name: /Bug/ });

    expect(option.querySelector(".opacity-100")).toBeNull();
  });

  it("계정 기본 프로젝트에서 목록을 열면 계정 기본 이슈타입에 체크마크가 있다", async () => {
    const user = userEvent.setup();
    render(<IssueTypeField projectKey="WEB" onChange={vi.fn()} />);

    await user.click(trigger());
    const option = await screen.findByRole("option", { name: /Bug/ });

    expect(option.querySelector(".opacity-100")).not.toBeNull();
  });

  it("값이 명시돼 있으면 프로젝트와 무관하게 그 값이 선택으로 표시된다", async () => {
    const user = userEvent.setup();
    render(<IssueTypeField projectKey="API" value="10002" onChange={vi.fn()} />);

    await user.click(trigger());
    const option = await screen.findByRole("option", { name: /Task/ });

    expect(option.querySelector(".opacity-100")).not.toBeNull();
  });
});
