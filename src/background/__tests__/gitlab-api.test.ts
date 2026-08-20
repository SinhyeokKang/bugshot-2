import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthHeader,
  createIssue,
  extractGitlabDetail,
  getIssueStatus,
  getMyself,
  getProjectLabels,
  getProjectMembers,
  GitlabError,
  mapCreateIssueBody,
  messageForGitlabStatus,
  normalizeIssueStatus,
  normalizeProject,
  searchProjects,
  updateIssueDescription,
  updateIssueState,
  uploadFile,
  gitlabFetch,
} from "../gitlab-api";
import { mockFetchOnce, type MockFetch } from "@/test/fetch-mock";

// params를 키가 아니라 출력에 그대로 노출한다 — `*.error.generic` 사전 *값*에는 {status}
// placeholder가 있지만 *키*에는 없다. 키 문자열에서 placeholder를 찾는 목이면 t()의 두 번째
// 인자를 통째로 지워도 출력이 그대로라 원리적으로 관측 불가능하다(clickup 목과 같은 형태).
vi.mock("@/i18n", () => ({
  t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k),
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
    // 목이 params를 출력에 노출하므로 t()의 두 번째 인자까지 여기서 잠긴다.
    expect(messageForGitlabStatus(418)).toBe('gitlab.error.generic:{"status":418}');
  });
});

describe("gitlabFetch egress 자격증명 게이트", () => {
  const pat = {
    kind: "pat",
    pat: "glpat_xyz",
    viewerUsername: "u",
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

  it("평문 http 인스턴스는 fetch 전에 끊는다", async () => {
    const f = mockFetch();
    await expect(
      gitlabFetch({ ...pat, baseUrl: "http://gitlab.corp" }, "/user"),
    ).rejects.toThrow("gitlab.instanceUrl.insecure");
    expect(f).not.toHaveBeenCalled();
  });

  // 사이드패널 폼(normalizeInstanceUrl)을 우회하는 경로도 이 관문을 지난다.
  it("폼을 우회해 들어온 baseUrl도 같은 게이트에 걸린다", async () => {
    const f = mockFetch();
    await expect(
      gitlabFetch({ ...pat, baseUrl: "http://evil.example" }, "/user"),
    ).rejects.toThrow("gitlab.instanceUrl.insecure");
    expect(f).not.toHaveBeenCalled();
  });

  it("loopback http는 통과한다(로컬 인스턴스)", async () => {
    const f = mockFetch();
    await gitlabFetch({ ...pat, baseUrl: "http://localhost:8929" }, "/user");
    expect(f.mock.calls[0][0]).toBe("http://localhost:8929/api/v4/user");
  });

  it("https는 종전대로 통과한다", async () => {
    const f = mockFetch();
    await gitlabFetch({ ...pat, baseUrl: "https://gitlab.com" }, "/user");
    expect(f.mock.calls[0][0]).toBe("https://gitlab.com/api/v4/user");
  });

  // 업로드 URL 같은 절대 경로는 baseUrl을 안 쓰므로 게이트 밖이다.
  it("절대 URL 경로는 게이트를 거치지 않는다", async () => {
    const f = mockFetch();
    await gitlabFetch(
      { ...pat, baseUrl: "http://gitlab.corp" },
      "https://cdn.example/uploads/x",
    );
    expect(f.mock.calls[0][0]).toBe("https://cdn.example/uploads/x");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 아래 describe들은 신규 공용 목(`@/test/fetch-mock`)을 쓴다. 위 egress describe의
// 로컬 mockFetch와 실패 모드가 다르다 — 로컬 목은 어떤 URL이 와도 무음 200이고,
// 공용 목의 mockFetchRoutes는 미매칭 URL에서 throw한다.
// ─────────────────────────────────────────────────────────────────────────────

describe("gitlab REST 어댑터", () => {
  const auth = {
    kind: "pat",
    pat: "glpat_xyz",
    baseUrl: "https://gl.example.com",
    viewerUsername: "u",
  } as const;

  let mf: MockFetch | undefined;

  afterEach(() => {
    mf?.restore();
    mf = undefined;
  });

  describe("경로 결합 (baseUrl 말미 슬래시)", () => {
    it("슬래시 없는 baseUrl — `<base>/api/v4<path>`", async () => {
      mf = mockFetchOnce({ body: { id: 1, username: "u", name: "N" } });
      await getMyself(auth);
      expect(mf!.callAt(0).url).toBe("https://gl.example.com/api/v4/user");
    });

    // 현행 동작 고정: gitlabFetch는 baseUrl을 정규화하지 않아 슬래시가 겹친다.
    // 폼(normalizeInstanceUrl)이 앞단에서 벗기지만 저장된 auth를 직접 쓰는 경로는 여기를 지난다.
    // 정규화를 넣을 거면 이 기대값을 함께 고쳐야 한다.
    it("말미 슬래시가 붙은 baseUrl은 슬래시가 겹친 채 나간다", async () => {
      mf = mockFetchOnce({ body: { id: 1, username: "u", name: "N" } });
      await getMyself({ ...auth, baseUrl: "https://gl.example.com/" });
      expect(mf!.callAt(0).url).toBe("https://gl.example.com//api/v4/user");
    });

    it("project id는 경로 세그먼트로 결합된다 — /projects/<id>/labels", async () => {
      mf = mockFetchOnce({ body: [] });
      await getProjectLabels(auth, 42);
      const url = new URL(mf!.callAt(0).url);
      expect(url.pathname).toBe("/api/v4/projects/42/labels");
      expect(url.searchParams.get("per_page")).toBe("100");
    });

    it("멤버는 상속 멤버 포함 경로(/members/all)를 쓴다", async () => {
      mf = mockFetchOnce({ body: [] });
      await getProjectMembers(auth, 42);
      const url = new URL(mf!.callAt(0).url);
      expect(url.pathname).toBe("/api/v4/projects/42/members/all");
      expect(url.searchParams.get("per_page")).toBe("100");
    });

    it("이슈 경로는 project id와 iid 순서로 결합된다", async () => {
      mf = mockFetchOnce({
        body: { iid: 12, title: "T", state: "opened", web_url: "https://u" },
      });
      await getIssueStatus(auth, 7, 12);
      expect(new URL(mf!.callAt(0).url).pathname).toBe(
        "/api/v4/projects/7/issues/12",
      );
    });
  });

  describe("searchProjects — 쿼리 인코딩·필수 파라미터", () => {
    it("검색어의 `+`·`/`·`&`·비ASCII가 퍼센트 인코딩된다", async () => {
      mf = mockFetchOnce({ body: [] });
      await searchProjects(auth, "c++ ui/ux & 조회");
      const url = mf!.callAt(0).url;
      // 인코딩이 빠지면 `/`가 경로 세그먼트로, `&`가 파라미터 구분자로 샌다.
      expect(url).toContain("search=c%2B%2B+ui%2Fux+%26+%EC%A1%B0%ED%9A%8C");
      expect(new URL(url).searchParams.get("search")).toBe("c++ ui/ux & 조회");
    });

    it("membership/order_by/per_page/min_access_level 4개를 항상 싣는다", async () => {
      mf = mockFetchOnce({ body: [] });
      await searchProjects(auth, "x");
      const p = new URL(mf!.callAt(0).url).searchParams;
      expect(p.get("membership")).toBe("true");
      expect(p.get("order_by")).toBe("last_activity_at");
      expect(p.get("per_page")).toBe("30");
      expect(p.get("min_access_level")).toBe("20");
    });

    it("공백뿐인 검색어는 search 파라미터 자체를 생략한다", async () => {
      mf = mockFetchOnce({ body: [] });
      await searchProjects(auth, "   ");
      const url = new URL(mf!.callAt(0).url);
      expect(url.searchParams.has("search")).toBe(false);
      expect(url.searchParams.get("membership")).toBe("true");
    });

    it("응답 배열을 normalizeProject로 매핑한다", async () => {
      mf = mockFetchOnce({
        body: [
          {
            id: 42,
            name: "repo",
            path_with_namespace: "group/repo",
            name_with_namespace: "Group / repo",
            web_url: "https://gl.example.com/group/repo",
          },
        ],
      });
      await expect(searchProjects(auth, "repo")).resolves.toEqual([
        {
          id: 42,
          pathWithNamespace: "group/repo",
          name: "repo",
          nameWithNamespace: "Group / repo",
          webUrl: "https://gl.example.com/group/repo",
        },
      ]);
    });
  });

  describe("응답 봉투 매핑", () => {
    it("getMyself — null 필드는 undefined로 접힌다", async () => {
      mf = mockFetchOnce({
        body: {
          id: 3,
          username: "kim",
          name: "Kim",
          email: null,
          avatar_url: null,
        },
      });
      await expect(getMyself(auth)).resolves.toEqual({
        id: 3,
        username: "kim",
        name: "Kim",
        email: undefined,
        avatarUrl: undefined,
      });
    });

    it("getProjectLabels — description null은 undefined", async () => {
      mf = mockFetchOnce({
        body: [
          { id: 1, name: "bug", color: "#d9534f", description: "버그" },
          { id: 2, name: "ui", color: "#428bca", description: null },
        ],
      });
      await expect(getProjectLabels(auth, 42)).resolves.toEqual([
        { id: 1, name: "bug", color: "#d9534f", description: "버그" },
        { id: 2, name: "ui", color: "#428bca", description: undefined },
      ]);
    });

    it("getProjectMembers — avatar_url null은 undefined", async () => {
      mf = mockFetchOnce({
        body: [
          { id: 5, username: "kim", name: "Kim", avatar_url: "https://a/1.png" },
          { id: 6, username: "lee", name: "Lee", avatar_url: null },
        ],
      });
      await expect(getProjectMembers(auth, 42)).resolves.toEqual([
        { id: 5, username: "kim", name: "Kim", avatarUrl: "https://a/1.png" },
        { id: 6, username: "lee", name: "Lee", avatarUrl: undefined },
      ]);
    });

    it("getIssueStatus — web_url→webUrl, labels 누락은 빈 배열", async () => {
      mf = mockFetchOnce({
        body: {
          iid: 12,
          title: "T",
          state: "closed",
          web_url: "https://gl.example.com/g/r/-/issues/12",
        },
      });
      await expect(getIssueStatus(auth, 7, 12)).resolves.toEqual({
        iid: 12,
        title: "T",
        state: "closed",
        webUrl: "https://gl.example.com/g/r/-/issues/12",
        labels: [],
      });
    });
  });

  describe("createIssue", () => {
    it("POST + mapCreateIssueBody 출력을 그대로 싣는다", async () => {
      mf = mockFetchOnce({
        body: {
          iid: 12,
          id: 900,
          web_url: "https://gl.example.com/g/r/-/issues/12",
        },
      });
      const out = await createIssue(auth, {
        projectId: 7,
        title: "T",
        description: "D",
        labels: ["bug", "ui"],
        assigneeIds: [9],
      });
      const { url, init } = mf!.callAt(0);
      expect(new URL(url).pathname).toBe("/api/v4/projects/7/issues");
      expect(init?.method).toBe("POST");
      expect(mf!.jsonBodyAt(0)).toEqual({
        title: "T",
        description: "D",
        labels: "bug,ui",
        assignee_ids: [9],
      });
      expect(out).toEqual({
        iid: 12,
        id: 900,
        url: "https://gl.example.com/g/r/-/issues/12",
      });
    });

    it("JSON body에는 Content-Type과 Authorization이 붙는다", async () => {
      mf = mockFetchOnce({ body: { iid: 1, id: 2, web_url: "u" } });
      await createIssue(auth, { projectId: 7, title: "T", description: "D" });
      const headers = mf!.callAt(0).init?.headers as Record<string, string>;
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers.Accept).toBe("application/json");
      expect(headers.Authorization).toBe("Bearer glpat_xyz");
    });
  });

  describe("uploadFile", () => {
    it("multipart `file` 필드에 파일명을 실어 /uploads로 POST한다", async () => {
      mf = mockFetchOnce({ body: { url: "/uploads/abc/before.png" } });
      const out = await uploadFile(
        auth,
        7,
        "before.png",
        new Blob(["x"], { type: "image/png" }),
      );
      expect(new URL(mf!.callAt(0).url).pathname).toBe(
        "/api/v4/projects/7/uploads",
      );
      expect(mf!.callAt(0).init?.method).toBe("POST");
      const file = mf!.formDataAt(0).get("file") as File;
      expect(file.name).toBe("before.png");
      expect(file.type).toBe("image/png");
      expect(out).toEqual({ url: "/uploads/abc/before.png" });
    });

    // FormData는 boundary를 브라우저가 붙여야 해서 Content-Type을 직접 세팅하면 안 된다.
    it("FormData body에는 Content-Type을 붙이지 않는다", async () => {
      mf = mockFetchOnce({ body: { url: "/uploads/abc/x.png" } });
      await uploadFile(auth, 7, "x.png", new Blob(["x"]));
      const headers = mf!.callAt(0).init?.headers as Record<string, string>;
      expect(headers["Content-Type"]).toBeUndefined();
      expect(headers.Authorization).toBe("Bearer glpat_xyz");
    });
  });

  describe("이슈 갱신", () => {
    it("updateIssueDescription — PUT + description만, 204는 undefined", async () => {
      mf = mockFetchOnce({ status: 204 });
      await expect(
        updateIssueDescription(auth, 7, 12, "새 본문"),
      ).resolves.toBeUndefined();
      expect(new URL(mf!.callAt(0).url).pathname).toBe(
        "/api/v4/projects/7/issues/12",
      );
      expect(mf!.callAt(0).init?.method).toBe("PUT");
      expect(mf!.jsonBodyAt(0)).toEqual({ description: "새 본문" });
    });

    it("updateIssueState — closed는 state_event 'close'", async () => {
      mf = mockFetchOnce({
        body: {
          iid: 12,
          title: "T",
          state: "closed",
          web_url: "https://u",
          labels: ["bug"],
        },
      });
      const out = await updateIssueState(auth, 7, 12, "closed");
      expect(mf!.callAt(0).init?.method).toBe("PUT");
      expect(mf!.jsonBodyAt(0)).toEqual({ state_event: "close" });
      expect(out).toEqual({
        iid: 12,
        title: "T",
        state: "closed",
        webUrl: "https://u",
        labels: ["bug"],
      });
    });

    it("updateIssueState — opened는 state_event 'reopen'", async () => {
      mf = mockFetchOnce({
        body: { iid: 12, title: "T", state: "opened", web_url: "https://u" },
      });
      const out = await updateIssueState(auth, 7, 12, "opened");
      expect(mf!.jsonBodyAt(0)).toEqual({ state_event: "reopen" });
      expect(out.state).toBe("opened");
    });
  });

  describe("에러 전파", () => {
    it("404 + JSON 본문 — status와 서버 message가 메시지에 실린다", async () => {
      mf = mockFetchOnce({ status: 404, body: { message: "404 Project Not Found" } });
      const err = await getProjectLabels(auth, 42).catch((e) => e);
      expect(err).toBeInstanceOf(GitlabError);
      expect(err.status).toBe(404);
      expect(err.message).toBe("gitlab.error.404\n404 Project Not Found");
      expect(err.body).toEqual({ message: "404 Project Not Found" });
    });

    it("422 검증 실패 — message 객체의 필드별 배열이 줄바꿈으로 펼쳐진다", async () => {
      mf = mockFetchOnce({
        status: 422,
        body: { message: { title: ["can't be blank"], base: "invalid" } },
      });
      const err = await createIssue(auth, {
        projectId: 7,
        title: "",
        description: "D",
      }).catch((e) => e);
      expect(err.status).toBe(422);
      expect(err.message).toBe("gitlab.error.422\ncan't be blank\ninvalid");
    });

    it("5xx + 비JSON 본문 — 원문이 body에 남고 detail은 붙지 않는다", async () => {
      mf = mockFetchOnce({ status: 502, body: "<html>bad gateway</html>" });
      const err = await getMyself(auth).catch((e) => e);
      expect(err.status).toBe(502);
      expect(err.message).toBe("gitlab.error.5xx");
      expect(err.body).toBe("<html>bad gateway</html>");
    });

    it("본문 읽기 자체가 실패해도 상태 메시지는 전파된다", async () => {
      mf = mockFetchOnce({ status: 500, body: new Error("stream closed") });
      const err = await getMyself(auth).catch((e) => e);
      expect(err.status).toBe(500);
      expect(err.message).toBe("gitlab.error.5xx");
      expect(err.body).toBeUndefined();
    });

    it("업로드 실패는 uploadFile에서도 같은 에러 타입으로 나온다", async () => {
      mf = mockFetchOnce({ status: 413, body: { error: "file too large" } });
      const err = await uploadFile(auth, 7, "big.png", new Blob(["x"])).catch(
        (e) => e,
      );
      expect(err).toBeInstanceOf(GitlabError);
      expect(err.status).toBe(413);
      expect(err.message).toBe(
        'gitlab.error.generic:{"status":413}\nfile too large',
      );
    });
  });
});

describe("extractGitlabDetail", () => {
  it("객체가 아니면 빈 문자열", () => {
    expect(extractGitlabDetail(undefined)).toBe("");
    expect(extractGitlabDetail(null)).toBe("");
    expect(extractGitlabDetail("<html>500</html>")).toBe("");
  });

  it("message 문자열은 그대로 한 줄", () => {
    expect(extractGitlabDetail({ message: "404 Not Found" })).toBe(
      "\n404 Not Found",
    );
  });

  it("message 객체 — 배열 값은 펼치고 문자열 값은 그대로", () => {
    expect(
      extractGitlabDetail({
        message: { title: ["can't be blank", "too short"], base: "invalid" },
      }),
    ).toBe("\ncan't be blank\ntoo short\ninvalid");
  });

  it("OAuth 스타일 error/error_description을 둘 다 싣는다", () => {
    expect(
      extractGitlabDetail({
        error: "invalid_token",
        error_description: "Token expired",
      }),
    ).toBe("\ninvalid_token\nToken expired");
  });

  it("알려진 키가 없으면 빈 문자열", () => {
    expect(extractGitlabDetail({ status: 500, foo: "bar" })).toBe("");
  });
});
