import * as recoveryDb from "@/store/blob-db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { useIssuesStore, type IssueRecord } from "@/store/issues-store";
import { useSettingsStore } from "@/store/settings-store";
import { DraftDetailDialog } from "../DraftDetailDialog";
import { IssueListTab } from "../IssueListTab";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/i18n", async (original) => ({ ...await original<typeof import("@/i18n")>(), useT: () => (key: string) => key }));
const issue: IssueRecord = { id: "draft", platform: "jira", title: "Draft", status: "draft", captureMode: "freeform", createdAt: 1, updatedAt: 1, pageUrl: "", draft: { title: "Draft", sections: {} }, snapshot: { before: false, after: false } };
const originalRemove = useIssuesStore.getState().removeIssue;
const originalClear = useIssuesStore.getState().clearIssues;
beforeEach(() => {
  vi.stubGlobal("chrome", { storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) } } });
  useSettingsStore.setState({ accounts: {}, lastSubmitFields: {} });
  useIssuesStore.setState({ issues: [issue] });
});
afterEach(() => { cleanup(); useIssuesStore.setState({ removeIssue: originalRemove, clearIssues: originalClear, issues: [] }); vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("async deletion callers", () => {
  it("keeps draft detail open while deleting and after purge failure", async () => {
    let reject!: (error: Error) => void;
    useIssuesStore.setState({ removeIssue: vi.fn(() => new Promise<void>((_, no) => { reject = no; })) });
    const onOpenChange = vi.fn();
    render(<DraftDetailDialog issue={issue} open onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByRole("button", { name: "issueList.deleteIssue" }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "issueList.deleteIssue" }));
    expect(onOpenChange).not.toHaveBeenCalled();
    reject(new Error("disk failure"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("bg.error.unknown"));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("draft-detail-dialog")).toBeTruthy();
  });
  it("closes draft detail only after successful purge", async () => {
    let finish!: () => void;
    useIssuesStore.setState({ removeIssue: vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })) });
    const onOpenChange = vi.fn();
    render(<DraftDetailDialog issue={issue} open onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByRole("button", { name: "issueList.deleteIssue" }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "issueList.deleteIssue" }));
    expect(onOpenChange).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
  it("reports clear failure and keeps the list visible", async () => {
    useIssuesStore.setState({ clearIssues: vi.fn(async () => { throw new Error("disk failure"); }) });
    render(<IssueListTab />);
    await userEvent.click(screen.getByRole("button", { name: "issueList.deleteAll" }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "issueList.deleteAll" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("bg.error.unknown"));
    expect(screen.getByTestId("issue-row")).toBeTruthy();
  });
});

it("opens recovery read-only without connected accounts and never offers submission", async () => {
  const recovery = { ...issue, status: "submitted" as const, submissionRecoveryId: "a", key: "J-1", url: "https://example.com/J-1" };
  useIssuesStore.setState({ issues: [recovery] });
  render(<DraftDetailDialog issue={recovery} open autoOpenSubmit onOpenChange={vi.fn()} />);
  expect(screen.getByTestId("draft-detail-dialog")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "recovery.openIssue" })).toBeNull();
  expect(screen.queryByTestId("detail-submit-open")).toBeNull();
  expect(screen.queryByTestId("submit-issue")).toBeNull();
  expect(screen.queryByText("integrations.cta")).toBeNull();
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("recovery.error"));
});

it.each([true, false])("uses the current journal destination, never the previous Slack link (created=%s)", async (created) => {
  const record = { ...issue, status: "submitted" as const, platform: "slack" as const, slackPreserved: true, submissionRecoveryId: "a", url: "https://slack.com/old" };
  vi.spyOn(recoveryDb, "readSubmissionRecovery").mockResolvedValue({ title: "Report", platform: "github", createdAt: 1, updatedAt: 1, issueId: "draft", attemptId: "a", phase: created ? "partial" : "unknown", expiresAt: Date.now() + 10000, files: [], results: [], ...(created ? { destination: { platform: "github", key: "#2", url: "https://github.com/o/r/issues/2", locator: { owner: "o", repo: "r", number: "2" } } } : {}) });
  useIssuesStore.setState({ issues: [record] });
  render(<DraftDetailDialog issue={record} open onOpenChange={vi.fn()} />);
  if (created) expect((await screen.findByRole("link", { name: "recovery.openIssue" })).getAttribute("href")).toBe("https://github.com/o/r/issues/2");
  else { await screen.findByText("recovery.unknownBody"); expect(screen.queryByRole("link", { name: "recovery.openIssue" })).toBeNull(); }
});
