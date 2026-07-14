import { describe, expect, it } from "vitest";
import { initialJiraFields } from "../initialJiraFields";

// Jira는 다른 플랫폼과 달리 project가 Connect 계정 필드(account.projectKey)이고 그게 진실이다
// — 이슈 필드로 고르는 목적지가 아니라 연동 설정이다(Asana/ClickUp의 workspace와 같은 위상).
// 따라서 project는 account 우선이고, assignee는 그 project 하위 필드로 last 우선·account fallback.
// 기존엔 editor-store.confirmDraft에 인라인이라 테스트가 불가능했다 — 순수 헬퍼로 분리한다.

describe("initialJiraFields — default assignee", () => {
  it("last 없으면 account의 project·issueType·assignee prefill", () => {
    const out = initialJiraFields(undefined, {
      projectKey: "ENG",
      issueTypeId: "10001",
      assigneeId: "dflt",
      assigneeName: "Default User",
    });
    expect(out.issueTypeId).toBe("10001");
    expect(out.assigneeId).toBe("dflt");
    expect(out.assigneeName).toBe("Default User");
  });

  it("같은 project면 last.assignee가 account.assignee보다 우선", () => {
    const out = initialJiraFields(
      { projectKey: "ENG", assigneeId: "lastUser", assigneeName: "Last" },
      { projectKey: "ENG", assigneeId: "dflt", assigneeName: "Default User" },
    );
    expect(out.assigneeId).toBe("lastUser");
    expect(out.assigneeName).toBe("Last");
  });

  it("같은 project + last에 assignee 없으면 account.assignee로 채움", () => {
    const out = initialJiraFields(
      { projectKey: "ENG", priorityId: "3" },
      { projectKey: "ENG", assigneeId: "dflt", assigneeName: "Default User" },
    );
    expect(out.assigneeId).toBe("dflt");
    expect(out.assigneeName).toBe("Default User");
  });

  it("project가 갈리면 last.assignee를 버리고 account.assignee로 fallback", () => {
    const out = initialJiraFields(
      { projectKey: "OTHER", assigneeId: "lastUser", assigneeName: "Last" },
      { projectKey: "ENG", assigneeId: "dflt", assigneeName: "Default User" },
    );
    // project는 연동 설정이 진실 → 해소된 project(ENG)의 기본 담당자로 채운다.
    expect(out.assigneeId).toBe("dflt");
    expect(out.assigneeName).toBe("Default User");
  });

  it("account에 assignee 기본값이 없으면 같은 project라도 last.assignee만 남는다", () => {
    const out = initialJiraFields(
      { projectKey: "ENG", assigneeId: "lastUser", assigneeName: "Last" },
      { projectKey: "ENG" },
    );
    expect(out.assigneeId).toBe("lastUser");
  });

  it("last/account 모두 없으면 빈 값", () => {
    const out = initialJiraFields(undefined, undefined);
    expect(out.assigneeId).toBeUndefined();
  });
});

// 이 헬퍼는 캡처→제출(editor-store.confirmDraft)과 드래프트 재제출(DraftDetailDialog)의 단일 출처다.
// 담당자뿐 아니라 직전 제출값 복원 전체를 담당하므로 그 계약을 고정한다 — 한쪽만 고치면 기본 담당자가
// 절반의 경로에서만 붙는다(POSTMORTEM 2026-07-14 "단일 출처를 우회한 하드코딩").
describe("initialJiraFields — 직전 제출값 복원", () => {
  it("같은 project면 우선순위·상위 이슈 등 직전 제출값을 함께 복원", () => {
    const out = initialJiraFields(
      {
        projectKey: "ENG",
        priorityId: "3",
        priorityName: "High",
        parentKey: "ENG-1",
        parentLabel: "Epic",
      },
      { projectKey: "ENG", issueTypeId: "10001" },
    );
    expect(out.priorityId).toBe("3");
    expect(out.parentKey).toBe("ENG-1");
    expect(out.issueTypeId).toBe("10001");
  });

  it("project가 갈리면 직전 제출값을 통째로 버린다 (다른 프로젝트의 우선순위·상위 이슈라 무효)", () => {
    const out = initialJiraFields(
      { projectKey: "OTHER", priorityId: "3", parentKey: "OTHER-1" },
      { projectKey: "ENG", issueTypeId: "10001" },
    );
    expect(out.priorityId).toBeUndefined();
    expect(out.parentKey).toBeUndefined();
    expect(out.issueTypeId).toBe("10001");
  });
});
