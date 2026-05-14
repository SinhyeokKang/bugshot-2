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

import {
  buildLinearAuthHeader,
  extractLinearErrors,
  messageForLinearStatus,
  sortWorkflowStates,
} from "../linear-api";

describe("buildLinearAuthHeader", () => {
  it("API Key는 키 그대로", () => {
    expect(
      buildLinearAuthHeader({
        kind: "apiKey",
        apiKey: "lin_api_xxx",
        viewerName: "u",
      }),
    ).toBe("lin_api_xxx");
  });

  it("OAuth는 'Bearer <accessToken>'", () => {
    expect(
      buildLinearAuthHeader({
        kind: "oauth",
        accessToken: "ATK",
        refreshToken: "RTK",
        expiresAt: 9999999999999,
        scope: "read,write",
        viewerName: "u",
        grantedAt: 1,
      }),
    ).toBe("Bearer ATK");
  });
});

describe("extractLinearErrors", () => {
  it("errors 배열의 message를 줄바꿈으로 합침", () => {
    expect(
      extractLinearErrors([
        { message: "Field 'teamId' is required" },
        { message: "Invalid input" },
      ]),
    ).toBe("Field 'teamId' is required\nInvalid input");
  });

  it("message가 없으면 fallback 메시지", () => {
    expect(extractLinearErrors([{}])).toBe("Unknown GraphQL error");
  });

  it("빈 배열이면 빈 문자열", () => {
    expect(extractLinearErrors([])).toBe("");
  });
});

describe("messageForLinearStatus", () => {
  it("주요 상태 코드별 비어있지 않은 메시지 반환", () => {
    expect(messageForLinearStatus(401)).toBeTruthy();
    expect(messageForLinearStatus(403)).toBeTruthy();
    expect(messageForLinearStatus(404)).toBeTruthy();
    expect(messageForLinearStatus(429)).toBeTruthy();
    expect(messageForLinearStatus(500)).toBeTruthy();
    expect(messageForLinearStatus(502)).toBeTruthy();
  });

  it("알려지지 않은 상태 코드는 generic 메시지에 코드 포함", () => {
    expect(messageForLinearStatus(418)).toContain("418");
  });
});

describe("sortWorkflowStates", () => {
  it("type 순서대로 정렬: triage → backlog → unstarted → started → completed → cancelled", () => {
    const states = [
      { id: "5", name: "Done", type: "completed", color: "#5e6ad2" },
      { id: "1", name: "Triage", type: "triage", color: "#e2e2e2" },
      { id: "3", name: "Todo", type: "unstarted", color: "#e2e2e2" },
      { id: "6", name: "Cancelled", type: "cancelled", color: "#95a2b3" },
      { id: "4", name: "In Progress", type: "started", color: "#f2c94c" },
      { id: "2", name: "Backlog", type: "backlog", color: "#bec2c8" },
    ];

    const sorted = sortWorkflowStates(states);
    expect(sorted.map((s) => s.type)).toEqual([
      "triage",
      "backlog",
      "unstarted",
      "started",
      "completed",
      "cancelled",
    ]);
  });

  it("알 수 없는 type은 목록 끝에 배치", () => {
    const states = [
      { id: "1", name: "Custom", type: "custom_type", color: "#000" },
      { id: "2", name: "In Progress", type: "started", color: "#f2c94c" },
      { id: "3", name: "Todo", type: "unstarted", color: "#e2e2e2" },
    ];

    const sorted = sortWorkflowStates(states);
    expect(sorted.map((s) => s.type)).toEqual([
      "unstarted",
      "started",
      "custom_type",
    ]);
  });

  it("빈 배열 → 빈 배열", () => {
    expect(sortWorkflowStates([])).toEqual([]);
  });

  it("같은 type 내에서 원본 순서 유지", () => {
    const states = [
      { id: "1", name: "In Review", type: "started", color: "#f2c94c" },
      { id: "2", name: "In Progress", type: "started", color: "#f2c94c" },
      { id: "3", name: "Backlog", type: "backlog", color: "#bec2c8" },
    ];

    const sorted = sortWorkflowStates(states);
    expect(sorted.map((s) => s.name)).toEqual([
      "Backlog",
      "In Review",
      "In Progress",
    ]);
  });

  it("일부 type만 있어도 올바르게 정렬", () => {
    const states = [
      { id: "1", name: "Done", type: "completed", color: "#5e6ad2" },
      { id: "2", name: "Todo", type: "unstarted", color: "#e2e2e2" },
    ];

    const sorted = sortWorkflowStates(states);
    expect(sorted.map((s) => s.type)).toEqual(["unstarted", "completed"]);
  });

  it("원본 배열을 변경하지 않음", () => {
    const states = [
      { id: "1", name: "Done", type: "completed", color: "#5e6ad2" },
      { id: "2", name: "Todo", type: "unstarted", color: "#e2e2e2" },
    ];
    const original = [...states];

    sortWorkflowStates(states);
    expect(states).toEqual(original);
  });
});
