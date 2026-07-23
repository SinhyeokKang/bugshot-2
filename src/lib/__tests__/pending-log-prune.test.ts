import { describe, expect, it, vi } from "vitest";
import {
  findOrphanPendingAttachmentOwners,
  findOrphanPendingKeys,
  getActiveTabIds,
} from "../pending-log-prune";

vi.stubGlobal("chrome", {
  tabs: { query: vi.fn() },
});

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

describe("findOrphanPendingAttachmentOwners", () => {
  it("attachment 키(pending:tabId:uuid)에서 비활성 tab의 owner를 반환", () => {
    const keys = ["pending:123:aaa", "pending:456:bbb", "pending:456:ccc"];
    expect(
      findOrphanPendingAttachmentOwners(keys, new Set([123])),
    ).toEqual(["pending:456"]);
  });

  it("같은 tab의 여러 첨부는 owner 하나로 중복 제거", () => {
    const keys = ["pending:9:a", "pending:9:b", "pending:9:c"];
    expect(findOrphanPendingAttachmentOwners(keys, new Set())).toEqual([
      "pending:9",
    ]);
  });

  it("활성 tab의 첨부는 고아 아님 — 진행 중 첨부 삭제 방지", () => {
    const keys = ["pending:7:a", "pending:8:b"];
    expect(findOrphanPendingAttachmentOwners(keys, new Set([7]))).toEqual([
      "pending:8",
    ]);
  });

  it("non-pending 키(issueId:uuid)는 무시", () => {
    const keys = ["issue-1-x:aaa", "pending:5:bbb"];
    expect(findOrphanPendingAttachmentOwners(keys, new Set())).toEqual([
      "pending:5",
    ]);
  });

  it("tabId가 144인 키는 14 활성 여부와 무관(prefix 오매치 없음)", () => {
    const keys = ["pending:144:a"];
    expect(findOrphanPendingAttachmentOwners(keys, new Set([14]))).toEqual([
      "pending:144",
    ]);
  });

  it("빈 키 리스트", () => {
    expect(findOrphanPendingAttachmentOwners([], new Set([1]))).toEqual([]);
  });
});

describe("getActiveTabIds", () => {
  it("tabs.query 실패를 빈 집합으로 바꾸지 않고 prune을 중단시킨다", async () => {
    vi.mocked(chrome.tabs.query).mockRejectedValueOnce(new Error("unavailable"));

    await expect(getActiveTabIds()).rejects.toThrow("unavailable");
  });
});
