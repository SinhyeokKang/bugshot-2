import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buildAuthHeader,
  extractGithubDetail,
  getMyself,
  mapCreateIssueBody,
  messageForGithubStatus,
  normalizeIssueStatus,
  normalizeRepo,
} from "../github-api";
import type { GithubAuth } from "@/types/github";

vi.mock("@/i18n", () => ({
  t: (k: string, p?: Record<string, unknown>) =>
    p ? k.replace(/\{(\w+)\}/g, (_, key) => String(p[key] ?? `{${key}}`)) : k,
}));

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

describe("normalizeIssueStatus", () => {
  it("open 이슈 — state_reason은 null", () => {
    const out = normalizeIssueStatus({
      number: 42,
      title: "X",
      state: "open",
      state_reason: null,
      html_url: "https://github.com/o/r/issues/42",
      labels: [{ name: "bug", color: "d73a4a" }],
    });
    expect(out).toEqual({
      number: 42,
      title: "X",
      state: "open",
      stateReason: null,
      htmlUrl: "https://github.com/o/r/issues/42",
      labels: [{ name: "bug", color: "d73a4a" }],
    });
  });

  it("closed completed", () => {
    const out = normalizeIssueStatus({
      number: 1,
      title: "T",
      state: "closed",
      state_reason: "completed",
      html_url: "u",
      labels: [],
    });
    expect(out.state).toBe("closed");
    expect(out.stateReason).toBe("completed");
  });

  it("closed not_planned", () => {
    const out = normalizeIssueStatus({
      number: 1,
      title: "T",
      state: "closed",
      state_reason: "not_planned",
      html_url: "u",
      labels: [],
    });
    expect(out.stateReason).toBe("not_planned");
  });

  it("labels — 문자열 배열도 지원 (구 API 응답)", () => {
    const out = normalizeIssueStatus({
      number: 1,
      title: "T",
      state: "open",
      html_url: "u",
      labels: ["bug" as unknown as { name: string; color: string }],
    });
    expect(out.labels).toEqual([{ name: "bug", color: "" }]);
  });

  it("state_reason 누락 시 null", () => {
    const out = normalizeIssueStatus({
      number: 1,
      title: "T",
      state: "open",
      html_url: "u",
      labels: [],
    });
    expect(out.stateReason).toBeNull();
  });
});

describe("messageForGithubStatus", () => {
  it("주요 상태 코드별 비어있지 않은 메시지 반환", () => {
    expect(messageForGithubStatus(401)).toBeTruthy();
    expect(messageForGithubStatus(403)).toBeTruthy();
    expect(messageForGithubStatus(404)).toBeTruthy();
    expect(messageForGithubStatus(422)).toBeTruthy();
    expect(messageForGithubStatus(429)).toBeTruthy();
    expect(messageForGithubStatus(500)).toBeTruthy();
    expect(messageForGithubStatus(502)).toBeTruthy();
  });

  it("알려지지 않은 상태 코드는 generic 메시지 반환", () => {
    const msg = messageForGithubStatus(418);
    expect(msg).toContain("github.error.generic");
  });
});

describe("getMyself — email fallback", () => {
  const auth: GithubAuth = { kind: "pat", pat: "ghp_x", viewerLogin: "u" };
  const originalFetch = globalThis.fetch;

  function mockFetchResponses(...responses: Array<{ body: unknown; ok?: boolean }>) {
    const queue = [...responses];
    globalThis.fetch = vi.fn(async () => {
      const next = queue.shift()!;
      return {
        ok: next.ok ?? true,
        status: next.ok === false ? 403 : 200,
        json: async () => next.body,
        text: async () => JSON.stringify(next.body),
      } as Response;
    });
  }

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("/user에 email이 있으면 그대로 사용", async () => {
    mockFetchResponses({ body: { login: "u", id: 1, email: "pub@e.com" } });

    const me = await getMyself(auth);
    expect(me.email).toBe("pub@e.com");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("/user email이 null이면 /user/emails에서 primary를 가져옴", async () => {
    mockFetchResponses(
      { body: { login: "u", id: 1, email: null } },
      { body: [
        { email: "secondary@e.com", primary: false },
        { email: "primary@e.com", primary: true },
      ]},
    );

    const me = await getMyself(auth);
    expect(me.email).toBe("primary@e.com");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1][0]).toContain("/user/emails");
  });

  it("/user/emails 실패 시 email은 undefined", async () => {
    mockFetchResponses(
      { body: { login: "u", id: 1, email: null } },
      { body: { message: "Forbidden" }, ok: false },
    );

    const me = await getMyself(auth);
    expect(me.email).toBeUndefined();
  });

  it("/user/emails에 primary가 없으면 email은 undefined", async () => {
    mockFetchResponses(
      { body: { login: "u", id: 1, email: null } },
      { body: [{ email: "nope@e.com", primary: false }] },
    );

    const me = await getMyself(auth);
    expect(me.email).toBeUndefined();
  });
});
