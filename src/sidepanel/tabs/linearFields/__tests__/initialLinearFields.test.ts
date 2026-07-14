import { describe, expect, it } from "vitest";
import {
  initialLinearFields,
  type LinearIssueFieldsValue,
} from "../LinearIssueFields";
import type { LinearDefaults } from "@/types/linear";

const lastFull: LinearIssueFieldsValue = {
  teamId: "t1",
  teamName: "Team A",
  teamKey: "TA",
  projectId: "p1",
  projectName: "Project X",
  labelId: "l1",
  labelName: "Bug",
  assigneeId: "a1",
  assigneeName: "Alice",
  priority: 2,
};

const defaults: LinearDefaults = {
  teamId: "dt",
  teamName: "Default Team",
  teamKey: "DT",
  projectId: "dp",
  projectName: "Default Project",
  labelId: "dl",
  labelName: "Default Label",
  assigneeId: "da",
  priority: 3,
};

describe("initialLinearFields", () => {
  it("last에 teamId가 있고 defaults와 다른 팀이면 last만 사용", () => {
    const result = initialLinearFields(lastFull, defaults);
    expect(result.teamId).toBe("t1");
    expect(result.teamName).toBe("Team A");
    expect(result.teamKey).toBe("TA");
    expect(result.projectId).toBe("p1");
    expect(result.priority).toBe(2);
  });

  it("last에 teamId가 없으면 defaults를 소스로 사용", () => {
    const result = initialLinearFields({}, defaults);
    expect(result.teamId).toBe("dt");
    expect(result.teamName).toBe("Default Team");
    expect(result.teamKey).toBe("DT");
    expect(result.projectId).toBe("dp");
    expect(result.projectName).toBe("Default Project");
    expect(result.labelId).toBe("dl");
    expect(result.labelName).toBe("Default Label");
    expect(result.priority).toBe(3);
  });

  it("둘 다 undefined면 모든 필드 undefined", () => {
    const result = initialLinearFields(undefined, undefined);
    expect(result.teamId).toBeUndefined();
    expect(result.teamName).toBeUndefined();
    expect(result.teamKey).toBeUndefined();
    expect(result.priority).toBeUndefined();
  });

  it("같은 팀이면 last 누락 필드를 defaults로 채움", () => {
    const sparse: Partial<LinearIssueFieldsValue> = { teamId: "dt" };
    const result = initialLinearFields(sparse, defaults);
    expect(result.teamId).toBe("dt");
    expect(result.teamName).toBe("Default Team");
    expect(result.teamKey).toBe("DT");
    expect(result.projectId).toBe("dp");
    expect(result.projectName).toBe("Default Project");
    expect(result.labelId).toBe("dl");
    expect(result.labelName).toBe("Default Label");
    expect(result.assigneeId).toBe("da");
    expect(result.priority).toBe(3);
  });

  it("다른 팀이면 last 누락 필드를 defaults로 채우지 않음", () => {
    const sparse: Partial<LinearIssueFieldsValue> = { teamId: "other" };
    const result = initialLinearFields(sparse, defaults);
    expect(result.teamId).toBe("other");
    expect(result.teamKey).toBeUndefined();
    expect(result.projectId).toBeUndefined();
    expect(result.labelId).toBeUndefined();
    expect(result.priority).toBeUndefined();
  });

  it("같은 팀 — last 값이 defaults보다 우선", () => {
    const last: Partial<LinearIssueFieldsValue> = {
      teamId: "dt",
      teamName: "My Name",
      projectId: "my-p",
      projectName: "My Project",
    };
    const result = initialLinearFields(last, defaults);
    expect(result.teamName).toBe("My Name");
    expect(result.projectId).toBe("my-p");
    expect(result.projectName).toBe("My Project");
    expect(result.labelId).toBe("dl");
  });

  it("assigneeName은 last에서만 복원 (defaults에 없는 필드)", () => {
    const result = initialLinearFields(lastFull, defaults);
    expect(result.assigneeName).toBe("Alice");
  });

  it("assigneeName — last에 없으면 undefined", () => {
    const result = initialLinearFields({ teamId: "t1" }, defaults);
    expect(result.assigneeName).toBeUndefined();
  });

  // 개정: LinearDefaults에 assigneeName이 없어 defaults 경로의 표시명이 항상 undefined였다
  // (Connect 탭에 assignee 기본값 UI가 없어 assigneeId도 채워질 일이 없던 dead field).
  // Connect에서 default assignee를 고를 수 있게 되면 id·표시명 쌍으로 저장되어 둘 다 채워져야 한다.
  it("last.teamId가 falsy면 defaults 사용 (assignee는 id·표시명 쌍으로 채워짐)", () => {
    const partial: Partial<LinearIssueFieldsValue> = {
      assigneeName: "Bob",
    };
    const result = initialLinearFields(partial, {
      ...defaults,
      assigneeId: "dflt",
      assigneeName: "Default User",
    });
    expect(result.teamId).toBe("dt");
    expect(result.teamKey).toBe("DT");
    expect(result.labelName).toBe("Default Label");
    expect(result.assigneeId).toBe("dflt");
    expect(result.assigneeName).toBe("Default User");
  });

  // assignee는 team 하위 필드 — last 우선·defaults fallback, 팀이 갈리면 last.assignee 무효.
  it("같은 팀이면 last.assignee가 defaults.assignee보다 우선", () => {
    const result = initialLinearFields(
      { teamId: "dt", assigneeId: "lastUser", assigneeName: "Last" },
      { ...defaults, assigneeId: "dflt", assigneeName: "Default User" },
    );
    expect(result.assigneeId).toBe("lastUser");
    expect(result.assigneeName).toBe("Last");
  });

  it("같은 팀 + last에 assignee 없으면 defaults.assignee로 채움 (표시명 포함)", () => {
    const result = initialLinearFields(
      { teamId: "dt" },
      { ...defaults, assigneeId: "dflt", assigneeName: "Default User" },
    );
    expect(result.assigneeId).toBe("dflt");
    expect(result.assigneeName).toBe("Default User");
  });

  // team은 목적지 필드라 last 우선 → 해소된 team은 last의 것. last.assignee는 그 팀 멤버라 유효.
  // 무효한 건 defaults.assignee(다른 팀 소속)다.
  it("팀이 갈리면 last.assignee는 유지된다 (해소된 팀과 같은 쌍이라 유효)", () => {
    const result = initialLinearFields(
      { teamId: "OTHER", assigneeId: "lastUser", assigneeName: "Last" },
      { ...defaults, assigneeId: "dflt", assigneeName: "Default User" },
    );
    expect(result.teamId).toBe("OTHER");
    expect(result.assigneeId).toBe("lastUser");
    expect(result.assigneeName).toBe("Last");
  });

  it("팀이 갈리고 last에 assignee가 없으면 defaults.assignee를 쓰지 않는다", () => {
    const result = initialLinearFields(
      { teamId: "OTHER" },
      { ...defaults, assigneeId: "dflt", assigneeName: "Default User" },
    );
    expect(result.teamId).toBe("OTHER");
    expect(result.assigneeId).toBeUndefined();
    expect(result.assigneeName).toBeUndefined();
  });
});
