import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  t: (key: string, params?: Record<string, string | number>) => {
    if (params) {
      let s = key;
      for (const [k, v] of Object.entries(params)) s += ` ${k}=${v}`;
      return s;
    }
    return key;
  },
}));

import { messageForJiraStatus, parseTransitions, extractJiraDetail } from "../jira-api";

describe("parseTransitions", () => {
  it("표준 트랜지션 목록을 JiraTransition[]으로 매핑", () => {
    const raw = [
      {
        id: "11",
        name: "To Do",
        to: {
          name: "To Do",
          statusCategory: { key: "new" },
        },
      },
      {
        id: "21",
        name: "In Progress",
        to: {
          name: "In Progress",
          statusCategory: { key: "indeterminate" },
        },
      },
      {
        id: "31",
        name: "Done",
        to: {
          name: "Done",
          statusCategory: { key: "done" },
        },
      },
    ];

    expect(parseTransitions(raw)).toEqual([
      { id: "11", name: "To Do", to: { name: "To Do", categoryKey: "new" } },
      {
        id: "21",
        name: "In Progress",
        to: { name: "In Progress", categoryKey: "indeterminate" },
      },
      { id: "31", name: "Done", to: { name: "Done", categoryKey: "done" } },
    ]);
  });

  it("트랜지션 name과 to.name이 다를 수 있음", () => {
    const raw = [
      {
        id: "41",
        name: "Resolve Issue",
        to: {
          name: "Resolved",
          statusCategory: { key: "done" },
        },
      },
    ];

    expect(parseTransitions(raw)).toEqual([
      {
        id: "41",
        name: "Resolve Issue",
        to: { name: "Resolved", categoryKey: "done" },
      },
    ]);
  });

  it("빈 배열 → 빈 배열", () => {
    expect(parseTransitions([])).toEqual([]);
  });

  it("API 응답의 추가 필드는 무시하고 필요한 필드만 추출", () => {
    const raw = [
      {
        id: "51",
        name: "Reopen",
        hasScreen: true,
        isGlobal: false,
        isInitial: false,
        to: {
          self: "https://example.atlassian.net/rest/api/3/status/1",
          description: "reopened state",
          iconUrl: "https://example.com/icon.png",
          name: "Open",
          id: "1",
          statusCategory: {
            self: "https://example.atlassian.net/rest/api/3/statuscategory/2",
            id: 2,
            key: "new",
            colorName: "blue-gray",
            name: "To Do",
          },
        },
      },
    ];

    expect(parseTransitions(raw)).toEqual([
      { id: "51", name: "Reopen", to: { name: "Open", categoryKey: "new" } },
    ]);
  });
});

describe("messageForJiraStatus", () => {
  it("주요 상태 코드별 비어있지 않은 메시지 반환", () => {
    expect(messageForJiraStatus(401)).toBeTruthy();
    expect(messageForJiraStatus(403)).toBeTruthy();
    expect(messageForJiraStatus(404)).toBeTruthy();
    expect(messageForJiraStatus(429)).toBeTruthy();
    expect(messageForJiraStatus(500)).toBeTruthy();
  });

  it("알려지지 않은 상태 코드는 generic 메시지 반환", () => {
    expect(messageForJiraStatus(418)).toContain("jira.error.generic");
  });
});

// Jira는 필드별 오류를 errors 객체로 준다. 담당자 배정 불가는 원문이 영문 API 문구라
// (assignee: User 'x' cannot be assigned issues.) 사용자가 무엇을 해야 할지 알 수 없다 —
// 그 케이스만 안내 문구로 바꾸고 원문은 뒤에 남긴다.
describe("extractJiraDetail — 담당자 배정 불가 안내", () => {
  it("errors.assignee는 안내 문구로 바꾸고 원문을 함께 남긴다", () => {
    const out = extractJiraDetail({
      errors: { assignee: "User 'abc' cannot be assigned issues." },
    });
    expect(out).toContain("jira.error.assigneeNotAssignable");
    expect(out).toContain("User 'abc' cannot be assigned issues.");
  });

  it("다른 필드 오류는 그대로 노출한다", () => {
    const out = extractJiraDetail({ errors: { summary: "Summary is required." } });
    expect(out).toContain("summary: Summary is required.");
    expect(out).not.toContain("jira.error.assigneeNotAssignable");
  });

  it("errorMessages는 그대로 이어붙인다", () => {
    expect(extractJiraDetail({ errorMessages: ["Boom"] })).toContain("Boom");
  });

  it("body가 없으면 빈 문자열", () => {
    expect(extractJiraDetail(null)).toBe("");
  });
});
