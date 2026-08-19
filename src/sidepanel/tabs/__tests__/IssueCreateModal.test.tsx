import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlatformId } from "@/types/platform";

// persist 스토어가 import 시점에 chrome.storage를 찾으므로 hoisted로 먼저 심는다.
vi.hoisted(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      session: { get: async () => ({}), set: async () => {} },
    },
  };
});

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
  t: (key: string) => key,
  dateBcp47: () => "en-US",
}));

// 검증 대상은 제출 버튼 하나뿐이라 훅만 셀렉터 페이크로 갈아끼운다. settings 계열은
// connectedPlatforms 같은 실 술어가 필요해 importOriginal로 모듈을 그대로 태운다.
let accounts: Record<string, unknown> = {};
vi.mock("@/store/settings-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/settings-store")>();
  return {
    ...actual,
    useSettingsStore: (sel: (s: Record<string, unknown>) => unknown) =>
      sel({
        accounts,
        lastSubmittedPlatform: undefined,
        lastSubmitFields: {},
      }),
  };
});

vi.mock("@/store/editor-store", () => ({
  useEditorStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      setTargetPlatform: vi.fn(),
      captureMode: "screenshot",
      draft: { title: "", sections: {} },
      issueFields: {},
      setIssueFields: vi.fn(),
      onSubmitted: vi.fn(),
      attachments: [],
      currentIssueId: null,
    }),
  whenAttachmentBlobsReady: vi.fn(async () => {}),
}));

vi.mock("@/store/issues-store", () => ({
  useIssuesStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ markSubmitted: vi.fn(), markSlackShared: vi.fn(), patchIssue: vi.fn() }),
}));

vi.mock("@/store/settings-ui-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/settings-ui-store")>();
  return {
    ...actual,
    useSettingsUiStore: (sel: (s: Record<string, unknown>) => unknown) =>
      sel({ issueSections: [], attachmentsEnabled: false }),
  };
});

vi.mock("@/sidepanel/hooks/usePlatformFields", () => ({
  usePlatformFields: () => ({
    ghFields: {},
    setGhFields: vi.fn(),
    linearFields: {},
    setLinearFields: vi.fn(),
    notionFields: {},
    setNotionFields: vi.fn(),
    gitlabFields: {},
    setGitlabFields: vi.fn(),
    asanaFields: {},
    setAsanaFields: vi.fn(),
    clickupFields: {},
    setClickupFields: vi.fn(),
    slackFields: {},
    setSlackFields: vi.fn(),
  }),
}));

vi.mock("@/sidepanel/tabs/SubmitFieldsDialog", () => ({
  SubmitFieldsDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="submit-dialog" /> : null,
}));

import { IssueCreateModal } from "../IssueCreateModal";

function connect(platform: PlatformId): void {
  accounts = { [platform]: { defaults: {} } };
}

beforeEach(() => {
  accounts = {};
});

describe("IssueCreateModal 제출 버튼", () => {
  it("연동이 없으면 aria-disabled이고 클릭해도 다이얼로그가 열리지 않는다", async () => {
    render(<IssueCreateModal />);

    const button = screen.getByTestId("issue-submit-open");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    // hover를 중화하지 않으면 잠긴 버튼이 hover에서 진해져 "밝아지는데 안 눌린다"가 된다.
    expect(button.className).toContain("aria-disabled:hover:bg-primary");

    await userEvent.click(button);

    expect(screen.queryByTestId("submit-dialog")).toBeNull();
  });

  it("연동이 없으면 비활성 이유를 노출한다", async () => {
    render(<IssueCreateModal />);

    await userEvent.hover(screen.getByTestId("issue-submit-open"));

    const reason = await screen.findByTestId("issue-submit-disabled-reason");
    expect(reason.textContent).toContain("platform.empty.title");
  });

  it("연동이 있으면 aria-disabled가 false이고 이유 문구가 없다", async () => {
    connect("jira");
    render(<IssueCreateModal />);

    const button = screen.getByTestId("issue-submit-open");
    // 활성 시 "false"가 렌더돼야 Playwright의 조상 탐색이 끊기지 않는다.
    expect(button.getAttribute("aria-disabled")).toBe("false");

    await userEvent.hover(button);

    expect(screen.queryByTestId("issue-submit-disabled-reason")).toBeNull();
  });

  it("native title 툴팁을 남기지 않는다 (Radix 툴팁과 이중 노출)", () => {
    render(<IssueCreateModal />);

    expect(screen.getByTestId("issue-submit-open").hasAttribute("title")).toBe(false);
  });
});
