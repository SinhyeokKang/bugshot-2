import { describe, expect, it } from "vitest";
import { initialJiraFields } from "../initialJiraFields";

// 프로젝트가 "연동 설정(거친 스코프)"에서 **제출 목적지 필드**로 승격됐다.
// 새 규칙: 직전 제출값이 우선 · 계정 설정은 fallback · 사이트가 다르면 직전 제출값 전량 무효.
// 직결 선례는 POSTMORTEM 2026-06-30 "제출 목적지 필드는 last 우선, defaults는 fallback"이다.
//
// ⚠️ 이전 계약(`sameProject` 게이트 — 프로젝트가 갈리면 직전 제출값 전체를 버림)은 사라졌다.
// projectKey까지 함께 복원하므로 하위 필드와의 정합이 저절로 맞는다.

const ACCOUNT = {
  projectKey: "ENG",
  issueTypeId: "10001",
  assigneeId: "dflt",
  assigneeName: "Default User",
};

describe("initialJiraFields — 프로젝트 복원", () => {
  it("직전 제출 프로젝트를 하위 필드와 함께 복원한다 (계정 기본과 달라도)", () => {
    const out = initialJiraFields(
      {
        projectKey: "API",
        issueTypeId: "20002",
        priorityId: "3",
        priorityName: "High",
        parentKey: "API-1",
        parentLabel: "API-1 Epic",
        relates: [{ key: "API-2", label: "API-2 Foo" }],
      },
      ACCOUNT,
    );
    expect(out.projectKey).toBe("API");
    expect(out.issueTypeId).toBe("20002");
    expect(out.priorityId).toBe("3");
    expect(out.priorityName).toBe("High");
    expect(out.parentKey).toBe("API-1");
    expect(out.parentLabel).toBe("API-1 Epic");
    expect(out.relates).toEqual([{ key: "API-2", label: "API-2 Foo" }]);
  });

  it("직전 제출이 없으면 계정 기본 프로젝트·이슈타입·담당자로 연다", () => {
    const out = initialJiraFields(undefined, ACCOUNT);
    expect(out.projectKey).toBe("ENG");
    expect(out.issueTypeId).toBe("10001");
    expect(out.assigneeId).toBe("dflt");
    expect(out.assigneeName).toBe("Default User");
  });

  it("직전 제출에 projectKey가 없으면 계정 기본 프로젝트로 채운다", () => {
    const out = initialJiraFields({ priorityId: "3" }, ACCOUNT);
    expect(out.projectKey).toBe("ENG");
    expect(out.priorityId).toBe("3");
  });

  it("계정도 프로젝트가 없으면 projectKey는 undefined", () => {
    const out = initialJiraFields(undefined, undefined);
    expect(out.projectKey).toBeUndefined();
    expect(out.assigneeId).toBeUndefined();
  });

  it("siteId는 반환하지 않는다 (판별자일 뿐 — EditorIssueFields에 없는 키가 세션으로 샌다)", () => {
    const out = initialJiraFields(
      { projectKey: "API", siteId: "cloud-1" },
      ACCOUNT,
      "cloud-1",
    );
    expect(out).not.toHaveProperty("siteId");
    expect(out.projectKey).toBe("API");
  });
});

describe("initialJiraFields — 사이트 게이트", () => {
  it("직전 제출이 다른 사이트 것이면 통째로 버리고 계정 기본으로 연다", () => {
    const out = initialJiraFields(
      {
        projectKey: "API",
        siteId: "other-cloud",
        issueTypeId: "20002",
        assigneeId: "lastUser",
        assigneeName: "Last",
        priorityId: "3",
        relates: [{ key: "API-2", label: "API-2 Foo" }],
      },
      ACCOUNT,
      "cloud-1",
    );
    expect(out.projectKey).toBe("ENG");
    expect(out.issueTypeId).toBe("10001");
    expect(out.assigneeId).toBe("dflt");
    expect(out.priorityId).toBeUndefined();
    expect(out.relates).toBeUndefined();
  });

  it("같은 사이트면 복원한다", () => {
    const out = initialJiraFields(
      { projectKey: "API", siteId: "cloud-1", priorityId: "3" },
      ACCOUNT,
      "cloud-1",
    );
    expect(out.projectKey).toBe("API");
    expect(out.priorityId).toBe("3");
  });

  // 마이그레이션이 없으므로 기존 사용자의 레코드에는 siteId가 없다.
  // 이건 예외 케이스가 아니라 업데이트 직후 기존 사용자 **전원**이 타는 경로다(design R1-b).
  it("last.siteId가 없으면 사이트 검증을 건너뛴다", () => {
    const out = initialJiraFields(
      { projectKey: "API", priorityId: "3" },
      ACCOUNT,
      "cloud-1",
    );
    expect(out.projectKey).toBe("API");
    expect(out.priorityId).toBe("3");
  });

  it("currentSiteId가 없으면 사이트 검증을 건너뛴다 (계정 미연결·테스트 경로)", () => {
    const out = initialJiraFields(
      { projectKey: "API", siteId: "other-cloud", priorityId: "3" },
      ACCOUNT,
    );
    expect(out.projectKey).toBe("API");
    expect(out.priorityId).toBe("3");
  });
});

describe("initialJiraFields — 계정 기본값 폴백은 기본 프로젝트 한정", () => {
  it("복원 프로젝트가 계정 기본과 다르면 계정 기본 이슈타입이 주입되지 않는다", () => {
    const out = initialJiraFields({ projectKey: "API" }, ACCOUNT);
    expect(out.projectKey).toBe("API");
    expect(out.issueTypeId).toBeUndefined();
  });

  it("복원 프로젝트가 계정 기본과 다르면 계정 기본 담당자가 주입되지 않는다", () => {
    const out = initialJiraFields({ projectKey: "API" }, ACCOUNT);
    expect(out.assigneeId).toBeUndefined();
    expect(out.assigneeName).toBeUndefined();
  });

  it("복원 프로젝트가 계정 기본과 같으면 빈 하위 필드를 계정 기본값으로 채운다", () => {
    const out = initialJiraFields({ projectKey: "ENG", priorityId: "3" }, ACCOUNT);
    expect(out.issueTypeId).toBe("10001");
    expect(out.assigneeId).toBe("dflt");
    expect(out.assigneeName).toBe("Default User");
  });

  it("같은 프로젝트라도 직전 제출 이슈타입이 계정 기본값보다 우선한다", () => {
    const out = initialJiraFields(
      { projectKey: "ENG", issueTypeId: "10009" },
      ACCOUNT,
    );
    expect(out.issueTypeId).toBe("10009");
  });

  it("같은 프로젝트라도 직전 제출 담당자가 계정 기본 담당자보다 우선한다", () => {
    const out = initialJiraFields(
      { projectKey: "ENG", assigneeId: "lastUser", assigneeName: "Last" },
      ACCOUNT,
    );
    expect(out.assigneeId).toBe("lastUser");
    expect(out.assigneeName).toBe("Last");
  });

  // id·표시명은 한 사람을 가리키는 쌍이라 소스를 통째로 고른다 — 따로 fallback하면 다른 사람 이름이 붙는다.
  it("담당자 이름이 last에 없어도 계정 기본 이름을 섞지 않는다", () => {
    const out = initialJiraFields(
      { projectKey: "ENG", assigneeId: "lastUser" },
      ACCOUNT,
    );
    expect(out.assigneeId).toBe("lastUser");
    expect(out.assigneeName).toBeUndefined();
  });

  it("계정에 담당자 기본값이 없으면 같은 프로젝트라도 last.assignee만 남는다", () => {
    const out = initialJiraFields(
      { projectKey: "ENG", assigneeId: "lastUser", assigneeName: "Last" },
      { projectKey: "ENG" },
    );
    expect(out.assigneeId).toBe("lastUser");
  });
});
