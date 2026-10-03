import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { failedCheckpoint, retryMeta } from "@/test/retry-meta";
import type { SubmissionRecoveryMeta } from "@/types/attachment";

const mocks = vi.hoisted(() => ({ read: vi.fn(), bytes: vi.fn(), remove: vi.fn(), confirm: vi.fn() }));
vi.mock("@/store/blob-db", () => ({ readSubmissionRecovery: mocks.read, readRecoveryFile: mocks.bytes }));
vi.mock("@/store/issues-store", () => ({ useIssuesStore: (select: (s: { issues: [] }) => unknown) => select({ issues: [] }) }));
vi.mock("@/sidepanel/lib/submissionRecovery", () => ({ deleteSubmissionLocalFiles: mocks.remove, confirmSubmissionNotRegistered: mocks.confirm }));
vi.mock("@/sidepanel/lib/downloadCapture", () => ({ triggerDownload: vi.fn() }));
vi.mock("@/i18n", () => ({ useT: () => (key: string, params?: Record<string, unknown>) => params ? `${key}:${JSON.stringify(params)}` : key }));
import { AttachmentRecoveryPanel } from "../AttachmentRecoveryPanel";
import { resetRetrySessions, useRetrySessions } from "@/sidepanel/lib/retrySession";

const session = (patch: Partial<ReturnType<typeof useRetrySessions.getState>["sessions"][string]> = {}) =>
  useRetrySessions.setState({ sessions: { issue: { running: false, progress: {}, summary: null, stopReason: null, finishedAt: 0, ...patch } } });
const load = async (meta: SubmissionRecoveryMeta) => {
  mocks.read.mockResolvedValue(meta);
  mocks.bytes.mockResolvedValue(new Blob(["x"]));
  render(<AttachmentRecoveryPanel issueId="issue" attemptId="a" allowManage />);
  await screen.findAllByTestId("recovery-file-row");
};
const notice = () => screen.queryByTestId("recovery-retry-notice");

beforeEach(() => { resetRetrySessions(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("recovery notice per unavailable state", () => {
  it.each([
    ["legacy", retryMeta({ retry: undefined }), undefined],
    ["account-unverified", retryMeta({ identity: null }), undefined],
    ["webhook-unsupported", retryMeta({ platform: "webhook" }), undefined],
    ["ambiguous", retryMeta({ checkpoints: [failedCheckpoint("capture:after-0", { upload: "unknown" })] }), undefined],
    ["body-conflict", retryMeta({ checkpoints: [failedCheckpoint("capture:after-0", { upload: "done", body: "conflict", uploaded: { platform: "github", href: "https://x" } })] }), undefined],
    ["remote-missing", retryMeta(), "remote-missing"],
    ["permission", retryMeta(), "permission"],
    ["authentication", retryMeta(), "authentication"],
    ["account-changed", retryMeta(), "account-changed"],
  ] as const)("explains %s with its own copy", async (reason, meta, stopReason) => {
    if (stopReason) session({ stopReason });
    await load(meta);
    expect(notice()?.getAttribute("data-reason")).toBe(reason);
    expect(notice()?.textContent).toBe(`recovery.retry.reason.${reason}`);
  });

  it("says nothing extra for a retryable record", async () => {
    await load(retryMeta());
    expect(notice()).toBeNull();
  });

  it("keeps downloads available whatever the reason", async () => {
    session({ stopReason: "account-changed" });
    await load(retryMeta());
    expect(screen.getAllByTestId("recovery-file-download")).toHaveLength(1);
  });

  it("marks a conflicted file in its own row", async () => {
    const meta = retryMeta({ checkpoints: [failedCheckpoint("capture:after-0", { upload: "done", body: "conflict", uploaded: { platform: "github", href: "https://x" } })] });
    meta.results[0] = { fileId: "capture:after-0", delivery: "attached", presentation: "failed", failure: { stage: "body", code: "unknown" } };
    await load(meta);
    expect(within(screen.getByTestId("recovery-file-row")).getByText("recovery.retry.fileConflict")).toBeTruthy();
  });
});

describe("running state", () => {
  it("shows per-file progress only inside the detail panel rows", async () => {
    session({ running: true, progress: { "capture:after-0": { stage: "upload", state: "running" } } });
    await load(retryMeta());
    const progress = within(screen.getByTestId("recovery-file-row")).getByTestId("recovery-file-progress");
    expect(progress.textContent).toContain("recovery.retry.stage.upload");
    expect(progress.textContent).toContain("recovery.retry.progress.running");
  });

  it("blocks local-copy deletion and registration confirmation while a retry runs", async () => {
    session({ running: true });
    await load(retryMeta({ phase: "partial" }));
    const remove = screen.getByTestId("recovery-delete-local");
    expect(remove.getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(remove);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("keeps long multilingual file names truncated with the full name on hover and wraps notices", async () => {
    const name = "とても長い日本語のファイル名".repeat(8) + ".webp";
    const meta = retryMeta();
    meta.files[0] = { ...meta.files[0], filename: name };
    session({ stopReason: "permission" });
    await load(meta);
    const title = screen.getByTitle(name);
    expect(title.className).toContain("truncate");
    expect(notice()?.className).toContain("break-words");
  });
});

describe("live region", () => {
  it("exists before any result and announces a summary exactly once", async () => {
    await load(retryMeta());
    const region = screen.getByTestId("recovery-retry-status");
    expect(region.getAttribute("role")).toBe("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("");
    act(() => { session({ summary: { kind: "partial", n: 2 } }); });
    expect(screen.getAllByRole("status").filter((el) => el.textContent?.includes("recovery.retry.summary.partial"))).toHaveLength(1);
    expect(region.textContent).toBe('recovery.retry.summary.partial:{"n":2}');
  });

  it("registers as an open detail while mounted, so a finished run is announced here instead of toasted", async () => {
    await load(retryMeta());
    expect(useRetrySessions.getState().details.issue).toBe(1);
    cleanup();
    expect(useRetrySessions.getState().details.issue ?? 0).toBe(0);
  });

  it("reloads the journal when a run finishes", async () => {
    await load(retryMeta());
    const reads = mocks.read.mock.calls.length;
    act(() => { session({ finishedAt: 5 }); });
    await waitFor(() => expect(mocks.read.mock.calls.length).toBeGreaterThan(reads));
  });
});
