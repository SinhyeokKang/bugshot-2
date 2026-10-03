import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { mockWebLocks } from "@/test/web-locks";
import { retryMeta } from "@/test/retry-meta";
import type { IssueRecord } from "@/store/issues-store";
import type { RetryAttachmentsOutcome } from "@/sidepanel/lib/retryAttachments";

const mocks = vi.hoisted(() => ({ run: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, warning: mocks.warning, error: mocks.error } }));
vi.mock("@/i18n", async (original) => ({ ...await original<typeof import("@/i18n")>(), useT: () => (key: string) => key, t: (key: string) => key }));
vi.mock("../statusBadges/SubmittedBadge", () => ({ SubmittedBadge: () => <span>Submitted</span> }));
vi.mock("@/sidepanel/lib/retryAttachments", async (original) => ({ ...await original<typeof import("@/sidepanel/lib/retryAttachments")>(), retryAttachments: mocks.run }));

const FILE = "capture:after-0";
const record: IssueRecord = { id: "issue", title: "Report", platform: "github", key: "#7", url: "https://github.com/o/r/issues/7", status: "submitted", submissionRecoveryId: "a", createdAt: 1, updatedAt: 1, pageUrl: "", draft: { title: "Report", sections: {} }, snapshot: { before: false, after: false } };
const outcome = (patch: Partial<RetryAttachmentsOutcome> = {}): RetryAttachmentsOutcome => ({ status: "partial", attachments: [], remaining: 1, ...patch });

async function boot(patch: Parameters<typeof retryMeta>[0] = {}) {
  vi.resetModules();
  mockWebLocks();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const saved: Record<string, unknown> = {};
  vi.stubGlobal("chrome", { tabs: { create: vi.fn() }, storage: { local: { get: async () => ({ ...saved }), set: async (values: Record<string, unknown>) => { Object.assign(saved, values); } }, session: { get: async () => ({}) } }, runtime: { sendMessage: vi.fn() } });
  const db = await import("@/store/blob-db");
  const { useIssuesStore } = await import("@/store/issues-store");
  const { useSettingsStore } = await import("@/store/settings-store");
  const { IssueListTab } = await import("../IssueListTab");
  const sub = await import("@/sidepanel/lib/submissionRecovery");
  await useIssuesStore.persist.rehydrate();
  await useSettingsStore.persist.rehydrate();
  useSettingsStore.setState({ accounts: {} });
  useIssuesStore.setState({ issues: [record] });
  const meta = retryMeta(patch);
  await db.beginSubmissionRecovery({ issueId: "issue", attemptId: "a", title: "Report", platform: meta.platform, phase: "prepared", createdAt: 1, updatedAt: 1, expiresAt: Date.now() + 10 * 86_400_000,
    files: meta.files, results: [] }, new Map(meta.files.map((f) => [f.source.key, new Blob(["bytes"])])));
  if (meta.retry) await db.initializeAttachmentRetry("issue", "a", { ...meta.retry, revision: 0 });
  await db.checkpointSubmission("issue", "a", { phase: "creating", results: [] });
  await db.checkpointSubmission("issue", "a", { phase: "created", destination: meta.destination, results: [] });
  await db.checkpointSubmission("issue", "a", { phase: "partial", destination: meta.destination, results: meta.results });
  render(<IssueListTab />);
  return { db, sub, useIssuesStore };
}
const openDetail = async () => { await userEvent.click(await screen.findByTestId("recovery-detail-open")); return screen.findByTestId("draft-detail-dialog"); };

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("footer retry runs once, shows per-file progress only in the detail, and announces one summary", async () => {
  await boot();
  let progress!: (e: { fileId: string; stage: "upload"; state: "running" }) => void;
  let finish!: (value: RetryAttachmentsOutcome) => void;
  mocks.run.mockImplementation((_id: string, options: { onProgress: typeof progress }) => { progress = options.onProgress; return new Promise((resolve) => { finish = resolve; }); });
  const dialog = await openDetail();
  const retry = await within(dialog).findByTestId("recovery-retry");
  await userEvent.dblClick(retry);
  expect(mocks.run).toHaveBeenCalledTimes(1);
  expect((within(dialog).getByTestId("recovery-retry") as HTMLButtonElement).disabled).toBe(true);
  expect(within(dialog).getByTestId("recovery-retry").getAttribute("aria-busy")).toBe("true");
  act(() => progress({ fileId: FILE, stage: "upload", state: "running" }));
  expect(within(dialog).getByTestId("recovery-file-progress")).toBeTruthy();
  expect(within(dialog).getByTestId("recovery-delete-local").getAttribute("aria-disabled")).toBe("true");
  expect((screen.getByTestId("recovery-row-retry") as HTMLButtonElement).disabled).toBe(true);
  expect(within(dialog).getByTestId("recovery-retry-status").textContent).toBe("");
  await act(async () => finish(outcome({ remaining: 1 })));
  await waitFor(() => expect(within(dialog).getByTestId("recovery-retry-status").textContent).toBe("recovery.retry.summary.partial"));
  expect(mocks.warning).not.toHaveBeenCalled();
  expect((within(dialog).getByTestId("recovery-retry") as HTMLButtonElement).disabled).toBe(false);
  expect(within(dialog).queryByTestId("recovery-file-progress")).toBeNull();
});

it("a finished run removes the warning and toasts success once", async () => {
  const { db, sub } = await boot();
  mocks.run.mockImplementation(async () => {
    await db.checkpointSubmission("issue", "a", { phase: "complete", destination: (await db.readSubmissionRecovery("issue"))!.destination, results: [{ fileId: FILE, delivery: "attached", presentation: "complete" }] });
    await sub.completeRecoveredSubmission((await db.readSubmissionRecovery("issue"))!);
    return outcome({ status: "complete", remaining: 0 });
  });
  expect(await screen.findByTestId("recovery-row-warning")).toBeTruthy();
  await userEvent.click(await screen.findByTestId("recovery-row-retry"));
  await waitFor(() => expect(screen.queryByTestId("recovery-row-warning")).toBeNull());
  expect(screen.queryByTestId("recovery-row-retry")).toBeNull();
  expect(mocks.success).toHaveBeenCalledTimes(1);
  expect(await db.readSubmissionRecovery("issue")).toBeNull();
});

it("completing from the detail closes the detail and still toasts once", async () => {
  const { db, sub } = await boot();
  mocks.run.mockImplementation(async () => {
    await db.checkpointSubmission("issue", "a", { phase: "complete", destination: (await db.readSubmissionRecovery("issue"))!.destination, results: [{ fileId: FILE, delivery: "attached", presentation: "complete" }] });
    await sub.completeRecoveredSubmission((await db.readSubmissionRecovery("issue"))!);
    return outcome({ status: "complete", remaining: 0 });
  });
  const dialog = await openDetail();
  await userEvent.click(await within(dialog).findByTestId("recovery-retry"));
  await waitFor(() => expect(screen.queryByTestId("draft-detail-dialog")).toBeNull());
  expect(mocks.success).toHaveBeenCalledTimes(1);
  expect(mocks.warning).not.toHaveBeenCalled();
});

it("a run-level stop hides the footer retry, keeps download and explains why", async () => {
  await boot();
  mocks.run.mockResolvedValue(outcome({ status: "blocked", reason: "account-changed" }));
  const dialog = await openDetail();
  await userEvent.click(await within(dialog).findByTestId("recovery-retry"));
  await waitFor(() => expect(within(dialog).queryByTestId("recovery-retry")).toBeNull());
  expect(within(dialog).getByTestId("recovery-retry-notice").getAttribute("data-reason")).toBe("account-changed");
  expect(await within(dialog).findAllByTestId("recovery-file-row")).toHaveLength(1);
  expect(within(dialog).getByRole("link", { name: "recovery.openIssue" })).toBeTruthy();
});

it("a missing remote issue also drops the issue link", async () => {
  await boot();
  mocks.run.mockResolvedValue(outcome({ status: "blocked", reason: "remote-missing" }));
  const dialog = await openDetail();
  await userEvent.click(await within(dialog).findByTestId("recovery-retry"));
  await waitFor(() => expect(within(dialog).queryByTestId("recovery-retry")).toBeNull());
  expect(within(dialog).queryByRole("link", { name: "recovery.openIssue" })).toBeNull();
  expect(await within(dialog).findAllByTestId("recovery-file-row")).toHaveLength(1);
});

it("a retry made from the row while the detail is closed toasts the partial result once and keeps no stale status", async () => {
  await boot();
  mocks.run.mockResolvedValue(outcome({ remaining: 2 }));
  await userEvent.click(await screen.findByTestId("recovery-row-retry"));
  await waitFor(() => expect(mocks.warning).toHaveBeenCalledTimes(1));
  const dialog = await openDetail();
  expect(within(dialog).getByTestId("recovery-retry-status").textContent).toBe("");
});

it("a slot-less legacy record offers download only: no retry in row or detail", async () => {
  await boot({ slots: false });
  await screen.findByTestId("recovery-row-warning");
  expect(screen.queryByTestId("recovery-row-retry")).toBeNull();
  const dialog = await openDetail();
  expect(await within(dialog).findAllByTestId("recovery-file-row")).toHaveLength(1);
  expect(within(dialog).queryByTestId("recovery-retry")).toBeNull();
  expect(within(dialog).getByTestId("recovery-retry-notice").getAttribute("data-reason")).toBe("legacy");
});
