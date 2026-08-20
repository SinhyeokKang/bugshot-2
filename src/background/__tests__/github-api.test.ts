import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buildAuthHeader,
  createIssue,
  extractGithubDetail,
  getIssueStatus,
  getMyself,
  getRepoAssignees,
  getRepoLabels,
  githubFetch,
  GithubError,
  mapCreateIssueBody,
  messageForGithubStatus,
  normalizeIssueStatus,
  normalizeRepo,
  searchRepos,
  updateIssueState,
} from "../github-api";
import { mockFetchOnce, type MockFetch } from "@/test/fetch-mock";
import type { GithubAuth } from "@/types/github";

// params를 키가 아니라 출력에 그대로 노출한다 — `*.error.generic` 사전 *값*에는 {status}
// placeholder가 있지만 *키*에는 없다. 키 문자열에서 placeholder를 찾는 목이면 t()의 두 번째
// 인자를 통째로 지워도 출력이 그대로라 원리적으로 관측 불가능하다(clickup 목과 같은 형태).
vi.mock("@/i18n", () => ({
  t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k),
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
    // 목이 params를 출력에 노출하므로 t()의 두 번째 인자까지 여기서 잠긴다.
    expect(messageForGithubStatus(418)).toBe('github.error.generic:{"status":418}');
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

// ─────────────────────────────────────────────────────────────────────────────
// 이 파일엔 fetch 목이 둘이고 실패 모드가 다르다.
//  - 위 `getMyself — email fallback`: `globalThis.fetch` 직접 대입 + 큐. 응답이 고갈되면
//    `queue.shift()!`가 undefined를 타 TypeError로 죽는다(라우팅 없음).
//  - 아래 신규 블록: `@/test/fetch-mock`. `vi.stubGlobal`이라 `restore()`가
//    `vi.unstubAllGlobals()`다 — "stub 시점의 globalThis.fetch"로 되돌린다.
// 그래서 둘을 한 `it()`이나 한 `describe`에서 섞으면 안 된다. 위 블록이 자기 목을
// 깔아둔 채로 아래 목을 stub하면 unstubAllGlobals가 복원하는 건 진짜 fetch가 아니라
// 위 블록의 목이고, 그 뒤 파일들이 유령 목을 물려받는다. 분리 장치는 describe별 afterEach다.
// ─────────────────────────────────────────────────────────────────────────────
describe("REST 래퍼 (fetch-mock)", () => {
  const auth: GithubAuth = { kind: "pat", pat: "ghp_x", viewerLogin: "u" };
  let mf: MockFetch | undefined;

  afterEach(() => {
    mf?.restore();
    mf = undefined;
  });

  // `new URL()`은 pathname의 공백을 %20으로 정규화해 인코딩 누락을 가린다
  // (`/repos/my org/…`가 파싱 후엔 `/repos/my%20org/…`로 보인다). 원문으로도 본다.
  const rawUrlAt = (n: number) => mf!.callAt(n).url;

  const rawRepo = (over: Record<string, unknown> = {}) => ({
    id: 7,
    node_id: "R_7",
    name: "repo",
    full_name: "owner/repo",
    owner: { login: "owner" },
    private: false,
    description: "d",
    html_url: "https://github.com/owner/repo",
    ...over,
  });

  // buildAuthHeader 유닛(위)은 순수 함수만 본다 — doFetch가 그 결과를 실제로 싣는지는
  // 와이어에서만 관측된다. 헤더 4종을 통째로 지워도 나머지 케이스는 전부 green이다.
  describe("공통 요청 헤더·캐시 모드", () => {
    it("PAT auth는 buildAuthHeader 결과를 Authorization에 싣고 GitHub 고정 헤더를 붙인다", async () => {
      mf = mockFetchOnce({ body: [] });

      await getRepoLabels(auth, "o", "r");

      const call = mf.callAt(0);
      const h = call.init?.headers as Record<string, string>;
      expect(h.Authorization).toBe("token ghp_x");
      expect(h.Accept).toBe("application/vnd.github+json");
      expect(h["X-GitHub-Api-Version"]).toBe("2022-11-28");
      expect(h["User-Agent"]).toBe("bugshot-2");
    });

    it("OAuth auth는 Bearer <accessToken>으로 나간다 (PAT 형식 하드코딩 금지)", async () => {
      mf = mockFetchOnce({ body: [] });

      await getRepoLabels(
        {
          kind: "oauth",
          accessToken: "ATK",
          tokenType: "bearer",
          scope: "repo",
          viewerLogin: "u",
          grantedAt: 1,
        },
        "o",
        "r",
      );

      expect((mf.callAt(0).init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer ATK",
      );
    });

    // GitHub는 짧은 max-age 응답을 주는 엔드포인트가 있어 default 캐시 모드면 stale을 읽는다.
    it("모든 요청은 cache: no-cache로 나간다", async () => {
      mf = mockFetchOnce({ body: [] });

      await getRepoLabels(auth, "o", "r");

      expect(mf.callAt(0).init?.cache).toBe("no-cache");
    });
  });

  describe("searchRepos", () => {
    it("빈 쿼리는 /user/repos를 per_page=30·sort=pushed로 부르고 배열을 그대로 매핑", async () => {
      mf = mockFetchOnce({ body: [rawRepo()] });

      const out = await searchRepos(auth, "   ");

      const u = new URL(mf.callAt(0).url);
      expect(u.origin).toBe("https://api.github.com");
      expect(u.pathname).toBe("/user/repos");
      expect(u.searchParams.get("per_page")).toBe("30");
      expect(u.searchParams.get("sort")).toBe("pushed");
      expect(out).toEqual([
        {
          id: 7,
          nodeId: "R_7",
          name: "repo",
          fullName: "owner/repo",
          owner: "owner",
          private: false,
          description: "d",
          htmlUrl: "https://github.com/owner/repo",
        },
      ]);
    });

    it("검색 쿼리는 /search/repositories를 q='<쿼리> in:name'·per_page=30·sort=updated로 부르고 items 봉투를 벗김", async () => {
      mf = mockFetchOnce({ body: { items: [rawRepo({ id: 9, node_id: "R_9" })] } });

      const out = await searchRepos(auth, "  design  ");

      const u = new URL(mf.callAt(0).url);
      expect(u.pathname).toBe("/search/repositories");
      expect(u.searchParams.get("q")).toBe("design in:name");
      expect(u.searchParams.get("per_page")).toBe("30");
      expect(u.searchParams.get("sort")).toBe("updated");
      expect(out.map((r) => r.id)).toEqual([9]);
    });

    it("쿼리의 예약문자는 퍼센트 인코딩되어 나간다", async () => {
      mf = mockFetchOnce({ body: { items: [] } });

      await searchRepos(auth, "a&b c/d");

      const url = mf.callAt(0).url;
      expect(url).toContain("q=a%26b+c%2Fd+in%3Aname");
      expect(url).not.toContain("a&b c/d");
      expect(new URL(url).searchParams.get("q")).toBe("a&b c/d in:name");
    });
  });

  describe("getRepoLabels", () => {
    it("owner·repo를 경로에 인코딩하고 per_page=100으로 부른다", async () => {
      mf = mockFetchOnce({ body: [] });

      await getRepoLabels(auth, "my org", "re/po");

      const u = new URL(mf.callAt(0).url);
      expect(u.pathname).toBe("/repos/my%20org/re%2Fpo/labels");
      expect(u.searchParams.get("per_page")).toBe("100");
      expect(rawUrlAt(0)).not.toContain("my org");
      expect(rawUrlAt(0)).not.toContain("re/po");
    });

    it("description null은 undefined로 접힌다", async () => {
      mf = mockFetchOnce({
        body: [
          { id: 1, name: "bug", color: "d73a4a", description: "버그" },
          { id: 2, name: "ui", color: "ffffff", description: null },
        ],
      });

      const out = await getRepoLabels(auth, "o", "r");

      expect(out).toEqual([
        { id: 1, name: "bug", color: "d73a4a", description: "버그" },
        { id: 2, name: "ui", color: "ffffff", description: undefined },
      ]);
    });
  });

  describe("getRepoAssignees", () => {
    it("assignees 경로를 per_page=100으로 부르고 avatar_url을 avatarUrl로 매핑", async () => {
      mf = mockFetchOnce({
        body: [
          { id: 11, login: "alice", avatar_url: "https://a/x.png" },
          { id: 12, login: "bob" },
        ],
      });

      const out = await getRepoAssignees(auth, "my org", "r");

      const u = new URL(mf.callAt(0).url);
      expect(u.pathname).toBe("/repos/my%20org/r/assignees");
      expect(u.searchParams.get("per_page")).toBe("100");
      expect(rawUrlAt(0)).not.toContain("my org");
      expect(out).toEqual([
        { id: 11, login: "alice", avatarUrl: "https://a/x.png" },
        { id: 12, login: "bob", avatarUrl: undefined },
      ]);
    });
  });

  describe("getIssueStatus", () => {
    it("이슈 번호 경로를 GET으로 부르고 normalizeIssueStatus 결과를 돌려준다", async () => {
      mf = mockFetchOnce({
        body: {
          number: 42,
          title: "T",
          state: "closed",
          state_reason: "not_planned",
          html_url: "https://github.com/o/r/issues/42",
          labels: ["bug", { name: "ui", color: "ffffff" }],
        },
      });

      const out = await getIssueStatus(auth, "my org", "r", 42);

      const call = mf.callAt(0);
      expect(new URL(call.url).pathname).toBe("/repos/my%20org/r/issues/42");
      expect(rawUrlAt(0)).not.toContain("my org");
      expect(call.init?.method).toBeUndefined();
      // body 없는 요청엔 Content-Type을 붙이지 않는다.
      expect((call.init?.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
      expect(out).toEqual({
        number: 42,
        title: "T",
        state: "closed",
        stateReason: "not_planned",
        htmlUrl: "https://github.com/o/r/issues/42",
        labels: [
          { name: "bug", color: "" },
          { name: "ui", color: "ffffff" },
        ],
      });
    });
  });

  describe("updateIssueState", () => {
    const closedRaw = {
      number: 1,
      title: "T",
      state: "closed",
      state_reason: "completed",
      html_url: "u",
      labels: [],
    };

    it("closed + stateReason은 state_reason을 함께 PATCH한다", async () => {
      mf = mockFetchOnce({ body: closedRaw });

      const out = await updateIssueState(auth, "o", "r", 5, "closed", "not_planned");

      const call = mf.callAt(0);
      expect(new URL(call.url).pathname).toBe("/repos/o/r/issues/5");
      expect(call.init?.method).toBe("PATCH");
      expect(mf.jsonBodyAt(0)).toEqual({ state: "closed", state_reason: "not_planned" });
      expect(out.stateReason).toBe("completed");
    });

    it("closed인데 stateReason이 없으면 state_reason 키 자체를 안 싣는다", async () => {
      mf = mockFetchOnce({ body: closedRaw });

      await updateIssueState(auth, "o", "r", 5, "closed");

      expect(mf.jsonBodyAt(0)).toEqual({ state: "closed" });
    });

    it("open은 state_reason을 reopened로 강제한다", async () => {
      mf = mockFetchOnce({ body: { ...closedRaw, state: "open", state_reason: "reopened" } });

      await updateIssueState(auth, "o", "r", 5, "open", "completed");

      expect(mf.jsonBodyAt(0)).toEqual({ state: "open", state_reason: "reopened" });
    });
  });

  describe("createIssue", () => {
    it("mapCreateIssueBody 출력을 그대로 POST하고 응답 봉투를 벗긴다", async () => {
      mf = mockFetchOnce({
        body: { number: 101, html_url: "https://github.com/my%20org/r/issues/101", node_id: "I_101" },
      });

      const out = await createIssue(auth, {
        owner: "my org",
        repo: "re/po",
        title: "T",
        body: "B",
        labels: ["bug"],
        assignees: [],
      });

      const call = mf.callAt(0);
      expect(new URL(call.url).pathname).toBe("/repos/my%20org/re%2Fpo/issues");
      expect(rawUrlAt(0)).not.toContain("my org");
      expect(rawUrlAt(0)).not.toContain("re/po");
      expect(call.init?.method).toBe("POST");
      expect((call.init?.headers as Record<string, string>)["Content-Type"]).toBe(
        "application/json",
      );
      // 빈 assignees는 매퍼가 떨어뜨린다 — 그 출력이 그대로 실려야 한다.
      expect(mf.jsonBodyAt(0)).toEqual({ title: "T", body: "B", labels: ["bug"] });
      expect(out).toEqual({
        number: 101,
        url: "https://github.com/my%20org/r/issues/101",
        nodeId: "I_101",
      });
    });
  });

  describe("에러 전파", () => {
    it("422 JSON 본문은 GithubError의 status·body에 실리고 detail이 메시지에 붙는다", async () => {
      mf = mockFetchOnce({
        status: 422,
        body: { message: "Validation Failed", errors: [{ message: "title is required" }] },
      });

      const err = await createIssue(auth, { owner: "o", repo: "r", title: "T", body: "B" }).catch(
        (e: unknown) => e,
      );

      expect(err).toBeInstanceOf(GithubError);
      const ge = err as InstanceType<typeof GithubError>;
      expect(ge.status).toBe(422);
      expect(ge.message).toBe("github.error.422\nValidation Failed\ntitle is required");
      expect(ge.body).toEqual({
        message: "Validation Failed",
        errors: [{ message: "title is required" }],
      });
    });

    it("JSON이 아닌 에러 본문은 원문 문자열로 보존되고 detail은 비어 있다", async () => {
      mf = mockFetchOnce({ status: 500, body: "<html>Server Error</html>" });

      const err = await getRepoLabels(auth, "o", "r").catch((e: unknown) => e);

      const ge = err as InstanceType<typeof GithubError>;
      expect(ge.status).toBe(500);
      expect(ge.body).toBe("<html>Server Error</html>");
      expect(ge.message).toBe("github.error.5xx");
    });

    it("본문 읽기 자체가 실패하면 body는 undefined", async () => {
      mf = mockFetchOnce({ status: 403, body: new Error("stream closed") });

      const err = await getRepoAssignees(auth, "o", "r").catch((e: unknown) => e);

      const ge = err as InstanceType<typeof GithubError>;
      expect(ge.status).toBe(403);
      expect(ge.body).toBeUndefined();
      expect(ge.message).toBe("github.error.403");
    });

    it("204는 본문 파싱 없이 undefined를 돌려준다", async () => {
      mf = mockFetchOnce({ status: 204, body: new Error("json() 호출 금지") });

      await expect(githubFetch(auth, "/repos/o/r/issues/1", { method: "DELETE" })).resolves
        .toBeUndefined();
    });
  });
});
