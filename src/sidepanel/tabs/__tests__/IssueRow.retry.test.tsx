import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { failedCheckpoint, retryMeta } from "@/test/retry-meta";
import type { SubmissionRecoveryMeta } from "@/types/attachment";
import type { RetryAttachmentsOutcome } from "@/sidepanel/lib/retryAttachments";

const mocks = vi.hoisted(() => ({ read: vi.fn(), run: vi.fn(), slack: vi.fn(() => false) }));
vi.mock("@/store/blob-db", () => ({ readSubmissionRecovery: mocks.read }));
vi.mock("@/store/issues-store", () => ({ isSlackPreserved: mocks.slack, useIssuesStore: (select: (s: unknown) => unknown) => select({ removeIssue: vi.fn(), issues: [] }) }));
vi.mock("@/store/settings-store", () => ({ useSettingsStore: (select: (s: unknown) => unknown) => select({ accounts: {} }) }));
vi.mock("@/i18n", () => ({ useT: () => (key: string) => key, dateBcp47: () => "en-US", getLocale: () => "en", t: (key: string) => key }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock("../statusBadges/SubmittedBadge", () => ({ SubmittedBadge: () => null }));
vi.mock("@/sidepanel/lib/retryAttachments", async (original) => ({ ...await original<typeof import("@/sidepanel/lib/retryAttachments")>(), retryAttachments: mocks.run }));
import { IssueRow } from "../IssueRow";
import { SubmitSuccessView } from "@/sidepanel/components/SubmitSuccessView";
import { resetRetrySessions } from "@/sidepanel/lib/retrySession";
import type { IssueRecord } from "@/store/issues-store";

const issue: IssueRecord = { id: "issue", platform: "github", title: "Report", status: "submitted", key: "#7", url: "https://github.com/o/r/issues/7", submissionRecoveryId: "a", createdAt: 1, updatedAt: 1, pageUrl: "", draft: { title: "Report", sections: {} }, snapshot: { before: false, after: false } };
const renderRow = (meta: SubmissionRecoveryMeta | null = retryMeta()) => {
  mocks.read.mockResolvedValue(meta);
  return render(<IssueRow issue={issue} refreshKey={0} onOpenDraft={vi.fn()} onOpenSubmit={vi.fn()} onBadgeLoaded={vi.fn()} />);
};
const settle = () => act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); });
const retryButton = () => screen.queryByTestId("recovery-row-retry");
const outcome = (patch: Partial<RetryAttachmentsOutcome> = {}): RetryAttachmentsOutcome => ({ status: "partial", attachments: [], remaining: 1, ...patch });

const locked = (id: string) => screen.getByTestId(id).getAttribute("aria-disabled") === "true";
beforeEach(() => { resetRetrySessions(); mocks.slack.mockReturnValue(false); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("row retry action", () => {
  it("sits in the same ButtonGroup as the detail button with a label", async () => {
    renderRow();
    const button = await screen.findByTestId("recovery-row-retry");
    expect(button.getAttribute("aria-label")).toBe("recovery.retry");
    expect(button.parentElement).toBe(screen.getByTestId("recovery-detail-open").parentElement);
  });

  it.each([
    ["account not verified", retryMeta({ identity: null })],
    ["phase-one record without a snapshot", retryMeta({ retry: undefined })],
    ["slot-less body", retryMeta({ slots: false })],
    ["Webhook", retryMeta({ platform: "webhook" })],
    ["local files removed", retryMeta({ localFilesRemoved: true })],
    ["unknown upload result", retryMeta({ checkpoints: [failedCheckpoint("capture:after-0", { upload: "unknown" })] })],
    ["unknown creation", retryMeta({ phase: "unknown", destination: undefined })],
    ["empty file list with a submission failure", retryMeta({ checkpoints: [], submissionFailure: { stage: "body", code: "network" } })],
  ])("hides retry and keeps detail for: %s", async (_name, meta) => {
    renderRow(meta);
    await screen.findByTestId("recovery-detail-open");
    await settle();
    expect(mocks.read).toHaveBeenCalled();
    expect(retryButton()).toBeNull();
    expect(screen.getByTestId("recovery-detail-open")).toBeTruthy();
  });

  it("starts one run for consecutive clicks and shows busy state without a spinner stuck afterwards", async () => {
    let finish!: (value: RetryAttachmentsOutcome) => void;
    mocks.run.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderRow();
    const button = await screen.findByTestId("recovery-row-retry");
    await userEvent.dblClick(button);
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run).toHaveBeenCalledWith("issue", expect.anything());
    const busy = screen.getByTestId("recovery-row-retry") as HTMLButtonElement;
    expect(busy.disabled).toBe(false);
    expect(locked("recovery-row-retry")).toBe(true);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.className).not.toMatch(/(^|\s)opacity-50/);
    expect(busy.querySelector("svg.animate-spin")).not.toBeNull();
    expect(screen.queryByTestId("recovery-file-progress")).toBeNull();
    finish(outcome({ remaining: 1 }));
    await waitFor(() => expect(locked("recovery-row-retry")).toBe(false));
    expect(screen.getByTestId("recovery-row-retry").querySelector("svg.animate-spin")).toBeNull();
  });

  it("does not open the detail when the retry button is clicked", async () => {
    mocks.run.mockResolvedValue(outcome());
    const open = vi.fn();
    mocks.read.mockResolvedValue(retryMeta());
    render(<IssueRow issue={issue} refreshKey={0} onOpenDraft={open} onOpenSubmit={vi.fn()} onBadgeLoaded={vi.fn()} />);
    await userEvent.click(await screen.findByTestId("recovery-row-retry"));
    expect(open).not.toHaveBeenCalled();
  });

  it("shows no spinner and no message when another panel holds the issue", async () => {
    mocks.run.mockResolvedValue(outcome({ status: "busy", remaining: 0 }));
    renderRow();
    await userEvent.click(await screen.findByTestId("recovery-row-retry"));
    await waitFor(() => expect(locked("recovery-row-retry")).toBe(false));
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("toasts once when the run finishes with the detail closed", async () => {
    mocks.run.mockResolvedValue(outcome({ status: "complete", remaining: 0 }));
    renderRow();
    await userEvent.click(await screen.findByTestId("recovery-row-retry"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
  });

  it("hides retry for the session after a run-level stop and keeps the detail", async () => {
    mocks.run.mockResolvedValue(outcome({ status: "blocked", reason: "remote-missing" }));
    renderRow();
    await userEvent.click(await screen.findByTestId("recovery-row-retry"));
    await waitFor(() => expect(retryButton()).toBeNull());
    expect(screen.getByTestId("recovery-detail-open")).toBeTruthy();
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it("keeps the retry button after an unknown identity lookup and shows only a static note", async () => {
    mocks.run.mockResolvedValue(outcome({ status: "blocked", reason: "ambiguous" }));
    renderRow();
    await userEvent.click(await screen.findByTestId("recovery-row-retry"));
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith("recovery.retry.summary.needsCheck"));
    expect(locked("recovery-row-retry")).toBe(false);
  });

  it("keeps the row layout inside the panel with a long multilingual title", async () => {
    mocks.read.mockResolvedValue(retryMeta());
    render(<IssueRow issue={{ ...issue, title: "非常に長い日本語のタイトル ".repeat(10) }} refreshKey={0} onOpenDraft={vi.fn()} onOpenSubmit={vi.fn()} onBadgeLoaded={vi.fn()} />);
    const group = (await screen.findByTestId("recovery-row-retry")).parentElement!;
    expect(group.className).toContain("shrink-0");
    expect(within(screen.getByTestId("issue-row")).getByText(/非常に長い/).className).toContain("truncate");
  });
});

describe("Slack promotion while retrying", () => {
  it("keeps promote aria-disabled and inert while a run is in flight", async () => {
    mocks.slack.mockReturnValue(true);
    let finish!: (value: RetryAttachmentsOutcome) => void;
    mocks.run.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const submit = vi.fn();
    mocks.read.mockResolvedValue(retryMeta());
    render(<IssueRow issue={{ ...issue, platform: "slack" }} refreshKey={0} onOpenDraft={vi.fn()} onOpenSubmit={submit} onBadgeLoaded={vi.fn()} />);
    await userEvent.click(await screen.findByTestId("recovery-row-retry"));
    expect(locked("recovery-row-retry")).toBe(true);
    expect(locked("promote-issue")).toBe(true);
    await userEvent.click(screen.getByTestId("promote-issue"));
    expect(submit).not.toHaveBeenCalled();
    finish(outcome());
    await waitFor(() => expect(locked("recovery-row-retry")).toBe(false));
    expect(locked("promote-issue")).toBe(true);
  });
});

describe("hidden success view", () => {
  it("does not swallow the list row's completion toast: a partial result toasts exactly once", async () => {
    mocks.run.mockResolvedValue(outcome({ remaining: 1 }));
    mocks.read.mockResolvedValue(retryMeta());
    const result = { key: "#7", url: issue.url!, attachments: [], recovery: { state: "partial" as const, issueId: "issue", attemptId: "a" } };
    render(<><SubmitSuccessView result={result} onClose={vi.fn()} /><IssueRow issue={issue} refreshKey={0} onOpenDraft={vi.fn()} onOpenSubmit={vi.fn()} onBadgeLoaded={vi.fn()} /></>);
    await screen.findAllByTestId("recovery-file-row");
    await userEvent.click(await screen.findByTestId("recovery-row-retry"));
    await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("recovery-retry-status")).toBeNull();
  });
});
