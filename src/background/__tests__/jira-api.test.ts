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
  getSprint,
  getSprintFieldMeta,
  listSprints,
  messageForJiraStatus,
  parseTransitions,
  extractJiraDetail,
  jiraFetch,
} from "../jira-api";
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
