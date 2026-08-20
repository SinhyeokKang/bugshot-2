import { afterEach, describe, expect, it, vi } from "vitest";

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
  createIssue,
  createIssueLink,
  getIssueStatus,
  getIssueTypes,
  getMyself,
  getPriorities,
  getSprint,
  getSprintFieldMeta,
  getTransitions,
  getUsersByAccountIds,
  listSprints,
  messageForJiraStatus,
  parseTransitions,
  searchEpics,
  searchProjects,
  searchUsers,
  transitionIssue,
  updateIssueDescription,
  uploadAttachment,
  extractJiraDetail,
  jiraFetch,
  jiraMultipart,
  JiraError,
} from "../jira-api";
import { mockFetchOnce, type MockFetch } from "@/test/fetch-mock";
import type { JiraAdfDoc } from "@/types/jira";

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

describe("resolveUrl egress 자격증명 게이트", () => {
  const apiKey = {
    kind: "apiKey",
    email: "u@x.com",
    apiToken: "tok",
  } as const;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetch() {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);
    vi.stubGlobal("fetch", f);
    return f;
  }

  // Basic 헤더에 email:apiToken이 실려 나가므로 평문 http면 그대로 샌다.
  it("apiKey 인증의 평문 http는 fetch 전에 끊는다", async () => {
    const f = mockFetch();
    await expect(
      jiraFetch({ ...apiKey, baseUrl: "http://jira.corp" }, "/rest/api/3/myself"),
    ).rejects.toThrow("jira.workspaceUrl.insecure");
    expect(f).not.toHaveBeenCalled();
  });

  it("https는 종전대로 통과한다", async () => {
    const f = mockFetch();
    await jiraFetch(
      { ...apiKey, baseUrl: "https://x.atlassian.net" },
      "/rest/api/3/myself",
    );
    expect(f.mock.calls[0][0]).toBe("https://x.atlassian.net/rest/api/3/myself");
  });

  it("loopback http는 통과한다", async () => {
    const f = mockFetch();
    await jiraFetch({ ...apiKey, baseUrl: "http://localhost:8080" }, "/rest/api/3/myself");
    expect(f.mock.calls[0][0]).toBe("http://localhost:8080/rest/api/3/myself");
  });

  // oauth는 baseUrl을 안 쓰고 고정 호스트로 나가므로 게이트와 무관해야 한다.
  it("oauth 인증은 게이트 영향 없이 고정 호스트로 나간다", async () => {
    const f = mockFetch();
    await jiraFetch(
      {
        kind: "oauth",
        accessToken: "at",
        refreshToken: "rt",
        expiresAt: Date.now() + 3_600_000,
        cloudId: "cid",
        siteUrl: "https://x.atlassian.net",
        email: "u@x.com",
      },
      "/rest/api/3/myself",
    );
    expect(f.mock.calls[0][0]).toBe(
      "https://api.atlassian.com/ex/jira/cid/rest/api/3/myself",
    );
  });
});

// ── 스프린트 (createmeta 판정 + agile 목록) ────────────────────────────────

const OAUTH_AUTH = {
  kind: "oauth",
  accessToken: "at",
  refreshToken: "rt",
  expiresAt: Date.now() + 3_600_000,
  cloudId: "cid",
  siteUrl: "https://x.atlassian.net",
  email: "u@x.com",
} as const;

const ADF: JiraAdfDoc = { type: "doc", version: 1, content: [] };

// 2026-08-13 실측 응답의 축약본. 봉투 키는 `values`가 아니라 `fields`다(design R3).
const CREATEMETA_FIXTURE = {
  fields: [
    { fieldId: "summary", name: "요약", schema: { type: "string", system: "summary" } },
    {
      fieldId: "customfield_10020",
      name: "Sprint",
      schema: {
        type: "array",
        items: "json",
        custom: "com.pyxis.greenhopper.jira:gh-sprint",
        customId: 10020,
      },
    },
  ],
  total: 21,
};

type Route = { match: string | RegExp; status?: number; body?: unknown };

// 기존 목 헬퍼(mockFetch)는 단일 응답이라 URL별 분기가 없다 — agile 팬아웃은 board 목록과
// 보드별 sprint, createmeta를 한 흐름에서 갈라 답해야 한다. 먼저 매칭된 라우트가 이긴다.
function mockFetchByUrl(routes: Route[]) {
  const f = vi.fn(async (url: string, _init?: RequestInit) => {
    const hit = routes.find((r) =>
      typeof r.match === "string" ? url.includes(r.match) : r.match.test(url),
    );
    const status = hit ? (hit.status ?? 200) : 404;
    const body = hit?.body ?? {};
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  });
  vi.stubGlobal("fetch", f);
  return f;
}

function urls(f: ReturnType<typeof mockFetchByUrl>): string[] {
  return f.mock.calls.map((c) => String(c[0]));
}

describe("스프린트 조회", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getSprintFieldMeta", () => {
    it("실측 createmeta 응답에서 sprint 필드 id와 배열 여부를 뽑는다", async () => {
      const f = mockFetchByUrl([
        { match: "/issue/createmeta/", body: CREATEMETA_FIXTURE },
      ]);

      await expect(
        getSprintFieldMeta(OAUTH_AUTH, "FCLXP", "10004"),
      ).resolves.toEqual({ fieldId: "customfield_10020", isArray: true });
      expect(urls(f)[0]).toContain(
        "/rest/api/3/issue/createmeta/FCLXP/issuetypes/10004",
      );
    });

    // R5: 페이지네이션을 하지 않는 대신 한 페이지를 크게 받는다. 이게 빠지면 기본 50에 걸려
    // 필드가 많은 create 화면에서 sprint가 무음으로 잘린다("스프린트 없음"과 구별 불가).
    it("한 페이지로 끝내려고 maxResults를 크게 요청한다", async () => {
      const f = mockFetchByUrl([
        { match: "/issue/createmeta/", body: CREATEMETA_FIXTURE },
      ]);

      await getSprintFieldMeta(OAUTH_AUTH, "FCLXP", "10004");

      expect(urls(f)[0]).toContain("maxResults=200");
    });

    it("gh-sprint 필드가 없는 create 화면이면 null", async () => {
      mockFetchByUrl([
        { match: "/issue/createmeta/", body: { fields: [], total: 0 } },
      ]);

      await expect(
        getSprintFieldMeta(OAUTH_AUTH, "KANBAN", "10004"),
      ).resolves.toBeNull();
    });
  });

  describe("listSprints", () => {
    const boardList = (
      boards: { id: number; name: string; type: string }[],
    ): Route => ({
      match: /\/rest\/agile\/1\.0\/board\?/,
      body: { values: boards, total: boards.length, isLast: true },
    });

    // 서버 파라미터가 유일한 관문이다 — 목록 경로엔 클라이언트 상태 필터가 없어서
    // state가 빠지면 closed 스프린트가 그대로 콤보에 뜨고, projectKeyOrId가 빠지면
    // 사이트 전역 보드에서 상위 5개를 긁어 다른 프로젝트 스프린트가 섞인다.
    it("보드는 프로젝트로, 스프린트는 active·future로 좁혀 요청한다", async () => {
      const f = mockFetchByUrl([
        { match: /\/board\/1\/sprint/, body: { values: [] } },
        boardList([{ id: 1, name: "A", type: "scrum" }]),
      ]);

      await listSprints(OAUTH_AUTH, "WEB");

      const [boardUrl, sprintUrl] = urls(f);
      expect(boardUrl).toContain("projectKeyOrId=WEB");
      expect(sprintUrl).toContain("state=active,future");
    });

    // scope 미비 401은 영구 조건이라 refresh로 안 풀린다. 재시도 레인을 타면 콤보를 열 때마다
    // refresh token이 회전하고, 그 직후 persist가 실패하면 멀쩡하던 연동이 끊긴다.
    // 팬아웃 5개가 각자 401을 받으면 회전 폭주가 가장 큰 지점이다(refreshInFlight가 1회로
    // 모으더라도 그물이 없으면 이 자리만 조용히 되돌아갈 수 있다).
    it("보드별 스프린트 조회가 401이어도 토큰 갱신을 시도하지 않는다", async () => {
      const f = mockFetchByUrl([
        {
          match: "/token",
          body: { access_token: "new", refresh_token: "new-rt", expires_in: 3600 },
        },
        { match: /\/board\/\d+\/sprint/, status: 401, body: {} },
        boardList([{ id: 1, name: "A", type: "scrum" }]),
      ]);

      await expect(listSprints(OAUTH_AUTH, "WEB")).resolves.toEqual({
        sprints: [],
        multiBoard: false,
      });
      expect(urls(f).some((u) => u.includes("/token"))).toBe(false);
      expect(f).toHaveBeenCalledTimes(2);
    });

    it("보드 목록이 401이어도 토큰 갱신을 시도하지 않는다", async () => {
      const f = mockFetchByUrl([
        {
          match: "/token",
          body: { access_token: "new", refresh_token: "new-rt", expires_in: 3600 },
        },
        {
          match: /\/rest\/agile\/1\.0\/board\?/,
          status: 401,
          body: { code: 401, message: "Unauthorized; scope does not match" },
        },
      ]);

      await expect(listSprints(OAUTH_AUTH, "WEB")).resolves.toEqual({
        sprints: [],
        multiBoard: false,
      });
      expect(urls(f).some((u) => u.includes("/token"))).toBe(false);
      expect(f).toHaveBeenCalledTimes(1);
    });

    it("보드 하나의 스프린트를 보드명과 함께 돌려준다", async () => {
      mockFetchByUrl([
        {
          match: /\/board\/1\/sprint/,
          body: {
            values: [
              { id: 42, name: "Sprint 24", state: "active", originBoardId: 1 },
            ],
          },
        },
        boardList([{ id: 1, name: "WEB board", type: "scrum" }]),
      ]);

      const out = await listSprints(OAUTH_AUTH, "WEB");

      expect(out.multiBoard).toBe(false);
      expect(out.sprints).toHaveLength(1);
      expect(out.sprints[0]).toMatchObject({
        id: 42,
        name: "Sprint 24",
        state: "active",
        boardName: "WEB board",
      });
    });

    // 실측: 칸반 보드는 400 + 로케일 번역된 errorMessages를 준다. 문자열 매칭은 성립하지 않고,
    // 보드 하나가 죽어도 나머지 보드의 스프린트는 살아야 한다.
    it("보드 하나가 400이어도 나머지 보드의 스프린트를 돌려준다", async () => {
      mockFetchByUrl([
        {
          match: /\/board\/1\/sprint/,
          status: 400,
          body: { errorMessages: ["보드는 스프린트를 지원하지 않습니다."] },
        },
        {
          match: /\/board\/2\/sprint/,
          body: {
            values: [
              { id: 7, name: "Sprint 7", state: "future", originBoardId: 2 },
            ],
          },
        },
        boardList([
          { id: 1, name: "A", type: "scrum" },
          { id: 2, name: "B", type: "scrum" },
        ]),
      ]);

      const out = await listSprints(OAUTH_AUTH, "WEB");

      expect(out.sprints.map((s) => s.id)).toEqual([7]);
    });

    // 재연동 전 OAuth 사용자 경로(granular scope가 없어 401/403). 오류를 노출해도 사용자가
    // 당장 할 수 있는 일이 없으므로 "고를 게 없다"로 수렴시킨다.
    it("보드 목록 자체가 403이면 빈 결과를 돌려주고 throw하지 않는다", async () => {
      mockFetchByUrl([
        { match: /\/rest\/agile\/1\.0\/board\?/, status: 403, body: {} },
      ]);

      await expect(listSprints(OAUTH_AUTH, "WEB")).resolves.toEqual({
        sprints: [],
        multiBoard: false,
      });
    });

    // team-managed 보드는 type "simple"로 오고 그중 일부가 스프린트를 정상 반환한다 —
    // 서버에서 type=scrum으로 좁혔으면 그 팀들이 통째로 무음 누락됐다(Task 0 항목 7).
    it("kanban 보드는 아예 호출하지 않고 scrum·simple은 호출한다", async () => {
      const f = mockFetchByUrl([
        { match: /\/board\/\d+\/sprint/, body: { values: [] } },
        boardList([
          { id: 1, name: "scrum", type: "scrum" },
          { id: 2, name: "kanban", type: "kanban" },
          { id: 3, name: "team-managed", type: "simple" },
        ]),
      ]);

      await listSprints(OAUTH_AUTH, "WEB");

      const sprintCalls = urls(f).filter((u) => /\/board\/\d+\/sprint/.test(u));
      expect(sprintCalls).toHaveLength(2);
      expect(sprintCalls.some((u) => u.includes("/board/2/sprint"))).toBe(false);
    });

    it("kanban 제외 후 보드가 7개면 상한 5개까지만 팬아웃한다", async () => {
      const boards = Array.from({ length: 7 }, (_, i) => ({
        id: i + 1,
        name: `board ${i + 1}`,
        type: "scrum",
      }));
      const f = mockFetchByUrl([
        { match: /\/board\/\d+\/sprint/, body: { values: [] } },
        boardList(boards),
      ]);

      await listSprints(OAUTH_AUTH, "WEB");

      expect(f).toHaveBeenCalledTimes(6);
    });

    it("보드가 없는 프로젝트는 200 + 빈 values로 오고 빈 결과가 된다", async () => {
      const f = mockFetchByUrl([boardList([])]);

      await expect(listSprints(OAUTH_AUTH, "KANBAN")).resolves.toEqual({
        sprints: [],
        multiBoard: false,
      });
      expect(f).toHaveBeenCalledTimes(1);
    });
  });

  describe("getSprint", () => {
    it("단건 조회 결과를 JiraSprint로 돌려준다", async () => {
      mockFetchByUrl([
        {
          match: "/rest/agile/1.0/sprint/42",
          body: { id: 42, name: "Sprint 24", state: "active", originBoardId: 1 },
        },
      ]);

      await expect(getSprint(OAUTH_AUTH, 42)).resolves.toMatchObject({
        id: 42,
        name: "Sprint 24",
        state: "active",
      });
    });

    it("404면 throw가 아니라 null", async () => {
      mockFetchByUrl([
        { match: "/rest/agile/1.0/sprint/99", status: 404, body: {} },
      ]);

      await expect(getSprint(OAUTH_AUTH, 99)).resolves.toBeNull();
    });

    it("403이면 throw가 아니라 null", async () => {
      mockFetchByUrl([
        { match: "/rest/agile/1.0/sprint/99", status: 403, body: {} },
      ]);

      await expect(getSprint(OAUTH_AUTH, 99)).resolves.toBeNull();
    });

    // null은 sticky 검증에서 "스프린트가 사라졌다"로 읽혀 사용자가 고른 값을 지운다.
    // 일시 실패를 거기에 섞으면 429 한 번에 선택이 날아간다 — 던져서 검증을 건너뛰게 한다.
    it("429는 null로 뭉개지 않고 그대로 던진다", async () => {
      mockFetchByUrl([
        { match: "/rest/agile/1.0/sprint/99", status: 429, body: {} },
      ]);

      await expect(getSprint(OAUTH_AUTH, 99)).rejects.toThrow();
    });

    it("5xx도 그대로 던진다", async () => {
      mockFetchByUrl([
        { match: "/rest/agile/1.0/sprint/99", status: 503, body: {} },
      ]);

      await expect(getSprint(OAUTH_AUTH, 99)).rejects.toThrow();
    });

    // 401이 갱신 레인을 타면 OAuthError가 되고, 그건 sendBg가 reject 전에 onOAuthExpired를
    // 전역 발화시킨다 — 사용자가 누른 적 없는 sticky 검증이 "세션 만료" 모달을 띄운다.
    it("401이어도 토큰 갱신을 시도하지 않는다", async () => {
      const f = mockFetchByUrl([
        {
          match: "/token",
          body: { access_token: "new", refresh_token: "new-rt", expires_in: 3600 },
        },
        { match: "/rest/agile/1.0/sprint/99", status: 401, body: {} },
      ]);

      await expect(getSprint(OAUTH_AUTH, 99)).rejects.toThrow();
      expect(urls(f).some((u) => u.includes("/token"))).toBe(false);
      expect(f).toHaveBeenCalledTimes(1);
    });
  });
});

// agile만 재시도를 끄는 것이므로 반대편도 고정한다 — 기본값이 뒤집히면 classic 경로 전체가
// 401 자동 갱신을 잃고 사용자가 만료 때마다 재로그인을 요구받는데, 그 회귀엔 그물이 없었다.
describe("classic 경로 401 자동 갱신", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("401을 받으면 토큰을 갱신하고 한 번 더 시도한다", async () => {
    // 갱신본 저장이 실제로 일어나는 경로라 storage가 필요하다.
    vi.stubGlobal("chrome", {
      storage: { local: { get: async () => ({}), set: async () => {} } },
    });
    let served = 0;
    const f = vi.fn(async (url: string) => {
      if (String(url).includes("/token")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: "new",
            refresh_token: "new-rt",
            expires_in: 3600,
          }),
          text: async () => "",
        } as Response;
      }
      const status = served++ === 0 ? 401 : 200;
      return {
        ok: status === 200,
        status,
        json: async () => ({ accountId: "a1" }),
        text: async () => "{}",
      } as Response;
    });
    vi.stubGlobal("fetch", f);

    await expect(
      jiraFetch(OAUTH_AUTH, "/rest/api/3/myself"),
    ).resolves.toMatchObject({ accountId: "a1" });
    expect(f.mock.calls.filter((c) => String(c[0]).includes("/token"))).toHaveLength(1);
    expect(served).toBe(2);
  });
});

describe("createIssue — 스프린트 주입", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const BASE = {
    projectKey: "WEB",
    summary: "제목",
    description: ADF,
    issueTypeId: "10001",
  };
  const CREATED: Route = {
    match: /\/rest\/api\/3\/issue$/,
    body: { id: "1", key: "WEB-1", self: "https://x/rest/api/3/issue/1" },
  };

  function createBody(f: ReturnType<typeof mockFetchByUrl>) {
    const call = f.mock.calls.find((c) => /\/rest\/api\/3\/issue$/.test(String(c[0])));
    return JSON.parse(String((call?.[1] as RequestInit).body));
  }

  // 기준선. 스프린트를 안 고른 제출은 도입 전과 바이트 단위로 같아야 하고 createmeta도 안 나간다.
  it("sprintId가 없으면 fetch 1회에 fields 키 집합이 그대로다", async () => {
    const f = mockFetchByUrl([CREATED]);

    await createIssue(OAUTH_AUTH, BASE);

    expect(f).toHaveBeenCalledTimes(1);
    expect(Object.keys(createBody(f).fields).sort()).toEqual([
      "description",
      "issuetype",
      "project",
      "summary",
    ]);
    expect(urls(f).some((u) => u.includes("createmeta"))).toBe(false);
  });

  it("meta가 배열 타입이면 스프린트 값을 배열로 싣는다", async () => {
    const f = mockFetchByUrl([
      { match: "/issue/createmeta/", body: CREATEMETA_FIXTURE },
      CREATED,
    ]);

    await createIssue(OAUTH_AUTH, { ...BASE, sprintId: 42 });

    expect(createBody(f).fields.customfield_10020).toEqual([42]);
  });

  it("meta가 스칼라 타입이면 스프린트 값을 그대로 싣는다", async () => {
    const f = mockFetchByUrl([
      {
        match: "/issue/createmeta/",
        body: {
          fields: [
            {
              fieldId: "customfield_10020",
              name: "Sprint",
              schema: { type: "any", custom: "com.pyxis.greenhopper.jira:gh-sprint" },
            },
          ],
        },
      },
      CREATED,
    ]);

    await createIssue(OAUTH_AUTH, { ...BASE, sprintId: 42 });

    expect(createBody(f).fields.customfield_10020).toBe(42);
  });

  // R7: 무음 누락이지만 제출 전체 실패보다는 낫다.
  it("meta가 null이면 스프린트 키 없이 생성한다", async () => {
    const f = mockFetchByUrl([
      { match: "/issue/createmeta/", body: { fields: [] } },
      CREATED,
    ]);

    await createIssue(OAUTH_AUTH, { ...BASE, sprintId: 42 });

    expect(Object.keys(createBody(f).fields).sort()).toEqual([
      "description",
      "issuetype",
      "project",
      "summary",
    ]);
  });

  // .catch(() => null)이 없으면 createmeta 429가 create 요청 자체를 막아 제출이 통째로 죽는다.
  it("meta 조회가 429여도 create 요청은 정상 발사된다", async () => {
    const f = mockFetchByUrl([
      { match: "/issue/createmeta/", status: 429, body: {} },
      CREATED,
    ]);

    await expect(
      createIssue(OAUTH_AUTH, { ...BASE, sprintId: 42 }),
    ).resolves.toMatchObject({ key: "WEB-1" });
    expect(createBody(f).fields).not.toHaveProperty("customfield_10020");
  });
});

// ── @/test/fetch-mock 구역 ────────────────────────────────────────────────────
// 이 파일엔 fetch 목이 둘이고 **실패 모드가 다르다**:
//   · 위쪽 로컬 mockFetchByUrl — 미매칭 URL을 404 응답으로 흘린다(라우트 누락이 "서버가 404를
//     줬다"로 위장된다).
//   · 아래 @/test/fetch-mock — 미매칭이면 throw한다(라우트 누락이 그 자리에서 터진다).
// 한 describe에서 섞으면 같은 실수가 두 모습으로 나오므로 구역을 나누고 각자 되돌린다.
// 그리고 mf.restore()는 vi.unstubAllGlobals()라 fetch만 되돌리지 않는다 — 위의
// "classic 경로 401 자동 갱신"처럼 chrome 스텁 + refreshOnce가 걸린 경로와 같은 it() 안에서
// 쓰면 그 스텁까지 날아간다. 아래 케이스는 전부 apiKey 인증이라 갱신 레인을 아예 안 탄다.

const API_KEY_AUTH = {
  kind: "apiKey",
  baseUrl: "https://x.atlassian.net",
  email: "u@x.com",
  apiToken: "tok",
} as const;

describe("jira REST 엔드포인트", () => {
  let mf: MockFetch | undefined;

  afterEach(() => {
    mf?.restore();
    mf = undefined;
  });

  const urlAt = (n = 0) => new URL(mf!.callAt(n).url);
  const headersAt = (n = 0) =>
    (mf!.callAt(n).init?.headers ?? {}) as Record<string, string>;

  describe("조회 — 경로·쿼리 파라미터·응답 봉투", () => {
    it("getMyself는 /rest/api/3/myself를 GET하고 응답을 그대로 돌려준다", async () => {
      mf = mockFetchOnce({ body: { accountId: "a1", displayName: "U" } });

      await expect(getMyself(API_KEY_AUTH)).resolves.toEqual({
        accountId: "a1",
        displayName: "U",
      });
      expect(urlAt().pathname).toBe("/rest/api/3/myself");
      expect(mf.callAt(0).init?.method).toBeUndefined();
    });

    it("searchProjects는 values 봉투를 벗기고 maxResults=50을 싣는다", async () => {
      mf = mockFetchOnce({
        body: { values: [{ id: "1", key: "WEB", name: "Web" }], total: 1, startAt: 0 },
      });

      await expect(searchProjects(API_KEY_AUTH)).resolves.toEqual([
        { id: "1", key: "WEB", name: "Web" },
      ]);
      const u = urlAt();
      expect(u.pathname).toBe("/rest/api/3/project/search");
      expect(u.searchParams.get("maxResults")).toBe("50");
      expect(u.searchParams.has("query")).toBe(false);
    });

    it("searchProjects는 query가 있을 때만 query 파라미터를 붙인다", async () => {
      mf = mockFetchOnce({ body: { values: [], total: 0, startAt: 0 } });

      await searchProjects(API_KEY_AUTH, "결제 팀");

      expect(urlAt().searchParams.get("query")).toBe("결제 팀");
    });

    // projectKey는 사용자 프로젝트 키라 슬래시·공백이 들어올 수 있다. 인코딩이 빠지면
    // 슬래시가 경로 구분자가 돼 전혀 다른 엔드포인트를 친다.
    it("getIssueTypes는 projectKey를 경로 조각으로 인코딩한다", async () => {
      mf = mockFetchOnce({ body: { issueTypes: [] } });

      await getIssueTypes(API_KEY_AUTH, "WEB SPACE/한");

      expect(mf.callAt(0).url).toContain(
        "/rest/api/3/issue/createmeta/WEB%20SPACE%2F%ED%95%9C/issuetypes",
      );
    });

    it("getIssueTypes는 subtask 이슈타입을 걸러낸다", async () => {
      mf = mockFetchOnce({
        body: {
          issueTypes: [
            { id: "10001", name: "Bug", subtask: false },
            { id: "10002", name: "Sub-task", subtask: true },
          ],
        },
      });

      await expect(getIssueTypes(API_KEY_AUTH, "WEB")).resolves.toEqual([
        { id: "10001", name: "Bug", subtask: false },
      ]);
    });

    it("getIssueTypes는 issueTypes 키가 없는 응답이면 빈 배열", async () => {
      mf = mockFetchOnce({ body: {} });

      await expect(getIssueTypes(API_KEY_AUTH, "WEB")).resolves.toEqual([]);
    });

    it("getPriorities는 배열 응답을 봉투 없이 그대로 돌려준다", async () => {
      mf = mockFetchOnce({ body: [{ id: "3", name: "Medium" }] });

      await expect(getPriorities(API_KEY_AUTH)).resolves.toEqual([
        { id: "3", name: "Medium" },
      ]);
      expect(urlAt().pathname).toBe("/rest/api/3/priority");
    });

    // query가 없을 때 파라미터 자체를 빼면 400이다 — 빈 문자열을 실어야 "전체 목록"이 온다.
    it("searchUsers는 query가 없어도 빈 query와 maxResults=50을 싣는다", async () => {
      mf = mockFetchOnce({ body: [] });

      await searchUsers(API_KEY_AUTH);

      const u = urlAt();
      expect(u.pathname).toBe("/rest/api/3/user/search");
      expect(u.searchParams.get("query")).toBe("");
      expect(u.searchParams.get("maxResults")).toBe("50");
    });

    it("searchUsers는 query를 그대로 싣는다", async () => {
      mf = mockFetchOnce({ body: [{ accountId: "a1" }] });

      await expect(searchUsers(API_KEY_AUTH, "김 개발")).resolves.toEqual([
        { accountId: "a1" },
      ]);
      expect(urlAt().searchParams.get("query")).toBe("김 개발");
    });

    it("getUsersByAccountIds는 accountId를 반복 파라미터로 싣고 maxResults를 개수에 맞춘다", async () => {
      mf = mockFetchOnce({ body: { values: [{ accountId: "a1" }] } });

      await expect(
        getUsersByAccountIds(API_KEY_AUTH, ["a1", "a:2"]),
      ).resolves.toEqual([{ accountId: "a1" }]);

      const u = urlAt();
      expect(u.pathname).toBe("/rest/api/3/user/bulk");
      expect(u.searchParams.getAll("accountId")).toEqual(["a1", "a:2"]);
      expect(u.searchParams.get("maxResults")).toBe("2");
    });

    it("getUsersByAccountIds는 200개를 넘으면 앞 200개만 조회한다", async () => {
      mf = mockFetchOnce({ body: { values: [] } });

      await getUsersByAccountIds(
        API_KEY_AUTH,
        Array.from({ length: 201 }, (_, i) => `a${i}`),
      );

      const ids = urlAt().searchParams.getAll("accountId");
      expect(ids).toHaveLength(200);
      expect(ids[199]).toBe("a199");
      expect(urlAt().searchParams.get("maxResults")).toBe("200");
    });

    it("getUsersByAccountIds는 빈 입력이면 요청을 아예 안 보낸다", async () => {
      mf = mockFetchOnce({ body: { values: [] } });

      await expect(getUsersByAccountIds(API_KEY_AUTH, [])).resolves.toEqual([]);
      expect(mf.fn).not.toHaveBeenCalled();
    });

    it("getUsersByAccountIds는 values 키가 없는 응답이면 빈 배열", async () => {
      mf = mockFetchOnce({ body: {} });

      await expect(getUsersByAccountIds(API_KEY_AUTH, ["a1"])).resolves.toEqual([]);
    });
  });

  describe("이슈 상태·트랜지션", () => {
    it("getIssueStatus는 fields를 좁혀 요청하고 중첩 봉투를 평탄화한다", async () => {
      mf = mockFetchOnce({
        body: {
          fields: {
            status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
            issuetype: { name: "Bug" },
            summary: "로그인 실패",
          },
        },
      });

      await expect(getIssueStatus(API_KEY_AUTH, "WEB-1")).resolves.toEqual({
        name: "In Progress",
        categoryKey: "indeterminate",
        issueTypeName: "Bug",
        summary: "로그인 실패",
      });

      const u = urlAt();
      expect(u.pathname).toBe("/rest/api/3/issue/WEB-1");
      expect(u.searchParams.get("fields")).toBe("status,issuetype,summary");
    });

    it("getTransitions는 transitions 봉투를 parseTransitions에 넘긴다", async () => {
      mf = mockFetchOnce({
        body: {
          transitions: [
            {
              id: "31",
              name: "Resolve",
              to: { name: "Done", statusCategory: { key: "done" } },
            },
          ],
        },
      });

      await expect(getTransitions(API_KEY_AUTH, "WEB-1")).resolves.toEqual([
        { id: "31", name: "Resolve", to: { name: "Done", categoryKey: "done" } },
      ]);
      expect(urlAt().pathname).toBe("/rest/api/3/issue/WEB-1/transitions");
    });

    it("transitionIssue는 transition.id를 POST하고 204를 undefined로 흘린다", async () => {
      mf = mockFetchOnce({ status: 204 });

      await expect(
        transitionIssue(API_KEY_AUTH, "WEB 1/2", "31"),
      ).resolves.toBeUndefined();

      expect(mf.callAt(0).url).toContain("/rest/api/3/issue/WEB%201%2F2/transitions");
      expect(mf.callAt(0).init?.method).toBe("POST");
      expect(mf.jsonBodyAt(0)).toEqual({ transition: { id: "31" } });
    });
  });

  describe("쓰기 — 본문 갱신·이슈 링크", () => {
    it("updateIssueDescription은 fields.description만 PUT한다", async () => {
      mf = mockFetchOnce({ status: 204 });

      await updateIssueDescription(API_KEY_AUTH, "WEB-1", ADF);

      expect(mf.callAt(0).init?.method).toBe("PUT");
      expect(urlAt().pathname).toBe("/rest/api/3/issue/WEB-1");
      // multipart가 아닌 분기의 Content-Type. 빠지면 Jira가 JSON 본문에 415를 준다
      // (아래 multipart 케이스는 반대로 "붙으면 안 된다"를 잰다).
      expect(headersAt()["Content-Type"]).toBe("application/json");
      expect(mf.jsonBodyAt(0)).toEqual({
        fields: { description: { type: "doc", version: 1, content: [] } },
      });
    });

    it("createIssueLink는 링크 타입 기본값 Relates로 inward·outward를 싣는다", async () => {
      mf = mockFetchOnce({ status: 201, body: {} });

      await createIssueLink(API_KEY_AUTH, "WEB-1", "WEB-2");

      expect(urlAt().pathname).toBe("/rest/api/3/issueLink");
      expect(headersAt()["Content-Type"]).toBe("application/json");
      expect(mf.jsonBodyAt(0)).toEqual({
        type: { name: "Relates" },
        inwardIssue: { key: "WEB-1" },
        outwardIssue: { key: "WEB-2" },
      });
    });

    it("createIssueLink는 링크 타입을 지정하면 그 값을 싣는다", async () => {
      mf = mockFetchOnce({ status: 201, body: {} });

      await createIssueLink(API_KEY_AUTH, "WEB-1", "WEB-2", "Blocks");

      expect(mf.jsonBodyAt(0)).toMatchObject({ type: { name: "Blocks" } });
    });
  });

  describe("multipart 업로드", () => {
    // XSRF 체크를 끄는 헤더다. 빠지면 서버가 조용히 403을 주고 첨부만 통째로 사라진다.
    it("jiraMultipart는 X-Atlassian-Token: no-check을 싣고 Content-Type을 직접 정하지 않는다", async () => {
      mf = mockFetchOnce({ body: [] });
      const form = new FormData();
      form.append("file", new Blob(["x"]), "a.txt");

      await jiraMultipart(API_KEY_AUTH, "/rest/api/3/issue/WEB-1/attachments", form);

      const h = headersAt();
      expect(h["X-Atlassian-Token"]).toBe("no-check");
      // 경계 문자열은 fetch가 붙인다 — 우리가 박으면 서버가 본문을 못 가른다.
      expect(h).not.toHaveProperty("Content-Type");
      expect(h.Accept).toBe("application/json");
      expect(h.Authorization).toBe(`Basic ${btoa("u@x.com:tok")}`);
      expect(mf.callAt(0).init?.method).toBe("POST");
    });

    it("uploadAttachment는 issueKey를 인코딩하고 file 파트에 파일명을 싣는다", async () => {
      mf = mockFetchOnce({ body: [{ id: "10000", filename: "shot.png" }] });

      await expect(
        uploadAttachment(
          API_KEY_AUTH,
          "WEB 1/2",
          "shot.png",
          new Blob(["png"], { type: "image/png" }),
        ),
      ).resolves.toEqual([{ id: "10000", filename: "shot.png" }]);

      expect(mf.callAt(0).url).toContain("/rest/api/3/issue/WEB%201%2F2/attachments");
      const file = mf.formDataAt(0).get("file") as File;
      expect(file.name).toBe("shot.png");
      expect(await file.text()).toBe("png");
    });

    it("jiraMultipart는 실패 상태를 JiraError로 올리고 본문 detail을 메시지에 붙인다", async () => {
      mf = mockFetchOnce({
        status: 413,
        body: { errorMessages: ["The file is too large"] },
      });

      const err = await uploadAttachment(
        API_KEY_AUTH,
        "WEB-1",
        "big.mp4",
        new Blob(["v"]),
      ).catch((e: unknown) => e as JiraError);

      expect(err).toBeInstanceOf(JiraError);
      expect((err as JiraError).status).toBe(413);
      expect((err as JiraError).message).toContain("jira.error.generic status=413");
      expect((err as JiraError).message).toContain("The file is too large");
    });

    it("jiraMultipart는 204면 undefined", async () => {
      mf = mockFetchOnce({ status: 204 });

      await expect(
        jiraMultipart(API_KEY_AUTH, "/rest/api/3/issue/WEB-1/attachments", new FormData()),
      ).resolves.toBeUndefined();
    });
  });

  describe("에러 전파", () => {
    it("403은 상태별 메시지로 바꿔 던지고 JSON이 아닌 본문은 원문 그대로 body에 담는다", async () => {
      mf = mockFetchOnce({ status: 403, body: "<html>403</html>" });

      const err = await getPriorities(API_KEY_AUTH).catch((e: unknown) => e as JiraError);

      expect(err).toBeInstanceOf(JiraError);
      expect((err as JiraError).status).toBe(403);
      expect((err as JiraError).message).toBe("jira.error.403");
      expect((err as JiraError).body).toBe("<html>403</html>");
    });

    it("본문 읽기 자체가 실패해도 상태 메시지는 살아남는다", async () => {
      mf = mockFetchOnce({ status: 500, body: new Error("stream closed") });

      const err = await getMyself(API_KEY_AUTH).catch((e: unknown) => e as JiraError);

      expect((err as JiraError).status).toBe(500);
      expect((err as JiraError).message).toBe("jira.error.5xx");
      expect((err as JiraError).body).toBeUndefined();
    });
  });

  // JQL은 서버가 파싱하는 문자열이라 조립이 곧 계약이다 — 이스케이프가 빠지면 사용자가 친
  // 따옴표·대괄호가 구문 오류(400)를 내고 에픽 콤보가 통째로 빈다.
  describe("searchEpics — JQL 조립", () => {
    const jqlOf = () => urlAt().searchParams.get("jql");

    it("query가 없으면 프로젝트 조건 + 정렬만 싣고 조회 파라미터를 고정한다", async () => {
      mf = mockFetchOnce({ body: { issues: [{ id: "1", key: "WEB-1" }], total: 1 } });

      await expect(searchEpics(API_KEY_AUTH, "WEB")).resolves.toEqual([
        { id: "1", key: "WEB-1" },
      ]);

      const u = urlAt();
      expect(u.pathname).toBe("/rest/api/3/search/jql");
      expect(u.searchParams.get("jql")).toBe(
        "project = 'WEB' ORDER BY updated DESC",
      );
      expect(u.searchParams.get("maxResults")).toBe("30");
      expect(u.searchParams.get("fields")).toBe("summary,issuetype");
    });

    it("hierarchyLevels를 주면 in 절로 묶는다", async () => {
      mf = mockFetchOnce({ body: { issues: [], total: 0 } });

      await searchEpics(API_KEY_AUTH, "WEB", undefined, [1, 2]);

      expect(jqlOf()).toBe(
        "project = 'WEB' AND hierarchyLevel in (1, 2) ORDER BY updated DESC",
      );
    });

    it("숫자만 입력하면 프로젝트 키를 붙여 key 조건을 만든다", async () => {
      mf = mockFetchOnce({ body: { issues: [], total: 0 } });

      await searchEpics(API_KEY_AUTH, "WEB", "123");

      expect(jqlOf()).toBe(
        "project = 'WEB' AND (key = 'WEB-123' OR summary ~ '123') ORDER BY updated DESC",
      );
    });

    it("소문자 이슈 키를 입력하면 key 쪽만 대문자로 올린다", async () => {
      mf = mockFetchOnce({ body: { issues: [], total: 0 } });

      await searchEpics(API_KEY_AUTH, "WEB", "web-12");

      expect(jqlOf()).toBe(
        "project = 'WEB' AND (key = 'WEB\\-12' OR summary ~ 'web\\-12') ORDER BY updated DESC",
      );
    });

    it("키 형태가 아니면 summary 부분일치로 가고 따옴표·특수문자를 이스케이프한다", async () => {
      mf = mockFetchOnce({ body: { issues: [], total: 0 } });

      await searchEpics(API_KEY_AUTH, "IT'S", "it's [big]");

      expect(jqlOf()).toBe(
        "project = 'IT''S' AND summary ~ 'it''s \\[big\\]' ORDER BY updated DESC",
      );
    });
  });
});
