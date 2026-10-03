import { beforeEach, expect, it, vi } from "vitest";
const { lock, remove } = vi.hoisted(() => ({ lock: vi.fn(), remove: vi.fn() }));
vi.mock("@/store/issues-store", () => ({ withIssueOperationLock: lock }));
vi.mock("@/store/blob-db", () => ({ removeSubmissionRecoveryFiles: remove }));
import { deleteRecoveryLocalFiles } from "../deleteRecoveryLocalFiles";
beforeEach(() => vi.clearAllMocks());
it("uses the shared operation lock for local removal", async () => {
  lock.mockImplementation(async (_id, fn) => fn());
  await deleteRecoveryLocalFiles("i", "a");
  expect(lock).toHaveBeenCalledWith("i", expect.any(Function));
  expect(remove).toHaveBeenCalledWith("i", "a");
});
it("refuses active owner contention without touching storage", async () => {
  lock.mockRejectedValue(new Error("busy"));
  await expect(deleteRecoveryLocalFiles("i", "a")).rejects.toThrow("busy");
  expect(remove).not.toHaveBeenCalled();
});
