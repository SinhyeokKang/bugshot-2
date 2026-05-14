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

import { parseTransitions } from "../jira-api";

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
