import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlatformId } from "@/types/platform";

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
  t: (key: string) => key,
  dateBcp47: () => "en-US",
}));

// 531줄·28 import라 실 스토어를 태우면 chrome.storage·IndexedDB까지 끌려온다 —
// 검증 대상은 제출 버튼 하나이므로 스토어·다이얼로그·필드 훅만 셀렉터 페이크로 갈아끼운다.
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

const dialogOpen = vi.hoisted(() => vi.fn());
vi.mock("@/sidepanel/tabs/SubmitFieldsDialog", () => ({
  SubmitFieldsDialog: ({ open }: { open: boolean }) => {
    dialogOpen(open);
    return open ? <div data-testid="submit-dialog" /> : null;
  },
}));

import { IssueCreateModal } from "../IssueCreateModal";

function connect(platform: PlatformId): void {
  accounts = { [platform]: { defaults: {} } };
}

beforeEach(() => {
  accounts = {};
  dialogOpen.mockReset();
});

describe("IssueCreateModal 제출 버튼", () => {
  it("연동이 없으면 aria-disabled이고 클릭해도 다이얼로그가 열리지 않는다", async () => {
    render(<IssueCreateModal />);

    const button = screen.getByTestId("issue-submit-open");
    expect(button.getAttribute("aria-disabled")).toBe("true");

    await userEvent.click(button);

    expect(screen.queryByTestId("submit-dialog")).toBeNull();
  });

  it("연동이 없으면 비활성 이유를 노출한다", async () => {
    render(<IssueCreateModal />);

    await userEvent.hover(screen.getByTestId("issue-submit-open"));

    expect((await screen.findAllByText("platform.empty.title")).length).toBeGreaterThan(0);
  });

  it("연동이 있으면 aria-disabled가 false이고 이유 문구가 없다", async () => {
    connect("jira");
    render(<IssueCreateModal />);

    const button = screen.getByTestId("issue-submit-open");
    // 활성 시 "false"가 렌더돼야 Playwright의 조상 탐색이 끊기지 않는다.
    expect(button.getAttribute("aria-disabled")).toBe("false");

    await userEvent.hover(button);

    expect(screen.queryByText("platform.empty.title")).toBeNull();
  });

  it("native title 툴팁을 남기지 않는다 (Radix 툴팁과 이중 노출)", () => {
    render(<IssueCreateModal />);

    expect(screen.getByTestId("issue-submit-open").hasAttribute("title")).toBe(false);
  });
});
