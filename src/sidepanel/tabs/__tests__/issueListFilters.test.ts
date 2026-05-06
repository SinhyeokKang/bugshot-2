import { describe, expect, it } from "vitest";
import { matchesQuery, matchesStatus } from "../IssueListTab";
import type { IssueRecord } from "@/store/issues-store";

function makeIssue(overrides: Partial<IssueRecord> = {}): IssueRecord {
  return {
    id: "test-1",
    status: "submitted",
    platform: "jira",
    title: "버튼 패딩 수정",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pageUrl: "https://example.com/login",
    draft: { title: "버튼 패딩 수정", sections: {} },
    snapshot: { before: false, after: false },
    key: "BUG-123",
    ...overrides,
  };
}

describe("matchesQuery", () => {
  it("제목 부분 매칭", () => {
    expect(matchesQuery(makeIssue(), "버튼")).toBe(true);
  });

  it("pageUrl 부분 매칭", () => {
    expect(matchesQuery(makeIssue(), "login")).toBe(true);
  });

  it("Jira key 부분 매칭", () => {
    expect(matchesQuery(makeIssue(), "BUG-1")).toBe(true);
  });

  it("대소문자 무시", () => {
    expect(matchesQuery(makeIssue(), "bug-123")).toBe(true);
    expect(matchesQuery(makeIssue(), "EXAMPLE")).toBe(true);
  });

  it("빈 쿼리는 모든 이슈에 매칭", () => {
    expect(matchesQuery(makeIssue(), "")).toBe(true);
  });

  it("key가 undefined인 이슈는 key 매칭 건너뜀", () => {
    const issue = makeIssue({ key: undefined });
    expect(matchesQuery(issue, "BUG")).toBe(false);
    expect(matchesQuery(issue, "버튼")).toBe(true);
  });

  it("매칭 안 되는 쿼리", () => {
    expect(matchesQuery(makeIssue(), "존재하지않는텍스트")).toBe(false);
  });
});

describe("matchesStatus", () => {
  it("'all'은 항상 true", () => {
    expect(matchesStatus(makeIssue({ status: "draft" }), "all")).toBe(true);
    expect(matchesStatus(makeIssue({ status: "submitted" }), "all")).toBe(true);
  });

  it("'draft'는 draft만 true", () => {
    expect(matchesStatus(makeIssue({ status: "draft" }), "draft")).toBe(true);
    expect(matchesStatus(makeIssue({ status: "submitted" }), "draft")).toBe(false);
  });

  it("'submitted'는 submitted만 true", () => {
    expect(matchesStatus(makeIssue({ status: "submitted" }), "submitted")).toBe(true);
    expect(matchesStatus(makeIssue({ status: "draft" }), "submitted")).toBe(false);
  });
});
