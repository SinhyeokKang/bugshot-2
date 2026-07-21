import { describe, expect, it } from "vitest";
import { initialAsanaFields } from "../AsanaIssueFields";

// workspace는 connect defaults 우선(가장 거친 스코프 — POSTMORTEM 2026-06-27의 의도적 예외).
// assignee는 workspace 하위 필드 — last 우선이되, workspace가 갈리면 그 workspace 멤버라 무효.

describe("initialAsanaFields — default assignee", () => {
  it("last 없으면 defaults의 assignee prefill", () => {
    const out = initialAsanaFields(undefined, {
      workspaceGid: "w1",
      assigneeGid: "dflt",
      assigneeName: "Default User",
    });
    expect(out.workspaceGid).toBe("w1");
    expect(out.assigneeGid).toBe("dflt");
    expect(out.assigneeName).toBe("Default User");
  });

  it("같은 workspace면 last.assignee가 defaults.assignee보다 우선", () => {
    const out = initialAsanaFields(
      { workspaceGid: "w1", assigneeGid: "lastUser", assigneeName: "Last" },
      { workspaceGid: "w1", assigneeGid: "dflt", assigneeName: "Default User" },
    );
    expect(out.assigneeGid).toBe("lastUser");
    expect(out.assigneeName).toBe("Last");
  });

  it("같은 workspace + last에 assignee 없으면 defaults.assignee로 채움", () => {
    const out = initialAsanaFields(
      { workspaceGid: "w1", projectGid: "p9" },
      { workspaceGid: "w1", assigneeGid: "dflt", assigneeName: "Default User" },
    );
    expect(out.projectGid).toBe("p9");
    expect(out.assigneeGid).toBe("dflt");
  });

  it("workspace가 갈리면 last.assignee를 버리고 defaults.assignee로 fallback", () => {
    const out = initialAsanaFields(
      { workspaceGid: "wOTHER", assigneeGid: "lastUser", assigneeName: "Last" },
      { workspaceGid: "w1", assigneeGid: "dflt", assigneeName: "Default User" },
    );
    // workspace는 defaults 우선(거친 스코프) → 해소된 workspace의 기본 담당자로 채운다.
    expect(out.workspaceGid).toBe("w1");
    expect(out.assigneeGid).toBe("dflt");
    expect(out.assigneeName).toBe("Default User");
  });

  it("last/defaults 모두 없으면 빈 값", () => {
    const out = initialAsanaFields(undefined, undefined);
    expect(out.workspaceGid).toBeUndefined();
    expect(out.assigneeGid).toBeUndefined();
  });

  // 동일 구조인 ClickUp은 명시적으로 검증돼 있는데 Asana만 빠져 있었다 (감사 ⚪ 항목).
  it("workspace가 바뀌면 project를 defaults로 되돌린다", () => {
    const out = initialAsanaFields(
      { workspaceGid: "ws-old", projectGid: "p-old", projectName: "Old" },
      { workspaceGid: "ws-new", workspaceName: "New", projectGid: "p-new", projectName: "New P" },
    );
    expect(out.projectGid).toBe("p-new");
    expect(out.projectName).toBe("New P");
  });

  it("workspace가 바뀌면 cc를 비운다", () => {
    const out = initialAsanaFields(
      { workspaceGid: "ws-old", cc: [{ gid: "u1", name: "alice" }] },
      { workspaceGid: "ws-new", workspaceName: "New" },
    );
    expect(out.cc).toBeUndefined();
  });

  it("workspace가 같으면 project와 cc를 이어받는다", () => {
    const out = initialAsanaFields(
      { workspaceGid: "ws-1", projectGid: "p-1", projectName: "P", cc: [{ gid: "u1", name: "alice" }] },
      { workspaceGid: "ws-1", workspaceName: "WS" },
    );
    expect(out.projectGid).toBe("p-1");
    expect(out.cc).toEqual([{ gid: "u1", name: "alice" }]);
  });
});
