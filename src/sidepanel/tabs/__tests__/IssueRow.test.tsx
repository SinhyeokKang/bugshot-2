import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

const { removeIssue } = vi.hoisted(() => ({ removeIssue: vi.fn() }));
vi.mock("@/store/issues-store", () => ({ isSlackPreserved: () => false, useIssuesStore: (select: (s: unknown) => unknown) => select({ removeIssue }) }));
vi.mock("@/store/settings-store", () => ({ useSettingsStore: (select: (s: unknown) => unknown) => select({ accounts: {} }) }));
vi.mock("@/i18n", () => ({ useT: () => (key: string) => key, dateBcp47: () => "en-US", getLocale: () => "en", t: (key: string) => key }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("../statusBadges/SubmittedBadge", () => ({ SubmittedBadge: () => null }));
import { IssueRow } from "../IssueRow";
import type { IssueRecord } from "@/store/issues-store";

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
