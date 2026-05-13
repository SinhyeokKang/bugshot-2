import { describe, expect, it } from "vitest";
import { findOrphanPendingKeys } from "../pending-log-prune";

describe("findOrphanPendingKeys", () => {
  it("returns pending keys whose tabId is not in activeTabIds", () => {
    const keys = ["pending:123", "pending:456", "pending:789"];
    const active = new Set([123, 789]);
    expect(findOrphanPendingKeys(keys, active)).toEqual(["pending:456"]);
  });

  it("ignores non-pending keys (issue blob keys)", () => {
    const keys = [
      "abc123-issue-id",
      "abc123-issue-id:before",
      "pending:42",
    ];
    expect(findOrphanPendingKeys(keys, new Set())).toEqual(["pending:42"]);
  });

  it("empty active set: all pending keys are orphans", () => {
    expect(
      findOrphanPendingKeys(["pending:1", "pending:2"], new Set()),
    ).toEqual(["pending:1", "pending:2"]);
  });

  it("all tabIds active: no orphans", () => {
    expect(
      findOrphanPendingKeys(["pending:1", "pending:2"], new Set([1, 2])),
    ).toEqual([]);
  });

  it("malformed pending key (non-numeric tabId) treated as orphan", () => {
    expect(
      findOrphanPendingKeys(["pending:abc", "pending:"], new Set([0])),
    ).toEqual(["pending:abc", "pending:"]);
  });

  it("float tabId treated as orphan (Number.isInteger guard)", () => {
    expect(findOrphanPendingKeys(["pending:1.5"], new Set([1]))).toEqual([
      "pending:1.5",
    ]);
  });

  it("empty key list", () => {
    expect(findOrphanPendingKeys([], new Set([1]))).toEqual([]);
  });
});
