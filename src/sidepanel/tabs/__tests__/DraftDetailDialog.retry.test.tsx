import * as recoveryDb from "@/store/blob-db";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { retryMeta } from "@/test/retry-meta";
import { useIssuesStore, type IssueRecord } from "@/store/issues-store";
import { useSettingsStore } from "@/store/settings-store";
import { resetRetrySessions } from "@/sidepanel/lib/retrySession";
import { DraftDetailDialog } from "../DraftDetailDialog";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock("@/i18n", async (original) => ({ ...await original<typeof import("@/i18n")>(), useT: () => (key: string) => key }));

const recovering: IssueRecord = { id: "issue", platform: "slack", title: "Report", status: "submitted", slackPreserved: true, submissionRecoveryId: "a", key: "1", url: "https://slack.com/x", createdAt: 1, updatedAt: 1, pageUrl: "", captureMode: "freeform", draft: { title: "Report", sections: {} }, snapshot: { before: false, after: false } };
const finished: IssueRecord = { ...recovering, submissionRecoveryId: undefined, updatedAt: 2 };

beforeEach(() => {
  vi.stubGlobal("chrome", { storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) } } });
  useSettingsStore.setState({ accounts: {}, lastSubmitFields: {} });
  useIssuesStore.setState({ issues: [recovering] });
  resetRetrySessions();
  vi.spyOn(recoveryDb, "readRecoveryFile").mockResolvedValue(new Blob(["x"]));
  vi.spyOn(recoveryDb, "readSubmissionRecovery").mockResolvedValue(retryMeta({ issueId: "issue" }));
});
afterEach(() => { cleanup(); useIssuesStore.setState({ issues: [] }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("never enters the edit branch in the frame where a finished retry clears the recovery pointer", async () => {
  const onOpenChange = vi.fn();
  const { rerender } = render(<DraftDetailDialog issue={recovering} open onOpenChange={onOpenChange} />);
  await screen.findByTestId("recovery-retry");
  rerender(<DraftDetailDialog issue={finished} open onOpenChange={onOpenChange} />);
  expect(screen.queryByText("issueList.deleteIssue")).toBeNull();
  expect(screen.queryByTestId("draft-detail-dialog")).toBeNull();
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
});

it("still opens the editable detail for the same Slack record when it was never in recovery", () => {
  render(<DraftDetailDialog issue={finished} open onOpenChange={vi.fn()} />);
  expect(screen.getByText("issueList.deleteIssue")).toBeTruthy();
});
