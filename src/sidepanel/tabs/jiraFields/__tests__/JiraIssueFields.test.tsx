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

// settings store는 chrome.storage에서 비동기로 하이드레이트되므로 마운트 직후 auth가 잠깐
// 비는 프레임이 실재한다 — 그 상태를 재현하려면 계정이 상수가 아니어야 한다.
let account: unknown = JIRA_ACCOUNT;

vi.mock("@/store/settings-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/settings-store")>();
  return {
    ...actual,
    useSettingsStore: (sel: (s: { accounts: Record<string, unknown> }) => unknown) =>
      sel({ accounts: { jira: account } }),
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

// 스프린트 판정은 다이얼로그를 열 때마다 선제로 나간다 — 기본은 "필드 없음"이라
// 기존 시나리오의 화면 구성이 바뀌지 않는다.
function defaultRoutes(req: { type: string; projectKey?: string }) {
  if (req.type === "jira.listProjects") return Promise.resolve(PROJECTS);
  if (req.type === "jira.listIssueTypes")
    return Promise.resolve(req.projectKey === "API" ? API_TYPES : WEB_TYPES);
  if (req.type === "jira.sprintFieldMeta") return Promise.resolve(null);
  if (req.type === "jira.listSprints")
    return Promise.resolve({ sprints: [], multiBoard: false });
  if (req.type === "jira.getSprint") return Promise.resolve(null);
  return Promise.resolve([]);
}

beforeEach(() => {
  account = JIRA_ACCOUNT;
  sendBg.mockReset();
  sendBg.mockImplementation(defaultRoutes);
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

  it("프로젝트를 바꾸면 스프린트도 비운다", async () => {
    const user = userEvent.setup();
    const onPatch = vi.fn();
    render(
      <Harness
        onPatch={onPatch}
        initial={{
          projectKey: "WEB",
          issueTypeId: "10001",
          sprintId: 42,
          sprintName: "Sprint 24",
        }}
      />,
    );

    await user.click(projectTrigger());
    await user.click(await screen.findByText("API Service"));

    expect(onPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        projectKey: "API",
        sprintId: undefined,
        sprintName: undefined,
      }),
    );
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

// ── 스프린트 행 ───────────────────────────────────────────────────────────
// 판정 캐시가 모듈 스코프(useSprintFieldMeta)라 케이스끼리 (projectKey, issueTypeId)가 겹치면
// 서로를 오염시킨다 — 케이스마다 다른 projectKey를 쓴다.

const SPRINT_META = { fieldId: "customfield_10020", isArray: true };

// 필수 행은 라벨 안에 별표 span이 있어 textContent에 "*"가 붙는다.
function rowLabels(): string[] {
  return Array.from(document.querySelectorAll("label")).map((el) =>
    (el.textContent ?? "").replace(/\*$/, ""),
  );
}

function sprintTrigger() {
  return screen.queryByTestId("jira-sprint-combobox");
}

// meta·getSprint만 갈아끼우고 나머지는 기본 라우트를 그대로 쓴다.
function routeSprint(overrides: {
  meta?: unknown | (() => Promise<unknown>);
  sprint?: unknown | (() => Promise<unknown>);
}) {
  sendBg.mockImplementation((req: { type: string; projectKey?: string }) => {
    if (req.type === "jira.sprintFieldMeta" && overrides.meta !== undefined)
      return typeof overrides.meta === "function"
        ? (overrides.meta as () => Promise<unknown>)()
        : Promise.resolve(overrides.meta);
    if (req.type === "jira.getSprint" && overrides.sprint !== undefined)
      return typeof overrides.sprint === "function"
        ? (overrides.sprint as () => Promise<unknown>)()
        : Promise.resolve(overrides.sprint);
    return defaultRoutes(req);
  });
}

describe("JiraIssueFields — 스프린트 행 노출", () => {
  it("판정이 필드 있음이면 이슈타입 바로 아래에 스프린트 행이 온다", async () => {
    routeSprint({ meta: SPRINT_META });
    render(<Harness initial={{ projectKey: "SP1", issueTypeId: "10001" }} />);

    await waitFor(() => expect(sprintTrigger()).not.toBeNull());
    const order = rowLabels();
    expect(order.indexOf("create.sprint")).toBe(
      order.indexOf("create.issueType") + 1,
    );
  });

  // 칸반·보드 미연결·에픽 타입은 열거하지 않는다 — createmeta가 "없다"고 답하면 그게 전부다.
  it("판정이 필드 없음이면 스프린트 행이 아예 없다", async () => {
    routeSprint({ meta: null });
    render(<Harness initial={{ projectKey: "SP2", issueTypeId: "10001" }} />);

    await waitFor(() =>
      expect(screen.getByTestId("jira-issue-type-combobox")).toBeTruthy(),
    );
    expect(sprintTrigger()).toBeNull();
    expect(rowLabels()).not.toContain("create.sprint");
  });

  // 자리를 예약하지 않으면 판정이 끝나는 순간 아래 5개 행이 한 칸씩 밀린다.
  it("판정 중에는 로딩을 그리고 아래 행들의 순서는 판정 전후로 같다", async () => {
    let release: ((v: unknown) => void) | undefined;
    routeSprint({
      meta: () => new Promise((resolve) => { release = resolve; }),
    });
    render(<Harness initial={{ projectKey: "SP3", issueTypeId: "10001" }} />);

    await waitFor(() => expect(screen.getByText("common.loading")).toBeTruthy());
    const during = rowLabels().filter((l) => l !== "create.sprint");

    release?.(SPRINT_META);

    await waitFor(() => expect(sprintTrigger()).not.toBeNull());
    expect(rowLabels().filter((l) => l !== "create.sprint")).toEqual(during);
  });
});

describe("JiraIssueFields — 스프린트 값 정리·검증", () => {
  it("판정이 필드 없음이면 남아 있던 스프린트 값을 비운다", async () => {
    routeSprint({ meta: null });
    const onPatch = vi.fn();
    render(
      <Harness
        onPatch={onPatch}
        initial={{
          projectKey: "SP4",
          issueTypeId: "10001",
          sprintId: 42,
          sprintName: "Sprint 24",
        }}
      />,
    );

    await waitFor(() =>
      expect(onPatch).toHaveBeenCalledWith({
        sprintId: undefined,
        sprintName: undefined,
      }),
    );
  });

  // 비우기와 검증이 같은 sprintId에 쓰기를 하므로 meta가 null이면 검증은 아예 돌지 않아야 한다.
  it("판정이 필드 없음이면 sprintId가 있어도 검증을 요청하지 않는다", async () => {
    routeSprint({ meta: null });
    render(
      <Harness
        initial={{
          projectKey: "SP5",
          issueTypeId: "10001",
          sprintId: 42,
          sprintName: "Sprint 24",
        }}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("jira-issue-type-combobox")).toBeTruthy(),
    );
    expect(
      sendBg.mock.calls.some(
        (c) => (c[0] as { type: string }).type === "jira.getSprint",
      ),
    ).toBe(false);
  });

  it("복원된 스프린트가 없으면 검증을 요청하지 않는다", async () => {
    routeSprint({ meta: SPRINT_META });
    render(<Harness initial={{ projectKey: "SP6", issueTypeId: "10001" }} />);

    await waitFor(() => expect(sprintTrigger()).not.toBeNull());
    expect(
      sendBg.mock.calls.some(
        (c) => (c[0] as { type: string }).type === "jira.getSprint",
      ),
    ).toBe(false);
  });

  // 저장된 이름을 먼저 보여주면 무효 판정에서 "골라놨던 게 사라졌다"로 읽힌다 —
  // placeholder → 값 방향으로만 움직인다.
  it("검증이 끝나기 전에는 저장된 스프린트 이름을 트리거에 보여주지 않는다", async () => {
    let release: ((v: unknown) => void) | undefined;
    routeSprint({
      meta: SPRINT_META,
      sprint: () => new Promise((resolve) => { release = resolve; }),
    });
    render(
      <Harness
        initial={{
          projectKey: "SP7",
          issueTypeId: "10001",
          sprintId: 42,
          sprintName: "Sprint 24",
        }}
      />,
    );

    await waitFor(() => expect(sprintTrigger()).not.toBeNull());
    expect(sprintTrigger()!.textContent).not.toContain("Sprint 24");

    release?.({ id: 42, name: "Sprint 24", state: "active" });

    await waitFor(() =>
      expect(sprintTrigger()!.textContent).toContain("Sprint 24"),
    );
  });

  it("검증에서 닫힌 스프린트로 판명되면 값을 비운다", async () => {
    routeSprint({
      meta: SPRINT_META,
      sprint: { id: 42, name: "Sprint 24", state: "closed" },
    });
    const onPatch = vi.fn();
    render(
      <Harness
        onPatch={onPatch}
        initial={{
          projectKey: "SP8",
          issueTypeId: "10001",
          sprintId: 42,
          sprintName: "Sprint 24",
        }}
      />,
    );

    await waitFor(() =>
      expect(onPatch).toHaveBeenCalledWith({
        sprintId: undefined,
        sprintName: undefined,
      }),
    );
  });

  // 판정 요청이 실패한 건 "필드가 없다"가 아니다. 실패를 확정으로 읽으면 429 한 번에
  // 사용자가 고른 스프린트가 사라지고, 그 사실이 화면에 드러나지도 않는다.
  it("판정 요청이 실패하면 스프린트 값을 지우지 않는다", async () => {
    routeSprint({ meta: () => Promise.reject(new Error("boom")) });
    const onPatch = vi.fn();
    render(
      <Harness
        onPatch={onPatch}
        initial={{
          projectKey: "SPF",
          issueTypeId: "10001",
          sprintId: 42,
          sprintName: "Sprint 24",
        }}
      />,
    );

    await waitFor(() => expect(screen.queryByText("common.loading")).toBeNull());
    expect(onPatch).not.toHaveBeenCalledWith({
      sprintId: undefined,
      sprintName: undefined,
    });
  });

  // 값은 남는데 행이 없으면 사용자는 그 스프린트를 보지도 해제하지도 못한 채 제출한다.
  // 행만 뜨고 라벨이 비어도 "무엇이 실려 나가는가"는 여전히 안 보이므로 이름까지 봐야 한다.
  it("판정 요청이 실패해도 값이 남아 있으면 행과 이름을 보여준다", async () => {
    routeSprint({ meta: () => Promise.reject(new Error("boom")) });
    render(
      <Harness
        initial={{
          projectKey: "SPG",
          issueTypeId: "10001",
          sprintId: 42,
          sprintName: "Sprint 24",
        }}
      />,
    );

    await waitFor(() => expect(sprintTrigger()).not.toBeNull());
    expect(sprintTrigger()!.textContent).toContain("Sprint 24");
  });

  // settings store 하이드레이트 전 프레임은 auth가 없어 판정 키를 만들 수 없다. 그걸
  // "서버가 없다고 답했다"로 읽으면 복원된 스프린트가 마운트 직후 지워진다.
  it("인증이 아직 없으면 판정을 안 물어본 것이므로 값을 비우지 않는다", async () => {
    account = { platform: "jira", projectKey: "WEB", issueTypeId: "10001" };
    const onPatch = vi.fn();
    render(
      <Harness
        onPatch={onPatch}
        initial={{
          projectKey: "SPI",
          issueTypeId: "10001",
          sprintId: 42,
          sprintName: "Sprint 24",
        }}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("jira-issue-type-combobox")).toBeTruthy(),
    );
    expect(
      sendBg.mock.calls.some(
        (c) => (c[0] as { type: string }).type === "jira.sprintFieldMeta",
      ),
    ).toBe(false);
    expect(onPatch).not.toHaveBeenCalledWith({
      sprintId: undefined,
      sprintName: undefined,
    });
  });

  it("판정 요청이 실패했고 값도 없으면 행을 그리지 않는다", async () => {
    routeSprint({ meta: () => Promise.reject(new Error("boom")) });
    render(<Harness initial={{ projectKey: "SPH", issueTypeId: "10001" }} />);

    await waitFor(() => expect(screen.queryByText("common.loading")).toBeNull());
    expect(sprintTrigger()).toBeNull();
  });

  // 검증 응답이 오는 사이 사용자가 목록에서 다른 스프린트를 고를 수 있다. 늦게 온 판정이
  // 그 선택을 덮으면 방금 고른 값이 사라지거나 id/name 쌍이 어긋난다.
  it("검증 응답이 늦게 와도 그 사이 사용자가 고른 스프린트를 덮지 않는다", async () => {
    const user = userEvent.setup();
    let release: ((v: unknown) => void) | undefined;
    sendBg.mockImplementation((req: { type: string; projectKey?: string }) => {
      if (req.type === "jira.sprintFieldMeta") return Promise.resolve(SPRINT_META);
      if (req.type === "jira.getSprint")
        return new Promise((resolve) => {
          release = resolve;
        });
      if (req.type === "jira.listSprints")
        return Promise.resolve({
          sprints: [
            { id: 43, name: "Sprint 25", state: "active" },
          ],
          multiBoard: false,
        });
      return defaultRoutes(req);
    });
    const onPatch = vi.fn();
    render(
      <Harness
        onPatch={onPatch}
        initial={{
          projectKey: "SPX",
          issueTypeId: "10001",
          sprintId: 42,
          sprintName: "Sprint 24",
        }}
      />,
    );

    await waitFor(() => expect(sprintTrigger()).not.toBeNull());
    await user.click(sprintTrigger()!);
    await user.click(await screen.findByText("Sprint 25"));

    // 뒤늦게 도착한 42번 검증 결과(닫힘)는 이미 사용자 선택에 밀렸다.
    release?.({ id: 42, name: "Sprint 24", state: "closed" });

    await waitFor(() =>
      expect(sprintTrigger()!.textContent).toContain("Sprint 25"),
    );
    expect(onPatch).not.toHaveBeenCalledWith({
      sprintId: undefined,
      sprintName: undefined,
    });
  });

  // S4: 이슈타입을 왕복하면 비우기가 한 번 돌고 다시 필드가 생긴다. 이때 값이 되살아나면
  // 사용자가 안 고른 스프린트로 제출된다.
  it("이슈타입을 왕복해도 비워진 스프린트 값이 되살아나지 않는다", async () => {
    const user = userEvent.setup();
    sendBg.mockImplementation((req: {
      type: string;
      projectKey?: string;
      issueTypeId?: string;
    }) => {
      if (req.type === "jira.listIssueTypes")
        return Promise.resolve([
          { id: "10001", name: "Bug" },
          { id: "10009", name: "Epic", hierarchyLevel: 1 },
        ]);
      if (req.type === "jira.sprintFieldMeta")
        return Promise.resolve(req.issueTypeId === "10001" ? SPRINT_META : null);
      if (req.type === "jira.getSprint")
        return Promise.resolve({
          id: 42,
          name: "Sprint 24",
          state: "active",
        });
      return defaultRoutes(req);
    });
    render(
      <Harness
        initial={{
          projectKey: "SP9",
          issueTypeId: "10001",
          sprintId: 42,
          sprintName: "Sprint 24",
        }}
      />,
    );

    await waitFor(() =>
      expect(sprintTrigger()!.textContent).toContain("Sprint 24"),
    );

    await user.click(screen.getByTestId("jira-issue-type-combobox"));
    await user.click(await screen.findByRole("option", { name: /Epic/ }));
    await waitFor(() => expect(sprintTrigger()).toBeNull());

    await user.click(screen.getByTestId("jira-issue-type-combobox"));
    await user.click(await screen.findByRole("option", { name: /Bug/ }));

    await waitFor(() => expect(sprintTrigger()).not.toBeNull());
    expect(sprintTrigger()!.textContent).not.toContain("Sprint 24");
  });
});
