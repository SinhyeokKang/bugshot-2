import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SubmissionRecoveryMeta } from "@/types/attachment";
const mocks = vi.hoisted(() => ({ read: vi.fn(), bytes: vi.fn(), remove: vi.fn(), confirm: vi.fn(), download: vi.fn() }));
vi.mock("@/store/blob-db", () => ({ readSubmissionRecovery: mocks.read, readRecoveryFile: mocks.bytes }));
vi.mock("@/store/issues-store", () => ({ useIssuesStore: (select: (s: { issues: [] }) => unknown) => select({ issues: [] }) }));
vi.mock("@/sidepanel/lib/submissionRecovery", () => ({ deleteSubmissionLocalFiles: mocks.remove, confirmSubmissionNotRegistered: mocks.confirm }));
vi.mock("@/sidepanel/lib/downloadCapture", () => ({ triggerDownload: mocks.download }));
vi.mock("@/i18n", () => ({ useT: () => (key: string) => key }));
import { AttachmentRecoveryPanel } from "../AttachmentRecoveryPanel";
let meta: SubmissionRecoveryMeta;
beforeEach(() => {
  vi.clearAllMocks();
  meta = { issueId: "issue", attemptId: "a", title: "Report", platform: "notion", phase: "partial", createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 86_400_000,
    destination: { platform: "notion", key: "N", url: "https://notion.so/page", locator: { pageId: "page" } },
    files: [ { id: "logs", kind: "logs", filename: "logs.zip", contentType: "application/zip", source: { kind: "generated", key: "zip" } }, { id: "user:1", kind: "user", filename: "logs.zip", contentType: "application/pdf", source: { kind: "original", store: "attachments", key: "issue:1" } } ],
    results: [{ fileId: "logs", delivery: "failed", presentation: "failed" }, { fileId: "user:1", delivery: "unknown", presentation: "failed" }] };
  mocks.read.mockImplementation(async () => meta);
  mocks.bytes.mockImplementation(async (_meta, id) => new Blob([id === "logs" ? "frozen zip" : "original pdf"], { type: id === "logs" ? "application/zip" : "application/pdf" }));
});
afterEach(cleanup);
const panel = () => render(<AttachmentRecoveryPanel issueId="issue" attemptId="a" allowManage />);
describe("recovery interactions", () => {
  it("downloads selected frozen bytes by ID and leaves recovery incomplete", async () => {
    panel();
    const rows = await screen.findAllByTestId("recovery-file-row");
    await userEvent.click(within(rows[0]).getByTestId("recovery-file-download"));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledOnce());
    const [blob, filename] = mocks.download.mock.calls[0];
    expect(blob.type).toBe("application/zip");
    expect(filename).toBe("logs.zip");
    expect(await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(blob); })).toBe("frozen zip");
    expect(mocks.bytes).toHaveBeenLastCalledWith(meta, "logs");
    expect(rows[0].getAttribute("data-state")).toBe("failed");
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("shows missing local files after bytes vanish without reporting success", async () => {
    panel();
    const rows = await screen.findAllByTestId("recovery-file-row");
    mocks.bytes.mockResolvedValue(null);
    await userEvent.click(within(rows[0]).getByTestId("recovery-file-download"));
    expect(await within(rows[0]).findByTestId("recovery-local-missing")).toBeTruthy();
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it("unknown deletion requires confirmation, cancellation preserves data and missing state remains", async () => {
    meta = { ...meta, phase: "unknown", destination: undefined };
    mocks.remove.mockImplementation(async () => { meta = { ...meta, localFilesRemoved: true }; });
    panel();
    await userEvent.click(await screen.findByTestId("recovery-delete-local"));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "common.close" }));
    expect(mocks.remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("recovery-delete-local"));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "recovery.deleteLocal" }));
    await waitFor(() => expect(screen.queryAllByTestId("recovery-file-download")).toHaveLength(0));
    expect(screen.getAllByTestId("recovery-local-missing")).toHaveLength(2);
    expect(mocks.remove).toHaveBeenCalledWith("issue", "a");
  });
  it("unknown confirmation cancel does nothing and stale refusal retains recoverable UI", async () => {
    meta = { ...meta, phase: "unknown", destination: undefined };
    mocks.confirm.mockRejectedValue(new Error("already created"));
    panel();
    await userEvent.click(await screen.findByTestId("recovery-confirm-not-registered"));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "common.close" }));
    expect(mocks.confirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("recovery-confirm-not-registered"));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "recovery.confirmNotRegistered" }));
    expect((await screen.findByRole("alert")).textContent).toContain("recovery.error");
    expect(screen.getAllByTestId("recovery-file-row")).toHaveLength(2);
  });
  it("explains persisted zero-file submission failure and never offers unknown reset", async () => {
    meta = { ...meta, files: [], results: [], submissionFailure: { stage: "body", code: "network" } };
    panel();
    expect(await screen.findByText(/recovery.submissionFailed/)).toBeTruthy();
    expect(screen.queryByTestId("recovery-confirm-not-registered")).toBeNull();
  });
  it("never reads retained shared bytes after local removal", async () => {
    meta = { ...meta, localFilesRemoved: true };
    panel();
    expect(await screen.findAllByTestId("recovery-local-missing")).toHaveLength(2);
    expect(mocks.bytes).not.toHaveBeenCalled();
  });
  it("closes recovery only after successful unknown confirmation", async () => {
    meta = { ...meta, phase: "unknown", destination: undefined };
    let finish!: () => void;
    mocks.confirm.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    function Harness() {
      const [open, setOpen] = useState(true);
      return open ? <AttachmentRecoveryPanel issueId="issue" attemptId="a" allowManage onConfirmed={() => setOpen(false)} /> : <p>Draft ready</p>;
    }
    render(<Harness />);
    await userEvent.click(await screen.findByTestId("recovery-confirm-not-registered"));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "recovery.confirmNotRegistered" }));
    expect(screen.queryByText("Draft ready")).toBeNull();
    finish();
    expect(await screen.findByText("Draft ready")).toBeTruthy();
  });
  it("retains downloads and a useful error after local removal fails", async () => {
    mocks.remove.mockRejectedValue(new Error("storage"));
    panel();
    await userEvent.click(await screen.findByTestId("recovery-delete-local"));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "recovery.deleteLocal" }));
    expect((await screen.findByRole("alert")).textContent).toContain("recovery.error");
    expect(screen.getAllByTestId("recovery-file-download")).toHaveLength(2);
  });

  it.each([0, 2])("explains retained completion with %s files and hides unsupported management", async (count) => {
    const files = meta.files.slice(0, count);
    meta = { ...meta, phase: "complete", files, results: files.map((file) => ({ fileId: file.id, delivery: "attached", presentation: "complete" })) };
    panel();
    expect(await screen.findByText("recovery.storageFailed")).toBeTruthy();
    expect(screen.queryByTestId("recovery-delete-local")).toBeNull();
    expect(screen.queryByTestId("recovery-confirm-not-registered")).toBeNull();
  });

});
