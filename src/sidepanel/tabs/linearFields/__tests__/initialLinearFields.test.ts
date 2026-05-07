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

  it("last.teamId가 falsy면 defaults 사용 (assigneeName은 defaults에 없으므로 undefined)", () => {
    const partial: Partial<LinearIssueFieldsValue> = {
      assigneeName: "Bob",
    };
    const result = initialLinearFields(partial, defaults);
    expect(result.teamId).toBe("dt");
    expect(result.teamKey).toBe("DT");
    expect(result.labelName).toBe("Default Label");
    expect(result.assigneeName).toBeUndefined();
  });
});
