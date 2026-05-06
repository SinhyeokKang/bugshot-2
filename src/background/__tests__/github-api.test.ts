import { describe, expect, it } from "vitest";
import {
  buildAuthHeader,
  extractGithubDetail,
  mapCreateIssueBody,
  normalizeRepo,
} from "../github-api";

describe("buildAuthHeader", () => {
  it("PAT은 'token <pat>'", () => {
    expect(
      buildAuthHeader({ kind: "pat", pat: "ghp_xyz", viewerLogin: "u" }),
    ).toBe("token ghp_xyz");
  });

  it("OAuth는 'Bearer <accessToken>'", () => {
    expect(
      buildAuthHeader({
        kind: "oauth",
        accessToken: "ATK",
        tokenType: "bearer",
        scope: "repo",
        viewerLogin: "u",
        grantedAt: 1,
      }),
    ).toBe("Bearer ATK");
  });
});

describe("extractGithubDetail", () => {
  it("message 필드를 끌어올림", () => {
    expect(extractGithubDetail({ message: "Not Found" })).toBe("\nNot Found");
  });

  it("errors 배열의 message를 평면화", () => {
    expect(
      extractGithubDetail({
        message: "Validation Failed",
        errors: [
          { message: "title is required" },
          { code: "missing_field", field: "body" },
        ],
      }),
    ).toBe("\nValidation Failed\ntitle is required\nmissing_field");
  });

  it("문자열 배열도 처리", () => {
    expect(extractGithubDetail({ errors: ["a", "b"] })).toBe("\na\nb");
  });

  it("빈 body는 빈 문자열", () => {
    expect(extractGithubDetail(null)).toBe("");
    expect(extractGithubDetail(undefined)).toBe("");
    expect(extractGithubDetail({})).toBe("");
  });
});

describe("mapCreateIssueBody", () => {
  it("최소 — title/body만", () => {
    expect(
      mapCreateIssueBody({
        owner: "o",
        repo: "r",
        title: "T",
        body: "B",
      }),
    ).toEqual({ title: "T", body: "B" });
  });

  it("labels/assignees 비어있지 않을 때만 포함", () => {
    expect(
      mapCreateIssueBody({
        owner: "o",
        repo: "r",
        title: "T",
        body: "B",
        labels: [],
        assignees: [],
      }),
    ).toEqual({ title: "T", body: "B" });
  });

  it("labels/assignees 채워지면 그대로 전달", () => {
    expect(
      mapCreateIssueBody({
        owner: "o",
        repo: "r",
        title: "T",
        body: "B",
        labels: ["bug", "ui"],
        assignees: ["alice"],
      }),
    ).toEqual({
      title: "T",
      body: "B",
      labels: ["bug", "ui"],
      assignees: ["alice"],
    });
  });
});

describe("normalizeRepo", () => {
  it("snake_case → camelCase + owner.login 평탄화", () => {
    const out = normalizeRepo({
      id: 1,
      node_id: "n1",
      name: "repo",
      full_name: "owner/repo",
      owner: { login: "owner" },
      private: true,
      description: "desc",
      html_url: "https://github.com/owner/repo",
    });
    expect(out).toEqual({
      id: 1,
      nodeId: "n1",
      name: "repo",
      fullName: "owner/repo",
      owner: "owner",
      private: true,
      description: "desc",
      htmlUrl: "https://github.com/owner/repo",
    });
  });

  it("description null → undefined", () => {
    const out = normalizeRepo({
      id: 1,
      node_id: "n",
      name: "r",
      full_name: "o/r",
      owner: { login: "o" },
      private: false,
      description: null,
      html_url: "x",
    });
    expect(out.description).toBeUndefined();
  });
});
