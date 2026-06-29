import { describe, expect, it } from "vitest";
import {
  canPromoteSlack,
  formatIssueKey,
  isRefreshable,
  isSlackPreserved,
  matchesQuery,
  matchesStatus,
  parseGithubIssueNumber,
  parseGithubIssueUrl,
  promotableTargets,
  resolveGithubCoords,
  resolveInitialPlatform,
  resolveNotionPageId,
  submittablePlatforms,
} from "../issueListUtils";
import type { IssueRecord } from "@/store/issues-store";
import type { Accounts, PlatformId } from "@/types/platform";

function makeAccounts(...platforms: PlatformId[]): Accounts {
  const acc: Record<string, unknown> = {};
  for (const p of platforms) acc[p] = { platform: p, connectedAt: 0 };
  return acc as Accounts;
}

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
    url: "https://x.atlassian.net/browse/BUG-123",
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

describe("formatIssueKey", () => {
  // 시각 구분은 PlatformChip 아이콘이 담당 — 키 자체에 추가 prefix 안 붙임.
  it("Jira key 그대로 반환", () => {
    expect(formatIssueKey({ platform: "jira", key: "BUG-1" })).toBe("BUG-1");
  });

  it("GitHub key 그대로 (이미 # prefix가 포함되어 저장됨)", () => {
    expect(formatIssueKey({ platform: "github", key: "#42" })).toBe("#42");
  });

  it("key가 undefined면 빈 문자열", () => {
    expect(formatIssueKey({ platform: "jira", key: undefined })).toBe("");
    expect(formatIssueKey({ platform: "github", key: undefined })).toBe("");
  });
});

describe("parseGithubIssueNumber", () => {
  it("'#42' → 42", () => {
    expect(parseGithubIssueNumber("#42")).toBe(42);
  });

  it("'42' → 42 (# 없어도 OK)", () => {
    expect(parseGithubIssueNumber("42")).toBe(42);
  });

  it("undefined / 빈 문자열 → null", () => {
    expect(parseGithubIssueNumber(undefined)).toBeNull();
    expect(parseGithubIssueNumber("")).toBeNull();
  });

  it("숫자가 아니면 null", () => {
    expect(parseGithubIssueNumber("BUG-1")).toBeNull();
    expect(parseGithubIssueNumber("#abc")).toBeNull();
  });
});

describe("parseGithubIssueUrl", () => {
  it("표준 issues URL 추출", () => {
    expect(parseGithubIssueUrl("https://github.com/SinhyeokKang/bugshot-2/issues/8"))
      .toEqual({ owner: "SinhyeokKang", repo: "bugshot-2", number: 8 });
  });

  it("trailing slash 허용", () => {
    expect(parseGithubIssueUrl("https://github.com/o/r/issues/42/"))
      .toEqual({ owner: "o", repo: "r", number: 42 });
  });

  it("PR URL은 거부 (issues 경로만)", () => {
    expect(parseGithubIssueUrl("https://github.com/o/r/pull/42")).toBeNull();
  });

  it("github.com이 아니면 null", () => {
    expect(parseGithubIssueUrl("https://gitlab.com/o/r/issues/1")).toBeNull();
    expect(parseGithubIssueUrl("https://x.atlassian.net/browse/BUG-1")).toBeNull();
  });

  it("undefined / 빈 / 잘못된 URL", () => {
    expect(parseGithubIssueUrl(undefined)).toBeNull();
    expect(parseGithubIssueUrl("")).toBeNull();
    expect(parseGithubIssueUrl("not-a-url")).toBeNull();
  });
});

describe("resolveGithubCoords", () => {
  it("저장된 owner/repo + key 우선", () => {
    expect(
      resolveGithubCoords({
        githubOwner: "stored-o",
        githubRepo: "stored-r",
        key: "#42",
        url: "https://github.com/url-o/url-r/issues/99",
      }),
    ).toEqual({ owner: "stored-o", repo: "stored-r", number: 42 });
  });

  it("owner/repo 비어있으면 url에서 fallback (구 entry)", () => {
    expect(
      resolveGithubCoords({
        githubOwner: undefined,
        githubRepo: undefined,
        key: "#8",
        url: "https://github.com/SinhyeokKang/bugshot-2/issues/8",
      }),
    ).toEqual({ owner: "SinhyeokKang", repo: "bugshot-2", number: 8 });
  });

  it("key 없어도 url에서 number fallback", () => {
    expect(
      resolveGithubCoords({
        githubOwner: "o",
        githubRepo: "r",
        key: undefined,
        url: "https://github.com/o/r/issues/123",
      }),
    ).toEqual({ owner: "o", repo: "r", number: 123 });
  });

  it("owner/repo도 없고 url도 못 파싱 → null", () => {
    expect(
      resolveGithubCoords({
        githubOwner: undefined,
        githubRepo: undefined,
        key: "#1",
        url: undefined,
      }),
    ).toBeNull();
  });

  it("owner/repo는 있지만 key가 invalid + url에서도 number 못 뽑으면 null", () => {
    expect(
      resolveGithubCoords({
        githubOwner: "o",
        githubRepo: "r",
        key: "BUG-1",
        url: "https://github.com/o/r",
      }),
    ).toBeNull();
  });
});

describe("isRefreshable", () => {
  it("submitted + jira + key + url → true", () => {
    expect(isRefreshable(makeIssue())).toBe(true);
  });

  it("draft 상태는 false", () => {
    expect(isRefreshable(makeIssue({ status: "draft" }))).toBe(false);
  });

  it("submitted but key 없음 → false", () => {
    expect(isRefreshable(makeIssue({ key: undefined }))).toBe(false);
  });

  it("github + owner/repo/key/url 모두 있음 → true", () => {
    const issue = makeIssue({
      platform: "github",
      key: "#42",
      url: "https://github.com/o/r/issues/42",
      githubOwner: "o",
      githubRepo: "r",
    });
    expect(isRefreshable(issue)).toBe(true);
  });

  it("github but owner 없음 → false (status 호출 불가)", () => {
    const issue = makeIssue({
      platform: "github",
      key: "#42",
      url: "x",
      githubOwner: undefined,
      githubRepo: "r",
    });
    expect(isRefreshable(issue)).toBe(false);
  });

  it("github but repo 없음 → false", () => {
    const issue = makeIssue({
      platform: "github",
      key: "#42",
      url: "x",
      githubOwner: "o",
      githubRepo: undefined,
    });
    expect(isRefreshable(issue)).toBe(false);
  });

  it("github + 구 entry — owner/repo 비었지만 url이 GitHub issues 형식이면 true (fallback)", () => {
    const issue = makeIssue({
      platform: "github",
      key: "#8",
      url: "https://github.com/SinhyeokKang/bugshot-2/issues/8",
      githubOwner: undefined,
      githubRepo: undefined,
    });
    expect(isRefreshable(issue)).toBe(true);
  });

  it("submitted but url 없음 → false (url 가드)", () => {
    expect(isRefreshable(makeIssue({ url: undefined }))).toBe(false);
  });

  it("linear + url + key 정상 → true", () => {
    const issue = makeIssue({
      platform: "linear",
      key: "TEAM-42",
      url: "https://linear.app/team/issue/TEAM-42",
    });
    expect(isRefreshable(issue)).toBe(true);
  });

  it("notion + notionPageId 있음 → true", () => {
    const issue = makeIssue({
      platform: "notion",
      key: "page-1",
      url: "https://www.notion.so/work/Some-Page",
      notionPageId: "12345678123456781234567812345678",
    });
    expect(isRefreshable(issue)).toBe(true);
  });

  it("notion + notionPageId 없지만 url에서 fallback 추출 가능 → true", () => {
    const issue = makeIssue({
      platform: "notion",
      key: "page-1",
      url: "https://www.notion.so/work/Some-Page-12345678123456781234567812345678",
      notionPageId: undefined,
    });
    expect(isRefreshable(issue)).toBe(true);
  });

  it("notion + pageId 없고 url에서도 추출 불가 → false", () => {
    const issue = makeIssue({
      platform: "notion",
      key: "page-1",
      url: "https://www.notion.so/work/Some-Page-no-id-here",
      notionPageId: undefined,
    });
    expect(isRefreshable(issue)).toBe(false);
  });

  // 회귀: isRefreshable은 if 체인 + 디폴트 return false라 asana 분기 누락 시
  // typecheck로 안 잡히고 조용히 refresh 불가로 샌다 (design.md 위험 요소).
  it("asana + asanaTaskGid 있음 → true", () => {
    const issue = makeIssue({
      platform: "asana",
      key: "TASK_GID",
      url: "https://app.asana.com/0/0/TASK_GID",
      asanaTaskGid: "TASK_GID",
    } as Partial<IssueRecord>);
    expect(isRefreshable(issue)).toBe(true);
  });

  it("asana + asanaTaskGid 없음 → false", () => {
    const issue = makeIssue({
      platform: "asana",
      key: "TASK_GID",
      url: "https://app.asana.com/0/0/TASK_GID",
      asanaTaskGid: undefined,
    } as Partial<IssueRecord>);
    expect(isRefreshable(issue)).toBe(false);
  });

  it("clickup + clickupTaskId 있음 → true", () => {
    const issue = makeIssue({
      platform: "clickup",
      key: "abc123",
      url: "https://app.clickup.com/t/abc123",
      clickupTaskId: "abc123",
    } as Partial<IssueRecord>);
    expect(isRefreshable(issue)).toBe(true);
  });

  it("clickup + clickupTaskId 없음 → false", () => {
    const issue = makeIssue({
      platform: "clickup",
      key: "abc123",
      url: "https://app.clickup.com/t/abc123",
      clickupTaskId: undefined,
    } as Partial<IssueRecord>);
    expect(isRefreshable(issue)).toBe(false);
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

  // Slack 보존 이슈는 status="submitted"라 submitted 필터에 뜨고 draft 필터엔 안 뜬다 (목표 2).
  it("slack 보존 이슈는 submitted로 분류 (draft 필터엔 미노출)", () => {
    const issue = makeIssue({
      status: "submitted",
      platform: "slack",
      slackPreserved: true,
    } as Partial<IssueRecord>);
    expect(matchesStatus(issue, "submitted")).toBe(true);
    expect(matchesStatus(issue, "draft")).toBe(false);
  });
});

describe("resolveNotionPageId", () => {
  it("notionPageId가 직접 있으면 그 값 반환 (URL fallback 안 함)", () => {
    expect(
      resolveNotionPageId({
        notionPageId: "stored-page-id-32chars-abcdef1234",
        url: "https://www.notion.so/other-workspace/Different-Page-99999999999999999999999999999999",
      }),
    ).toBe("stored-page-id-32chars-abcdef1234");
  });

  it("notionPageId 없으면 url에서 32-hex pageId 추출 (fallback)", () => {
    expect(
      resolveNotionPageId({
        notionPageId: undefined,
        url: "https://www.notion.so/work/My-Page-12345678123456781234567812345678",
      }),
    ).toBe("12345678123456781234567812345678");
  });

  it("notionPageId 없고 url에서도 추출 불가 → null", () => {
    expect(
      resolveNotionPageId({
        notionPageId: undefined,
        url: "https://www.notion.so/work/Plain-Slug-without-id",
      }),
    ).toBeNull();
  });
});

function slackPreservedIssue(overrides: Partial<IssueRecord> = {}): IssueRecord {
  return makeIssue({
    status: "submitted",
    platform: "slack",
    slackPreserved: true,
    ...overrides,
  } as Partial<IssueRecord>);
}

describe("isSlackPreserved", () => {
  it("submitted + slackPreserved=true → true", () => {
    expect(isSlackPreserved(slackPreservedIssue())).toBe(true);
  });

  it("draft는 false (slackPreserved 플래그가 있어도)", () => {
    expect(
      isSlackPreserved(
        makeIssue({ status: "draft", slackPreserved: true } as Partial<IssueRecord>),
      ),
    ).toBe(false);
  });

  it("submitted + 플래그 없음 → false (일반 제출 이슈)", () => {
    expect(isSlackPreserved(makeIssue({ status: "submitted" }))).toBe(false);
  });
});

describe("promotableTargets", () => {
  it("slack만 연결 → [] (승격 대상 없음)", () => {
    expect(promotableTargets(makeAccounts("slack"))).toEqual([]);
  });

  it("slack + jira → ['jira'] (slack 제외)", () => {
    expect(promotableTargets(makeAccounts("slack", "jira"))).toEqual(["jira"]);
  });

  it("jira + github + slack → fallback 순서대로 slack 제외", () => {
    expect(promotableTargets(makeAccounts("github", "jira", "slack"))).toEqual([
      "jira",
      "github",
    ]);
  });

  it("아무것도 연결 안 됨 → []", () => {
    expect(promotableTargets(makeAccounts())).toEqual([]);
  });
});

describe("canPromoteSlack", () => {
  it("slack 보존 이슈 + 트래커 1개 → true", () => {
    expect(canPromoteSlack(slackPreservedIssue(), makeAccounts("slack", "jira"))).toBe(true);
  });

  it("slack 보존 이슈 + 트래커 0 (slack만 연결) → false", () => {
    expect(canPromoteSlack(slackPreservedIssue(), makeAccounts("slack"))).toBe(false);
  });

  it("일반 submitted 이슈는 트래커 있어도 false", () => {
    expect(
      canPromoteSlack(makeIssue({ status: "submitted" }), makeAccounts("jira")),
    ).toBe(false);
  });

  it("draft는 false", () => {
    expect(canPromoteSlack(makeIssue({ status: "draft" }), makeAccounts("jira"))).toBe(false);
  });
});

describe("submittablePlatforms", () => {
  it("slack 보존 이슈 → slack 제외 목록", () => {
    expect(
      submittablePlatforms(slackPreservedIssue(), makeAccounts("slack", "jira", "github")),
    ).toEqual(["jira", "github"]);
  });

  it("일반 draft → connectedPlatforms 전체 (slack 포함)", () => {
    expect(
      submittablePlatforms(makeIssue({ status: "draft" }), makeAccounts("jira", "slack")),
    ).toEqual(["jira", "slack"]);
  });
});

describe("resolveInitialPlatform", () => {
  it("picked=slack이 available에 없으면 available 첫 항목으로 보정", () => {
    expect(resolveInitialPlatform("slack", ["jira"])).toBe("jira");
  });

  it("picked가 available에 있으면 그대로 유지", () => {
    expect(resolveInitialPlatform("jira", ["jira", "github"])).toBe("jira");
    expect(resolveInitialPlatform("github", ["jira", "github"])).toBe("github");
  });

  it("picked=null + available 비어있음 → 'jira' 폴백", () => {
    expect(resolveInitialPlatform(null, [])).toBe("jira");
  });

  it("picked=slack + available 비어있음 → 'jira' 폴백", () => {
    expect(resolveInitialPlatform("slack", [])).toBe("jira");
  });

  it("picked=null이지만 available 있으면 available 첫 항목", () => {
    expect(resolveInitialPlatform(null, ["github", "linear"])).toBe("github");
  });
});
