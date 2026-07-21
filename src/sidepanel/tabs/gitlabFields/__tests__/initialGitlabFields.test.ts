import { describe, expect, it } from "vitest";
import { initialGitlabFields } from "../GitlabIssueFields";

// project(목적지)는 last 우선·defaults fallback.
// assignee는 project 하위 필드 — project가 갈리면 그 프로젝트 멤버라 무효.
// GitlabDefaults.assignee는 과거 string 타입이었으나 실제 필드값은 assigneeId: number라 불일치였다.
// Connect 기본값은 id·표시명 쌍(assigneeId: number / assigneeName: string)으로 저장한다.

describe("initialGitlabFields — default assignee", () => {
  it("last 없으면 defaults의 project·assignee prefill", () => {
    const out = initialGitlabFields(undefined, {
      projectId: 1,
      projectPath: "acme/web",
      assigneeId: 7,
      assigneeName: "Default User",
    });
    expect(out.projectId).toBe(1);
    expect(out.assigneeId).toBe(7);
    expect(out.assigneeName).toBe("Default User");
  });

  it("같은 project면 last.assignee가 defaults.assignee보다 우선", () => {
    const out = initialGitlabFields(
      { projectId: 1, assigneeId: 9, assigneeName: "Last" },
      { projectId: 1, assigneeId: 7, assigneeName: "Default User" },
    );
    expect(out.assigneeId).toBe(9);
    expect(out.assigneeName).toBe("Last");
  });

  it("같은 project + last에 assignee 없으면 defaults.assignee로 채움", () => {
    const out = initialGitlabFields(
      { projectId: 1 },
      { projectId: 1, assigneeId: 7, assigneeName: "Default User" },
    );
    expect(out.projectId).toBe(1);
    expect(out.assigneeId).toBe(7);
  });

  // project는 목적지 필드라 last 우선 → 해소된 project는 last의 것. last.assignee는 그 프로젝트
  // 멤버라 유효하고, 무효한 건 defaults.assignee(다른 프로젝트 소속)다.
  it("project가 갈리면 last.assignee는 유지된다 (해소된 project와 같은 쌍이라 유효)", () => {
    const out = initialGitlabFields(
      { projectId: 99, assigneeId: 9, assigneeName: "Last" },
      { projectId: 1, assigneeId: 7, assigneeName: "Default User" },
    );
    expect(out.projectId).toBe(99);
    expect(out.assigneeId).toBe(9);
    expect(out.assigneeName).toBe("Last");
  });

  it("project가 갈리고 last에 assignee가 없으면 defaults.assignee를 쓰지 않는다", () => {
    const out = initialGitlabFields(
      { projectId: 99 },
      { projectId: 1, assigneeId: 7, assigneeName: "Default User" },
    );
    expect(out.projectId).toBe(99);
    expect(out.assigneeId).toBeUndefined();
    expect(out.assigneeName).toBeUndefined();
  });

  it("last/defaults 모두 없으면 빈 값", () => {
    const out = initialGitlabFields(undefined, undefined);
    expect(out.projectId).toBeUndefined();
    expect(out.assigneeId).toBeUndefined();
  });

  it("last project가 있으면 label을 last에서 가져온다", () => {
    const out = initialGitlabFields(
      { projectId: 1, label: "bug" },
      { projectId: 1, label: "enhancement" },
    );
    expect(out.label).toBe("bug");
  });

  it("last project가 없으면 label을 defaults에서 가져온다", () => {
    const out = initialGitlabFields(undefined, { projectId: 1, label: "enhancement" });
    expect(out.label).toBe("enhancement");
  });

  it("last project가 있으면 cc를 이어받는다", () => {
    const out = initialGitlabFields({ projectId: 1, cc: [{ username: "alice", name: "Alice" }] }, { projectId: 1 });
    expect(out.cc).toEqual([{ username: "alice", name: "Alice" }]);
  });

  it("last project가 없으면 cc를 비운다", () => {
    const out = initialGitlabFields({ cc: [{ username: "alice", name: "Alice" }] }, { projectId: 1 });
    expect(out.cc).toBeUndefined();
  });
});
