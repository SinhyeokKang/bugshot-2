import { describe, expect, it, vi } from "vitest";
import {
  buildAuthHeader,
  mapCreateIssueBody,
  messageForGitlabStatus,
  normalizeIssueStatus,
  normalizeProject,
} from "../gitlab-api";

vi.mock("@/i18n", () => ({
  t: (k: string, p?: Record<string, unknown>) =>
    p ? k.replace(/\{(\w+)\}/g, (_, key) => String(p[key] ?? `{${key}}`)) : k,
}));

describe("buildAuthHeader", () => {
  it("PAT은 'Bearer <pat>' (GitLab PAT은 Bearer 동작)", () => {
    expect(
      buildAuthHeader({
        kind: "pat",
        pat: "glpat_xyz",
        baseUrl: "https://gitlab.com",
        viewerUsername: "u",
      }),
    ).toBe("Bearer glpat_xyz");
  });

  it("OAuth는 'Bearer <accessToken>'", () => {
    expect(
      buildAuthHeader({
        kind: "oauth",
        accessToken: "ATK",
        refreshToken: "RTK",
        expiresAt: 9999,
        scope: "api",
        baseUrl: "https://gitlab.com",
        viewerUsername: "u",
        grantedAt: 1,
      }),
    ).toBe("Bearer ATK");
  });
});

describe("mapCreateIssueBody", () => {
  it("최소 — title/description만", () => {
    expect(
      mapCreateIssueBody({ projectId: 1, title: "T", description: "D" }),
    ).toEqual({ title: "T", description: "D" });
  });

  it("labels/assigneeIds 비어있으면 생략", () => {
    expect(
      mapCreateIssueBody({
        projectId: 1,
        title: "T",
        description: "D",
        labels: [],
        assigneeIds: [],
      }),
    ).toEqual({ title: "T", description: "D" });
  });

  it("labels는 comma string으로, assigneeIds는 배열로 전달", () => {
    expect(
      mapCreateIssueBody({
        projectId: 1,
        title: "T",
        description: "D",
        labels: ["bug", "ui"],
        assigneeIds: [7, 9],
      }),
    ).toEqual({
      title: "T",
      description: "D",
      labels: "bug,ui",
      assignee_ids: [7, 9],
    });
  });
});

describe("normalizeProject", () => {
  it("snake_case → camelCase", () => {
    const out = normalizeProject({
      id: 42,
      name: "repo",
      path_with_namespace: "group/repo",
      name_with_namespace: "Group / repo",
      web_url: "https://gitlab.com/group/repo",
    });
    expect(out).toEqual({
      id: 42,
      pathWithNamespace: "group/repo",
      name: "repo",
      nameWithNamespace: "Group / repo",
      webUrl: "https://gitlab.com/group/repo",
    });
  });
});

describe("normalizeIssueStatus", () => {
  it("opened 이슈 — iid/state/labels 매핑", () => {
    const out = normalizeIssueStatus({
      iid: 12,
      title: "X",
      state: "opened",
      web_url: "https://gitlab.com/g/r/-/issues/12",
      labels: ["bug", "ui"],
    });
    expect(out).toEqual({
      iid: 12,
      title: "X",
      state: "opened",
      webUrl: "https://gitlab.com/g/r/-/issues/12",
      labels: ["bug", "ui"],
    });
  });

  it("closed 이슈 — state 'closed'", () => {
    const out = normalizeIssueStatus({
      iid: 1,
      title: "T",
      state: "closed",
      web_url: "u",
      labels: [],
    });
    expect(out.state).toBe("closed");
  });

  it("labels 누락 시 빈 배열", () => {
    const out = normalizeIssueStatus({
      iid: 1,
      title: "T",
      state: "opened",
      web_url: "u",
    });
    expect(out.labels).toEqual([]);
  });
});

describe("messageForGitlabStatus", () => {
  it("주요 상태 코드별 비어있지 않은 메시지 반환", () => {
    expect(messageForGitlabStatus(401)).toBeTruthy();
    expect(messageForGitlabStatus(403)).toBeTruthy();
    expect(messageForGitlabStatus(404)).toBeTruthy();
    expect(messageForGitlabStatus(422)).toBeTruthy();
    expect(messageForGitlabStatus(429)).toBeTruthy();
    expect(messageForGitlabStatus(500)).toBeTruthy();
    expect(messageForGitlabStatus(502)).toBeTruthy();
  });

  it("알려지지 않은 상태 코드는 generic 메시지 반환", () => {
    expect(messageForGitlabStatus(418)).toContain("gitlab.error.generic");
  });
});
