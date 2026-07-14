import { describe, expect, it } from "vitest";
import { initialGhFields } from "../GithubIssueFields";

// prefill 우선순위: repo(목적지)는 last 우선·defaults fallback.
// assignee는 repo 하위 필드 — last 우선이되, repo가 갈리면 그 repo의 collaborator라 무효.

describe("initialGhFields — default assignee", () => {
  it("last 없으면 defaults의 repo·assignee prefill", () => {
    const out = initialGhFields(undefined, {
      owner: "acme",
      repo: "web",
      assignee: "dflt",
    });
    expect(out.owner).toBe("acme");
    expect(out.repo).toBe("web");
    expect(out.assignee).toBe("dflt");
  });

  it("같은 repo면 last.assignee가 defaults.assignee보다 우선", () => {
    const out = initialGhFields(
      { owner: "acme", repo: "web", assignee: "lastUser" },
      { owner: "acme", repo: "web", assignee: "dflt" },
    );
    expect(out.assignee).toBe("lastUser");
  });

  it("같은 repo + last에 assignee 없으면 defaults.assignee로 채움", () => {
    const out = initialGhFields(
      { owner: "acme", repo: "web" },
      { owner: "acme", repo: "web", assignee: "dflt" },
    );
    expect(out.repo).toBe("web");
    expect(out.assignee).toBe("dflt");
  });

  // repo는 목적지 필드라 last 우선 → 해소된 repo는 last의 것. last.assignee는 바로 그 repo의
  // collaborator라 유효하다. 무효한 건 defaults.assignee(다른 repo 소속) 쪽이다.
  it("repo가 갈리면 last.assignee는 유지된다 (해소된 repo와 같은 쌍이라 유효)", () => {
    const out = initialGhFields(
      { owner: "acme", repo: "other", assignee: "lastUser" },
      { owner: "acme", repo: "web", assignee: "dflt" },
    );
    expect(out.repo).toBe("other");
    expect(out.assignee).toBe("lastUser");
  });

  it("repo가 갈리고 last에 assignee가 없으면 defaults.assignee를 쓰지 않는다 (다른 repo 소속)", () => {
    const out = initialGhFields(
      { owner: "acme", repo: "other" },
      { owner: "acme", repo: "web", assignee: "dflt" },
    );
    expect(out.repo).toBe("other");
    expect(out.assignee).toBeUndefined();
  });

  it("last/defaults 모두 없으면 빈 값", () => {
    const out = initialGhFields(undefined, undefined);
    expect(out.repo).toBeUndefined();
    expect(out.assignee).toBeUndefined();
  });
});
