import { describe, expect, it } from "vitest";
import { canCreateIssue } from "../github-repo";
import type { GithubRepo } from "@/types/github";

describe("canCreateIssue", () => {
  const repo = (over: Partial<GithubRepo> = {}): GithubRepo => ({
    id: 1,
    nodeId: "n",
    owner: "o",
    name: "r",
    fullName: "o/r",
    private: false,
    htmlUrl: "x",
    hasIssues: true,
    archived: false,
    ...over,
  });

  it("이슈 탭이 켜져 있고 보관되지 않았으면 true", () => {
    expect(canCreateIssue(repo())).toBe(true);
  });

  it("이슈 탭이 꺼진 repo는 false", () => {
    expect(canCreateIssue(repo({ hasIssues: false }))).toBe(false);
  });

  it("보관된 repo는 이슈 탭이 켜져 있어도 false", () => {
    expect(canCreateIssue(repo({ archived: true }))).toBe(false);
  });
});
