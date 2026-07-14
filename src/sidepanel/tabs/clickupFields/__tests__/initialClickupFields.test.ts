import { describe, expect, it } from "vitest";
import { initialClickupFields } from "../ClickupIssueFields";

// 3단계(Workspace→Space→List) prefill 우선순위:
// - workspace는 connect defaults 우선(없으면 last).
// - space/list/assignee/cc는 last가 같은 workspace일 때만 last로 prefill, 아니면 defaults(assignee/cc는 버림).

describe("initialClickupFields — 3단계 prefill 우선순위", () => {
  it("last/defaults 모두 없으면 빈 값", () => {
    const out = initialClickupFields(undefined, undefined);
    expect(out.workspaceId).toBeUndefined();
    expect(out.spaceId).toBeUndefined();
    expect(out.listId).toBeUndefined();
    expect(out.assigneeId).toBeUndefined();
    expect(out.cc).toBeUndefined();
  });

  it("last 없으면 defaults의 workspace/space/list prefill", () => {
    const out = initialClickupFields(undefined, {
      workspaceId: "w1",
      workspaceName: "WS",
      spaceId: "s1",
      spaceName: "Space",
      listId: "l1",
      listName: "List",
    });
    expect(out.workspaceId).toBe("w1");
    expect(out.spaceId).toBe("s1");
    expect(out.listId).toBe("l1");
    expect(out.assigneeId).toBeUndefined();
    expect(out.cc).toBeUndefined();
  });

  it("last와 resolved workspace가 같으면 last의 space/list/assignee/cc 우선", () => {
    const out = initialClickupFields(
      {
        workspaceId: "w1",
        spaceId: "s9",
        spaceName: "LastSpace",
        listId: "l9",
        listName: "LastList",
        assigneeId: "u1",
        assigneeName: "Me",
        cc: [{ id: "u2", name: "Bob" }],
      },
      { workspaceId: "w1", workspaceName: "WS", spaceId: "s1", listId: "l1" },
    );
    expect(out.workspaceId).toBe("w1");
    expect(out.spaceId).toBe("s9");
    expect(out.listId).toBe("l9");
    expect(out.assigneeId).toBe("u1");
    expect(out.cc).toEqual([{ id: "u2", name: "Bob" }]);
  });

  it("last의 workspace가 resolved와 다르면 defaults의 space/list 사용 + assignee/cc 버림", () => {
    const out = initialClickupFields(
      {
        workspaceId: "wOTHER",
        spaceId: "s9",
        listId: "l9",
        assigneeId: "u1",
        cc: [{ id: "u2", name: "Bob" }],
      },
      { workspaceId: "w1", spaceId: "s1", listId: "l1" },
    );
    expect(out.workspaceId).toBe("w1");
    expect(out.spaceId).toBe("s1");
    expect(out.listId).toBe("l1");
    expect(out.assigneeId).toBeUndefined();
    expect(out.cc).toBeUndefined();
  });

  // Connect 탭의 default assignee — assignee는 목적지가 아니라 workspace 하위 필드다.
  // last 우선·defaults fallback이되, workspace가 갈리면 last.assignee는 무효(그 workspace 사람이라).
  it("last 없으면 defaults의 assignee를 prefill", () => {
    const out = initialClickupFields(undefined, {
      workspaceId: "w1",
      assigneeId: "dflt",
      assigneeName: "Default User",
    });
    expect(out.assigneeId).toBe("dflt");
    expect(out.assigneeName).toBe("Default User");
  });

  it("같은 workspace면 last.assignee가 defaults.assignee보다 우선", () => {
    const out = initialClickupFields(
      { workspaceId: "w1", assigneeId: "lastUser", assigneeName: "Last" },
      { workspaceId: "w1", assigneeId: "dflt", assigneeName: "Default User" },
    );
    expect(out.assigneeId).toBe("lastUser");
    expect(out.assigneeName).toBe("Last");
  });

  it("workspace가 갈리면 last.assignee를 버리고 defaults.assignee로 fallback", () => {
    const out = initialClickupFields(
      { workspaceId: "wOTHER", assigneeId: "lastUser", assigneeName: "Last" },
      { workspaceId: "w1", assigneeId: "dflt", assigneeName: "Default User" },
    );
    expect(out.workspaceId).toBe("w1");
    expect(out.assigneeId).toBe("dflt");
    expect(out.assigneeName).toBe("Default User");
  });

  it("같은 workspace + last에 assignee 없으면 defaults.assignee로 채움", () => {
    const out = initialClickupFields(
      { workspaceId: "w1", spaceId: "s9" },
      { workspaceId: "w1", assigneeId: "dflt", assigneeName: "Default User" },
    );
    expect(out.spaceId).toBe("s9");
    expect(out.assigneeId).toBe("dflt");
  });

  it("defaults 없고 last만 있으면 last 전체를 prefill", () => {
    const out = initialClickupFields(
      {
        workspaceId: "w1",
        spaceId: "s9",
        listId: "l9",
        assigneeId: "u1",
        cc: [{ id: "u2", name: "Bob" }],
      },
      undefined,
    );
    expect(out.workspaceId).toBe("w1");
    expect(out.spaceId).toBe("s9");
    expect(out.listId).toBe("l9");
    expect(out.assigneeId).toBe("u1");
    expect(out.cc).toEqual([{ id: "u2", name: "Bob" }]);
  });
});
