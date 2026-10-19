import { useState } from "react";
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
vi.mock("@/lib/bg-client", () => ({
  sendBg: (req: unknown) => sendBg(req),
}));

const ISSUE_TYPES: JiraIssueType[] = [
  { id: "10001", name: "Bug" },
  { id: "10002", name: "Task" },
];

function trigger() {
  return screen.getAllByRole("combobox")[0];
}

// 열림 상태는 부모(JiraIssueFields)가 쥔다 — 프로젝트 전환 직후 콤보를 대신 열어야 하기 때문.
// 테스트도 같은 계약으로 감싼다.
function Harness({
  projectKey,
  value,
  fallbackLabel,
  onChange = vi.fn(),
}: {
  projectKey?: string;
  value?: string;
  fallbackLabel?: string;
  onChange?: (id: string, name?: string, hierarchyLevel?: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <IssueTypeField
      projectKey={projectKey}
      value={value}
      fallbackLabel={fallbackLabel}
      open={open}
      onOpenChange={setOpen}
      onChange={onChange}
    />
  );
}

beforeEach(() => {
  sendBg.mockReset();
  sendBg.mockResolvedValue(ISSUE_TYPES);
});

describe("IssueTypeField — 조회 스코프", () => {
  it("계정 기본 프로젝트가 아니라 prop projectKey로 조회한다", async () => {
    const user = userEvent.setup();
    render(<Harness projectKey="API" />);

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
    render(<Harness projectKey="WEB" onChange={onChange} />);

    // 이름도 쌍으로 넘긴다 — 라벨이 목록 로드 전에도 값과 같은 타입을 가리켜야 한다.
    expect(onChange).toHaveBeenCalledWith("10001", "Bug");
  });

  it("계정 기본 프로젝트에서는 트리거에 계정 기본 이슈타입명이 보인다", () => {
    render(<Harness projectKey="WEB" />);

    expect(trigger().textContent).toContain("Bug");
  });

  it("다른 프로젝트에서는 계정 기본 이슈타입이 값으로 주입되지 않는다", () => {
    const onChange = vi.fn();
    render(<Harness projectKey="API" onChange={onChange} />);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("다른 프로젝트에서는 트리거 라벨에도 계정 기본 이슈타입명이 새지 않는다", () => {
    render(<Harness projectKey="API" />);

    expect(trigger().textContent).not.toContain("Bug");
    expect(trigger().textContent).toContain("field.issueType.select");
  });

  it("다른 프로젝트에서 목록을 열면 계정 기본 이슈타입에 체크마크가 없다", async () => {
    const user = userEvent.setup();
    render(<Harness projectKey="API" />);

    await user.click(trigger());
    const option = await screen.findByRole("option", { name: /Bug/ });

    expect(option.querySelector(".opacity-100")).toBeNull();
  });

  it("계정 기본 프로젝트에서 목록을 열면 계정 기본 이슈타입에 체크마크가 있다", async () => {
    const user = userEvent.setup();
    render(<Harness projectKey="WEB" />);

    await user.click(trigger());
    const option = await screen.findByRole("option", { name: /Bug/ });

    expect(option.querySelector(".opacity-100")).not.toBeNull();
  });

  it("값이 명시돼 있으면 프로젝트와 무관하게 그 값이 선택으로 표시된다", async () => {
    const user = userEvent.setup();
    render(<Harness projectKey="API" value="10002" />);

    await user.click(trigger());
    const option = await screen.findByRole("option", { name: /Task/ });

    expect(option.querySelector(".opacity-100")).not.toBeNull();
  });
});

// 목록은 콤보를 열어야 받는다. 그 전의 라벨은 값과 쌍으로 저장된 이름이어야 한다 — 계정 기본
// 이슈타입명으로 폴백하면 직전 제출값(다른 id)이 복원됐을 때 화면은 기본 타입, 제출은 직전 타입으로
// 갈린다(리포트: "작업"으로 보였는데 "버그"로 제출됨).
describe("IssueTypeField — 목록 로드 전 라벨", () => {
  it("값이 계정 기본과 다르면 계정 기본 이슈타입명을 보이지 않고 저장된 이름을 보인다", () => {
    render(<Harness projectKey="WEB" value="10002" fallbackLabel="Task" />);

    expect(trigger().textContent).toContain("Task");
    expect(trigger().textContent).not.toContain("Bug");
  });

  it("값이 계정 기본과 다르고 이름이 없으면(업데이트 이전 레코드) 계정 기본 이슈타입명을 빌려오지 않는다", () => {
    render(<Harness projectKey="WEB" value="10002" />);

    expect(trigger().textContent).not.toContain("Bug");
  });

  it("이름 없이 값만 있으면 콤보를 열지 않아도 목록을 받아 실제 이름을 보인다", async () => {
    render(<Harness projectKey="WEB" value="10002" />);

    await waitFor(() => expect(trigger().textContent).toContain("Task"));
  });

  // 라벨만 고치고 store를 안 채우면 이름 없는 채로 다시 lastSubmit에 저장돼 매 세션 선조회가 반복된다.
  it("이름 없이 값만 있으면 목록을 받은 뒤 이름을 함께 되써 쌍을 복구한다", async () => {
    const onChange = vi.fn();
    render(<Harness projectKey="WEB" value="10002" onChange={onChange} />);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("10002", "Task"));
  });

  it("이름이 있으면 콤보를 열기 전엔 목록을 조회하지 않는다", () => {
    render(<Harness projectKey="WEB" value="10002" fallbackLabel="Task" />);

    expect(sendBg).not.toHaveBeenCalled();
  });

  it("목록을 받으면 저장된 이름보다 목록의 이름이 이긴다", async () => {
    const user = userEvent.setup();
    render(<Harness projectKey="WEB" value="10002" fallbackLabel="Old Task" />);

    await user.click(trigger());
    await screen.findByRole("option", { name: /Task/ });
    await user.keyboard("{Escape}");

    expect(trigger().textContent).toBe("Task");
  });

  it("목록에서 고르면 id와 이름을 함께 넘긴다", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness projectKey="WEB" value="10001" onChange={onChange} />);

    await user.click(trigger());
    await user.click(await screen.findByRole("option", { name: /Task/ }));

    expect(onChange).toHaveBeenLastCalledWith("10002", "Task", undefined);
  });
});

// 부모가 프로젝트를 바꾸면서 콤보를 대신 여는 흐름(JiraIssueFields의 주 동선)을 재현한다.
// 재조회 가드를 items.length로 잡으면 이 경로에서 옛 목록을 보고 조기 반환해 조회가 아예 안 나가고,
// 자동으로 열린 콤보가 "이슈타입 없음"으로 남는다.
function SwitchHarness() {
  const [projectKey, setProjectKey] = useState("WEB");
  const [open, setOpen] = useState(false);
  return (
    <>
      {["WEB", "API"].map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => {
            setProjectKey(key);
            setOpen(true);
          }}
        >
          {`switch ${key}`}
        </button>
      ))}
      <IssueTypeField
        projectKey={projectKey}
        open={open}
        onOpenChange={setOpen}
        onChange={vi.fn()}
      />
    </>
  );
}

describe("IssueTypeField — 프로젝트 전환", () => {
  beforeEach(() => {
    sendBg.mockImplementation((req: { type: string; projectKey?: string }) =>
      Promise.resolve(
        req.projectKey === "API"
          ? [{ id: "20001", name: "Defect" }]
          : ISSUE_TYPES,
      ),
    );
  });

  it("이전 프로젝트 목록을 이미 받은 뒤 전환해도 새 프로젝트로 다시 조회한다", async () => {
    const user = userEvent.setup();
    render(<SwitchHarness />);

    await user.click(trigger());
    await screen.findByRole("option", { name: /Bug/ });

    await user.click(screen.getByRole("button", { name: "switch API" }));

    expect(await screen.findByRole("option", { name: /Defect/ })).toBeTruthy();
    expect(sendBg).toHaveBeenCalledWith({
      type: "jira.listIssueTypes",
      projectKey: "API",
    });
  });

  // 중간 프로젝트의 응답이 도착하기 전에 되돌아오는 경로. 취소된 fetch는 .then·.finally가 둘 다
  // no-op이라 캐시 키와 loading을 정리하지 못하므로, 프로젝트 변경이 캐시를 비우지 않으면
  // 콤보가 영구 로딩으로 굳는다(tasks.md Task 6 검증 5).
  it("A→B→A로 되돌아와도 늦게 취소된 응답이 로딩을 붙들지 않는다", async () => {
    const user = userEvent.setup();
    let releaseApi: ((v: JiraIssueType[]) => void) | undefined;
    sendBg.mockImplementation((req: { type: string; projectKey?: string }) => {
      if (req.projectKey === "API")
        return new Promise<JiraIssueType[]>((resolve) => {
          releaseApi = resolve;
        });
      return Promise.resolve(ISSUE_TYPES);
    });
    render(<SwitchHarness />);

    await user.click(trigger());
    await screen.findByRole("option", { name: /Bug/ });

    await user.click(screen.getByRole("button", { name: "switch API" }));
    await user.click(screen.getByRole("button", { name: "switch WEB" }));
    // 뒤늦게 도착한 API 응답은 이미 취소됐다.
    releaseApi?.([{ id: "20001", name: "Defect" }]);

    expect(await screen.findByRole("option", { name: /Bug/ })).toBeTruthy();
    expect(screen.queryByText("common.loading")).toBeNull();
  });
});
