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
afterEach(() => { cleanup(); useIssuesStore.setState({ removeIssue: originalRemove, clearIssues: originalClear, issues: [] }); vi.clearAllMocks(); vi.unstubAllGlobals(); });

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
