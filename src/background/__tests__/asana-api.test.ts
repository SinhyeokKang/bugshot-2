import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AsanaError,
  asanaFetch,
  buildAuthHeader,
  createTask,
  extractAsanaDetail,
  getMyself,
  getTaskStatus,
  getWorkspaces,
  mapCreateTaskBody,
  messageForAsanaStatus,
  normalizeTaskStatus,
  searchProjects,
  searchUsers,
  setTaskCompleted,
  updateTaskNotes,
  uploadAttachment,
} from "../asana-api";
import type { AsanaAuth } from "@/types/asana";
import { mockFetchOnce, type MockFetch } from "@/test/fetch-mock";

vi.mock("@/i18n", () => ({
  t: (k: string, p?: Record<string, unknown>) =>
    p ? k.replace(/\{(\w+)\}/g, (_, key) => String(p[key] ?? `{${key}}`)) : k,
}));

describe("buildAuthHeader", () => {
  it("PAT은 'Bearer <pat>'", () => {
    expect(
      buildAuthHeader({
        kind: "pat",
        pat: "1/abc",
        viewerGid: "111",
        viewerName: "u",
      }),
    ).toBe("Bearer 1/abc");
  });

  it("OAuth는 'Bearer <accessToken>'", () => {
    expect(
      buildAuthHeader({
        kind: "oauth",
        accessToken: "ATK",
        refreshToken: "RTK",
        expiresAt: 9999,
        grantedAt: 1,
        viewerGid: "111",
        viewerName: "u",
      }),
    ).toBe("Bearer ATK");
  });
});

describe("mapCreateTaskBody", () => {
  it("최소 — name/html_notes/workspace를 { data } 안에 래핑", () => {
    expect(
      mapCreateTaskBody({
        workspaceGid: "W",
        name: "T",
        htmlNotes: "<body>D</body>",
      }),
    ).toEqual({
      data: { name: "T", html_notes: "<body>D</body>", workspace: "W" },
    });
  });

  it("projectGid 있으면 projects 배열로 전달", () => {
    const out = mapCreateTaskBody({
      workspaceGid: "W",
      projectGid: "P",
      name: "T",
      htmlNotes: "<body>D</body>",
    });
    expect((out.data as Record<string, unknown>).projects).toEqual(["P"]);
  });

  it("assigneeGid 있으면 assignee로 전달", () => {
    const out = mapCreateTaskBody({
      workspaceGid: "W",
      name: "T",
      htmlNotes: "<body>D</body>",
      assigneeGid: "U",
    });
    expect((out.data as Record<string, unknown>).assignee).toBe("U");
  });

  it("projectGid/assigneeGid 없으면 projects/assignee 키 생략", () => {
    const out = mapCreateTaskBody({
      workspaceGid: "W",
      name: "T",
      htmlNotes: "<body>D</body>",
    });
    const data = out.data as Record<string, unknown>;
    expect("projects" in data).toBe(false);
    expect("assignee" in data).toBe(false);
  });
});

describe("searchUsers", () => {
  const pat: AsanaAuth = {
    kind: "pat",
    pat: "1/abc",
    viewerGid: "1",
    viewerName: "u",
  };

  function mockFetch(data: unknown) {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data }),
    } as Response);
    vi.stubGlobal("fetch", f);
    return f;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("typeahead가 아니라 /users?workspace= 멤버 목록을 호출", async () => {
    const f = mockFetch([{ gid: "u1", name: "Alice", email: "a@x.com" }]);
    const out = await searchUsers(pat, "W", "");
    const calledUrl = f.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/users?workspace=W");
    expect(calledUrl).not.toContain("typeahead");
    expect(out).toEqual([{ gid: "u1", name: "Alice", email: "a@x.com" }]);
  });

  it("query로 이름 부분 일치 필터 (대소문자 무시)", async () => {
    mockFetch([
      { gid: "u1", name: "Alice" },
      { gid: "u2", name: "Bob" },
    ]);
    const out = await searchUsers(pat, "W", "ALI");
    expect(out).toEqual([{ gid: "u1", name: "Alice", email: undefined }]);
  });

  it("빈 query는 전체 멤버 반환 (typeahead 빈 결과 문제 회피)", async () => {
    mockFetch([
      { gid: "u1", name: "Alice" },
      { gid: "u2", name: "Bob" },
    ]);
    const out = await searchUsers(pat, "W", "");
    expect(out).toHaveLength(2);
  });
});

describe("updateTaskNotes", () => {
  const pat: AsanaAuth = {
    kind: "pat",
    pat: "1/abc",
    viewerGid: "1",
    viewerName: "u",
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("PUT /tasks/{gid}에 html_notes를 data로 감싸 전송", async () => {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: {} }),
    } as Response);
    vi.stubGlobal("fetch", f);

    await updateTaskNotes(pat, "T1", "<body>hi</body>");

    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/tasks/T1");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      data: { html_notes: "<body>hi</body>" },
    });
  });
});

describe("messageForAsanaStatus", () => {
  it("주요 상태 코드별 비어있지 않은 메시지 반환", () => {
    expect(messageForAsanaStatus(401)).toBeTruthy();
    expect(messageForAsanaStatus(403)).toBeTruthy();
    expect(messageForAsanaStatus(404)).toBeTruthy();
    expect(messageForAsanaStatus(429)).toBeTruthy();
    expect(messageForAsanaStatus(500)).toBeTruthy();
    expect(messageForAsanaStatus(502)).toBeTruthy();
  });

  it("알려지지 않은 상태 코드는 generic 메시지 반환", () => {
    expect(messageForAsanaStatus(418)).toContain("asana.error.generic");
  });
});

describe("URL 경로·쿼리 인코딩", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetch(data: unknown = {}) {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data }),
    } as Response);
    vi.stubGlobal("fetch", f);
    return f;
  }

  const pat = { kind: "pat", pat: "p", viewerName: "n", viewerGid: "g1" } as const;

  // 정상 gid에서 URL이 종전과 한 글자도 달라지면 안 된다(이중 인코딩·쿼리 형태 변화 금지).
  it("영숫자 gid는 URL 문자열이 그대로다", async () => {
    const f = mockFetch([]);
    await searchUsers(pat, "12345", "");
    expect(f.mock.calls[0][0]).toBe(
      "https://app.asana.com/api/1.0/users?workspace=12345&opt_fields=name,email&limit=100",
    );
  });

  it("특수문자가 든 gid는 인코딩된다", async () => {
    const f = mockFetch([]);
    await searchUsers(pat, "a b#c", "");
    expect(f.mock.calls[0][0]).toContain("workspace=a%20b%23c");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 아래는 `@/test/fetch-mock` 기반 신규 블록이다. 위쪽 기존 블록의 로컬 `mockFetch`와
// 실패 모드가 다르다 — 로컬 목은 URL을 안 보고 항상 같은 응답을 주고 `text()`가 없어
// 에러 본문 경로를 못 태우지만, `mockFetchOnce`는 응답 큐를 소비하고 `text()`를 준다.
// 섞이면 어느 쪽이 stub된 fetch인지가 모호해지므로 describe와 afterEach를 분리한다.
// ─────────────────────────────────────────────────────────────────────────────

const PAT: AsanaAuth = { kind: "pat", pat: "1/tok", viewerGid: "1", viewerName: "u" };

let mf: MockFetch | undefined;

function envelope(data: unknown) {
  mf = mockFetchOnce({ body: { data } });
  return mf;
}

describe("normalizeTaskStatus (순수)", () => {
  it("snake_case permalink_url을 permalinkUrl로 옮기고 나머지는 그대로 싣는다", () => {
    expect(
      normalizeTaskStatus({
        gid: "T1",
        name: "버그 제목",
        completed: true,
        permalink_url: "https://app.asana.com/0/1/2",
      }),
    ).toEqual({
      gid: "T1",
      name: "버그 제목",
      completed: true,
      permalinkUrl: "https://app.asana.com/0/1/2",
    });
  });

  it("completed:false는 false 그대로 (하드코딩 금지)", () => {
    expect(
      normalizeTaskStatus({
        gid: "T2",
        name: "n",
        completed: false,
        permalink_url: "https://app.asana.com/0/9/9",
      }).completed,
    ).toBe(false);
  });
});

describe("extractAsanaDetail", () => {
  it("객체가 아니면 빈 문자열", () => {
    expect(extractAsanaDetail(null)).toBe("");
    expect(extractAsanaDetail("boom")).toBe("");
    expect(extractAsanaDetail(undefined)).toBe("");
  });

  it("errors[].message · error · error_description을 줄바꿈으로 이어 붙인다", () => {
    expect(
      extractAsanaDetail({
        errors: [{ message: "first" }, { message: "second" }],
        error: "invalid_grant",
        error_description: "token expired",
      }),
    ).toBe("\nfirst\nsecond\ninvalid_grant\ntoken expired");
  });

  it("message가 문자열이 아닌 errors 항목은 건너뛰고, 남는 게 없으면 빈 문자열", () => {
    expect(extractAsanaDetail({ errors: [{ message: 42 }, null, "x"] })).toBe("");
  });
});

describe("asanaFetch — 응답 봉투 { data }", () => {
  afterEach(() => {
    mf?.restore();
    mf = undefined;
  });

  it("data가 null이면 null을 그대로 돌려준다 (빈 객체로 바꾸지 않는다)", async () => {
    envelope(null);
    await expect(asanaFetch(PAT, "/anything")).resolves.toBeNull();
  });

  it("data가 빈 배열이면 빈 배열 — getWorkspaces는 []를 반환한다", async () => {
    envelope([]);
    await expect(getWorkspaces(PAT)).resolves.toEqual([]);
  });

  it("data 키 자체가 없는 200 {}은 undefined로 언랩된다 (throw 아님)", async () => {
    mf = mockFetchOnce({ body: {} });
    await expect(asanaFetch(PAT, "/anything")).resolves.toBeUndefined();
  });

  it("errors[]만 실린 200은 에러가 아니라 undefined다 — HTTP 상태가 유일한 판정 축", async () => {
    mf = mockFetchOnce({ body: { errors: [{ message: "Not the right workspace" }] } });
    await expect(asanaFetch(PAT, "/anything")).resolves.toBeUndefined();
  });

  it("204는 본문을 읽지 않고 undefined", async () => {
    mf = mockFetchOnce({ status: 204, body: new Error("json()을 부르면 안 된다") });
    await expect(asanaFetch(PAT, "/tasks/T1", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("https://로 시작하는 path는 API_BASE를 앞에 붙이지 않는다", async () => {
    const f = envelope({ ok: 1 });
    await asanaFetch(PAT, "https://asana-attachments.example.com/f/1");
    expect(f.callAt(0).url).toBe("https://asana-attachments.example.com/f/1");
  });

  it("상대 path는 /api/1.0 베이스에 붙는다", async () => {
    const f = envelope({});
    await asanaFetch(PAT, "/workspaces");
    expect(f.callAt(0).url).toBe("https://app.asana.com/api/1.0/workspaces");
  });

  it("JSON body 요청은 Authorization·Content-Type·no-cache를 싣는다", async () => {
    const f = envelope({});
    await asanaFetch(PAT, "/tasks", { method: "POST", body: "{}" });
    const init = f.callAt(0).init as RequestInit & { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe("Bearer 1/tok");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers.Accept).toBe("application/json");
    expect(init.cache).toBe("no-cache");
  });
});

describe("asanaFetch — 에러 전파", () => {
  afterEach(() => {
    mf?.restore();
    mf = undefined;
  });

  it("4xx는 AsanaError로 던지고 status·상태 메시지·errors[] 상세를 함께 싣는다", async () => {
    mf = mockFetchOnce({
      status: 403,
      body: { errors: [{ message: "You do not have access" }] },
    });
    const err = await asanaFetch(PAT, "/tasks/T1").catch((e) => e);
    expect(err).toBeInstanceOf(AsanaError);
    expect((err as AsanaError).status).toBe(403);
    expect((err as AsanaError).message).toBe("asana.error.403\nYou do not have access");
    expect((err as AsanaError).body).toEqual({ errors: [{ message: "You do not have access" }] });
  });

  it("JSON이 아닌 본문은 원문 그대로 body에 담기고 상세는 붙지 않는다", async () => {
    mf = mockFetchOnce({ status: 502, body: "<html>bad gateway</html>" });
    const err = (await asanaFetch(PAT, "/tasks/T1").catch((e) => e)) as AsanaError;
    expect(err.status).toBe(502);
    expect(err.message).toBe("asana.error.5xx");
    expect(err.body).toBe("<html>bad gateway</html>");
  });

  it("본문 읽기 자체가 실패해도 상태 메시지만으로 던진다", async () => {
    mf = mockFetchOnce({ status: 429, body: new Error("stream 끊김") });
    const err = (await asanaFetch(PAT, "/tasks/T1").catch((e) => e)) as AsanaError;
    expect(err.status).toBe(429);
    expect(err.message).toBe("asana.error.429");
    expect(err.body).toBeUndefined();
  });
});

describe("getMyself", () => {
  afterEach(() => {
    mf?.restore();
    mf = undefined;
  });

  it("/users/me를 opt_fields=name,email로 부르고 gid/name/email을 옮긴다", async () => {
    const f = envelope({ gid: "U9", name: "Kim", email: "k@x.com" });
    await expect(getMyself(PAT)).resolves.toEqual({
      gid: "U9",
      name: "Kim",
      email: "k@x.com",
    });
    const url = f.callAt(0).url;
    expect(url).toContain("/users/me");
    expect(url).toContain("opt_fields=name,email");
  });

  it("email이 null이면 undefined로 정규화한다", async () => {
    envelope({ gid: "U9", name: "Kim", email: null });
    await expect(getMyself(PAT)).resolves.toEqual({
      gid: "U9",
      name: "Kim",
      email: undefined,
    });
  });
});

describe("getWorkspaces", () => {
  afterEach(() => {
    mf?.restore();
    mf = undefined;
  });

  it("opt_fields=name·limit=100을 실어 부르고 gid/name만 남긴다", async () => {
    const f = envelope([
      { gid: "W1", name: "Acme", resource_type: "workspace", is_organization: true },
      { gid: "W2", name: "Side" },
    ]);
    await expect(getWorkspaces(PAT)).resolves.toEqual([
      { gid: "W1", name: "Acme" },
      { gid: "W2", name: "Side" },
    ]);
    const url = f.callAt(0).url;
    expect(url).toContain("/workspaces");
    expect(url).toContain("opt_fields=name");
    expect(url).toContain("limit=100");
  });
});

describe("searchProjects", () => {
  afterEach(() => {
    mf?.restore();
    mf = undefined;
  });

  it("workspace를 인코딩해 쿼리로 싣고 limit=100·opt_fields=name을 요구한다", async () => {
    const f = envelope([]);
    await searchProjects(PAT, "a b#c", "");
    const url = f.callAt(0).url;
    expect(url).toContain("/projects?");
    expect(url).toContain("workspace=a%20b%23c");
    expect(url).toContain("opt_fields=name");
    expect(url).toContain("limit=100");
  });

  it("query는 서버가 아니라 클라이언트에서 대소문자 무시 부분 일치로 거른다", async () => {
    const f = envelope([
      { gid: "P1", name: "Design QA" },
      { gid: "P2", name: "Backend" },
    ]);
    await expect(searchProjects(PAT, "W", " qa ")).resolves.toEqual([
      { gid: "P1", name: "Design QA" },
    ]);
    expect(f.callAt(0).url).not.toContain("qa");
  });

  it("빈 query는 전체 목록을 그대로 반환한다", async () => {
    envelope([
      { gid: "P1", name: "Design QA" },
      { gid: "P2", name: "Backend" },
    ]);
    await expect(searchProjects(PAT, "W", "   ")).resolves.toEqual([
      { gid: "P1", name: "Design QA" },
      { gid: "P2", name: "Backend" },
    ]);
  });
});

describe("createTask", () => {
  afterEach(() => {
    mf?.restore();
    mf = undefined;
  });

  it("POST /tasks에 mapCreateTaskBody 출력을 그대로 싣고 permalink_url을 요청한다", async () => {
    const f = envelope({ gid: "T7", permalink_url: "https://app.asana.com/0/1/7" });
    const out = await createTask(PAT, {
      workspaceGid: "W",
      projectGid: "P",
      assigneeGid: "U",
      name: "제목",
      htmlNotes: "<body>본문</body>",
    });

    const { url, init } = f.callAt(0);
    expect(url).toContain("/tasks?");
    expect(url).toContain("opt_fields=permalink_url");
    expect(init?.method).toBe("POST");
    expect(f.jsonBodyAt(0)).toEqual({
      data: {
        name: "제목",
        html_notes: "<body>본문</body>",
        workspace: "W",
        projects: ["P"],
        assignee: "U",
      },
    });
    expect(out).toEqual({ gid: "T7", permalinkUrl: "https://app.asana.com/0/1/7" });
  });
});

describe("uploadAttachment", () => {
  afterEach(() => {
    mf?.restore();
    mf = undefined;
  });

  it("multipart로 parent와 파일명 있는 file을 보내고 Content-Type을 직접 세팅하지 않는다", async () => {
    const f = envelope({ gid: "A1", view_url: "https://app.asana.com/app/asana/-/get_asset?asset_id=1" });
    const out = await uploadAttachment(
      PAT,
      "T7",
      "before.png",
      new Blob(["PNGDATA"], { type: "image/png" }),
    );

    const { url, init } = f.callAt(0);
    expect(url).toContain("/attachments?");
    expect(url).toContain("opt_fields=view_url");
    expect(init?.method).toBe("POST");
    // FormData면 boundary를 브라우저가 붙여야 해서 Content-Type을 넣으면 안 된다.
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBeUndefined();

    const form = f.formDataAt(0);
    expect(form.get("parent")).toBe("T7");
    const file = form.get("file") as File;
    expect(file.name).toBe("before.png");
    await expect(file.text()).resolves.toBe("PNGDATA");

    expect(out).toEqual({
      gid: "A1",
      viewUrl: "https://app.asana.com/app/asana/-/get_asset?asset_id=1",
    });
  });

  it("view_url이 없으면 viewUrl은 undefined", async () => {
    envelope({ gid: "A2" });
    const out = await uploadAttachment(PAT, "T7", "a.png", new Blob(["x"]));
    expect(out).toEqual({ gid: "A2", viewUrl: undefined });
  });
});

describe("getTaskStatus / setTaskCompleted", () => {
  afterEach(() => {
    mf?.restore();
    mf = undefined;
  });

  it("getTaskStatus는 gid를 경로에 인코딩해 넣고 normalizeTaskStatus 결과를 돌려준다", async () => {
    const f = envelope({
      gid: "1/2 3",
      name: "n",
      completed: false,
      permalink_url: "https://app.asana.com/0/1/3",
    });
    await expect(getTaskStatus(PAT, "1/2 3")).resolves.toEqual({
      gid: "1/2 3",
      name: "n",
      completed: false,
      permalinkUrl: "https://app.asana.com/0/1/3",
    });
    const url = f.callAt(0).url;
    expect(url).toContain("/tasks/1%2F2%203?");
    expect(url).toContain("opt_fields=name,completed,permalink_url");
  });

  it("setTaskCompleted는 PUT + { data: { completed } }를 보내고 갱신된 상태를 돌려준다", async () => {
    const f = envelope({
      gid: "T7",
      name: "n",
      completed: true,
      permalink_url: "https://app.asana.com/0/1/7",
    });
    await expect(setTaskCompleted(PAT, "T7", true)).resolves.toEqual({
      gid: "T7",
      name: "n",
      completed: true,
      permalinkUrl: "https://app.asana.com/0/1/7",
    });
    expect(f.callAt(0).init?.method).toBe("PUT");
    expect(f.jsonBodyAt(0)).toEqual({ data: { completed: true } });
  });

  it("completed:false도 그대로 실린다 (true 하드코딩 금지)", async () => {
    const f = envelope({
      gid: "T7",
      name: "n",
      completed: false,
      permalink_url: "https://app.asana.com/0/1/7",
    });
    await setTaskCompleted(PAT, "T7", false);
    expect(f.jsonBodyAt(0)).toEqual({ data: { completed: false } });
  });
});
