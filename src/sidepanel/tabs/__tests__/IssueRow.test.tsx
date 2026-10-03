import type { SubmissionRecoveryMeta } from "@/types/attachment";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

const { removeIssue, readRecovery } = vi.hoisted(() => ({ removeIssue: vi.fn(), readRecovery: vi.fn<() => Promise<SubmissionRecoveryMeta | null>>(async () => null) }));
vi.mock("@/store/blob-db", () => ({ readSubmissionRecovery: readRecovery }));
vi.mock("@/store/issues-store", () => ({ isSlackPreserved: () => false, useIssuesStore: (select: (s: unknown) => unknown) => select({ removeIssue }) }));
vi.mock("@/store/settings-store", () => ({ useSettingsStore: (select: (s: unknown) => unknown) => select({ accounts: {} }) }));
vi.mock("@/i18n", () => ({ useT: () => (key: string) => key, dateBcp47: () => "en-US", getLocale: () => "en", t: (key: string) => key }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("../statusBadges/SubmittedBadge", () => ({ SubmittedBadge: () => null }));
import { IssueRow } from "../IssueRow";
import type { IssueRecord } from "@/store/issues-store";

const rowIssue = (): IssueRecord => ({ id: "i", platform: "jira", title: "Recovery", status: "submitted", submissionRecoveryId: "a", createdAt: Date.now(), updatedAt: Date.now(), pageUrl: "", draft: { title: "Recovery", sections: {} }, snapshot: { before: false, after: false } });
const rowMeta = (): SubmissionRecoveryMeta => ({ issueId: "i", attemptId: "a", title: "Recovery", platform: "jira", phase: "partial", createdAt: 1, updatedAt: 1, expiresAt: Date.now() + 10000, files: [], results: [] });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("IssueRow deletion", () => {
  it("reports purge rejection without losing the draft or leaking a rejected promise", async () => {
    removeIssue.mockRejectedValue(new Error("IDB failure"));
    const issue: IssueRecord = { id: "a", platform: "jira", title: "Draft", status: "draft", captureMode: "freeform", createdAt: 1, updatedAt: 1, pageUrl: "", draft: { title: "Draft", sections: {} }, snapshot: { before: false, after: false } };
    render(<IssueRow issue={issue} refreshKey={0} onOpenDraft={vi.fn()} onOpenSubmit={vi.fn()} onBadgeLoaded={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "issueList.deleteDraft.title" }));
    await userEvent.click(screen.getByRole("button", { name: "issueList.deleteIssue" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("bg.error.unknown"));
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(removeIssue).toHaveBeenCalledWith("a");
  });
});

it("opens submitted recovery details with keyboard without opening remote issue", async () => {
  const open = vi.fn();
  const tabs = vi.fn();
  vi.stubGlobal("chrome", { tabs: { create: tabs } });
  const issue = { id: "i", platform: "jira", title: "Recovery", status: "submitted", key: "J-1", url: "https://example.com/1", submissionRecoveryId: "a", createdAt: Date.now(), updatedAt: Date.now(), pageUrl: "", draft: { title: "Recovery", sections: {} }, snapshot: { before: false, after: false } } as IssueRecord;
  render(<IssueRow issue={issue} refreshKey={0} onOpenDraft={open} onOpenSubmit={vi.fn()} onBadgeLoaded={vi.fn()} />);
  expect(screen.getByTestId("recovery-row-warning").textContent).toContain("recovery.needsAttention");
  screen.getByTestId("recovery-detail-open").focus();
  await userEvent.keyboard("{Enter}");
  expect(open).toHaveBeenCalledOnce();
  expect(document.activeElement).not.toBe(screen.getByTestId("recovery-detail-open"));
  await userEvent.click(screen.getByText("Recovery"));
  expect(open).toHaveBeenCalledTimes(2);
  expect(tabs).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it("shows removed local files on a persistent recovery row", async () => {
  readRecovery.mockResolvedValueOnce({ ...rowMeta(), localFilesRemoved: true });
  const issue = rowIssue();
  render(<IssueRow issue={issue} refreshKey={0} onOpenDraft={vi.fn()} onOpenSubmit={vi.fn()} onBadgeLoaded={vi.fn()} />);
  await waitFor(() => expect(screen.getByTestId("recovery-row-warning").textContent).toContain("recovery.localMissing"));
});

it("uses unknown journal state even when the previous Slack source was submitted", async () => {
  readRecovery.mockResolvedValueOnce({ ...rowMeta(), phase: "unknown" });
  const issue: IssueRecord = { ...rowIssue(), platform: "slack", key: "old", url: "https://slack.com/old" };
  render(<IssueRow issue={issue} refreshKey={0} onOpenDraft={vi.fn()} onOpenSubmit={vi.fn()} onBadgeLoaded={vi.fn()} />);
  await waitFor(() => expect(screen.getByTestId("recovery-row-warning").textContent).toContain("recovery.unknownWarning"));
});
