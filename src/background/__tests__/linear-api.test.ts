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

import { mockFetchOnce, type MockFetch } from "@/test/fetch-mock";
import type { LinearAuth } from "@/types/linear";
import {
  buildLinearAuthHeader,
  createAttachment,
  createIssue,
  extractLinearErrors,
  getIssueStatus,
  getLabels,
  getMembers,
  getMyself,
  getProjects,
  getTeams,
  getWorkflowStates,
  LinearError,
  messageForLinearStatus,
  requestFileUpload,
  sortWorkflowStates,
  updateIssueDescription,
  updateIssueState,
  uploadFileToLinear,
} from "../linear-api";

describe("buildLinearAuthHeader", () => {
  it("API Key는 키 그대로", () => {
    expect(
      buildLinearAuthHeader({
        kind: "apiKey",
        apiKey: "lin_api_xxx",
        viewerName: "u",
      }),
    ).toBe("lin_api_xxx");
  });

  it("OAuth는 'Bearer <accessToken>'", () => {
    expect(
      buildLinearAuthHeader({
        kind: "oauth",
        accessToken: "ATK",
        refreshToken: "RTK",
        expiresAt: 9999999999999,
        scope: "read,write",
        viewerName: "u",
        grantedAt: 1,
      }),
    ).toBe("Bearer ATK");
  });
});

describe("extractLinearErrors", () => {
  it("errors 배열의 message를 줄바꿈으로 합침", () => {
    expect(
      extractLinearErrors([
        { message: "Field 'teamId' is required" },
        { message: "Invalid input" },
      ]),
    ).toBe("Field 'teamId' is required\nInvalid input");
  });

  it("message가 없으면 fallback 메시지", () => {
    expect(extractLinearErrors([{}])).toBe("Unknown GraphQL error");
  });

  it("빈 배열이면 빈 문자열", () => {
    expect(extractLinearErrors([])).toBe("");
  });
});

describe("messageForLinearStatus", () => {
  it("주요 상태 코드별 비어있지 않은 메시지 반환", () => {
    expect(messageForLinearStatus(401)).toBeTruthy();
    expect(messageForLinearStatus(403)).toBeTruthy();
    expect(messageForLinearStatus(404)).toBeTruthy();
    expect(messageForLinearStatus(429)).toBeTruthy();
    expect(messageForLinearStatus(500)).toBeTruthy();
    expect(messageForLinearStatus(502)).toBeTruthy();
  });

  it("알려지지 않은 상태 코드는 generic 메시지에 코드 포함", () => {
    expect(messageForLinearStatus(418)).toContain("418");
  });
});

describe("sortWorkflowStates", () => {
  it("type 순서대로 정렬: triage → backlog → unstarted → started → completed → cancelled", () => {
    const states = [
      { id: "5", name: "Done", type: "completed", color: "#5e6ad2" },
      { id: "1", name: "Triage", type: "triage", color: "#e2e2e2" },
      { id: "3", name: "Todo", type: "unstarted", color: "#e2e2e2" },
      { id: "6", name: "Cancelled", type: "cancelled", color: "#95a2b3" },
      { id: "4", name: "In Progress", type: "started", color: "#f2c94c" },
      { id: "2", name: "Backlog", type: "backlog", color: "#bec2c8" },
    ];

    const sorted = sortWorkflowStates(states);
    expect(sorted.map((s) => s.type)).toEqual([
      "triage",
      "backlog",
      "unstarted",
      "started",
      "completed",
      "cancelled",
    ]);
  });

  it("알 수 없는 type은 목록 끝에 배치", () => {
    const states = [
      { id: "1", name: "Custom", type: "custom_type", color: "#000" },
      { id: "2", name: "In Progress", type: "started", color: "#f2c94c" },
      { id: "3", name: "Todo", type: "unstarted", color: "#e2e2e2" },
    ];

    const sorted = sortWorkflowStates(states);
    expect(sorted.map((s) => s.type)).toEqual([
      "unstarted",
      "started",
      "custom_type",
    ]);
  });

  it("빈 배열 → 빈 배열", () => {
    expect(sortWorkflowStates([])).toEqual([]);
  });

  it("같은 type 내에서 원본 순서 유지", () => {
    const states = [
      { id: "1", name: "In Review", type: "started", color: "#f2c94c" },
      { id: "2", name: "In Progress", type: "started", color: "#f2c94c" },
      { id: "3", name: "Backlog", type: "backlog", color: "#bec2c8" },
    ];

    const sorted = sortWorkflowStates(states);
    expect(sorted.map((s) => s.name)).toEqual([
      "Backlog",
      "In Review",
      "In Progress",
    ]);
  });

  it("일부 type만 있어도 올바르게 정렬", () => {
    const states = [
      { id: "1", name: "Done", type: "completed", color: "#5e6ad2" },
      { id: "2", name: "Todo", type: "unstarted", color: "#e2e2e2" },
    ];

    const sorted = sortWorkflowStates(states);
    expect(sorted.map((s) => s.type)).toEqual(["unstarted", "completed"]);
  });

  it("원본 배열을 변경하지 않음", () => {
    const states = [
      { id: "1", name: "Done", type: "completed", color: "#5e6ad2" },
      { id: "2", name: "Todo", type: "unstarted", color: "#e2e2e2" },
    ];
    const original = [...states];

    sortWorkflowStates(states);
    expect(states).toEqual(original);
  });
});

describe("createIssue — subscriberIds", () => {
  const auth = { kind: "apiKey", apiKey: "lin_api_xxx", viewerName: "u" } as const;

  function mockFetch() {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          issueCreate: {
            success: true,
            issue: { id: "i1", identifier: "BUG-1", url: "https://linear.app/i/BUG-1" },
          },
        },
      }),
    } as Response);
    vi.stubGlobal("fetch", f);
    return f;
  }

  function sentInput(f: ReturnType<typeof mockFetch>) {
    const init = f.mock.calls[0][1] as RequestInit;
    return JSON.parse(init.body as string).variables.input as Record<string, unknown>;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("subscriberIds 있으면 input에 포함", async () => {
    const f = mockFetch();
    await createIssue(auth, {
      teamId: "t1",
      title: "T",
      description: "d",
      subscriberIds: ["u1", "u2"],
    });
    expect(sentInput(f).subscriberIds).toEqual(["u1", "u2"]);
  });

  it("subscriberIds 없으면(빈 배열 포함) input에서 제외", async () => {
    const f = mockFetch();
    await createIssue(auth, {
      teamId: "t1",
      title: "T",
      description: "d",
      subscriberIds: [],
    });
    expect(sentInput(f)).not.toHaveProperty("subscriberIds");
  });
});

// ---------------------------------------------------------------------------
// 아래는 공용 `@/test/fetch-mock` 기반. 위의 `createIssue — subscriberIds`가 쓰는 로컬 목과
// 실패 모드가 다르다 — 로컬 목은 호출 수와 무관하게 같은 성공 응답을 무한 반환하고, 공용 목은
// 큐를 앞에서 소비한 뒤 마지막 값을 반복하며 `ok:false`/`statusText`를 표현할 수 있다.
// 그래서 섞지 않고 별도 describe + 자기 afterEach(mf.restore)로 분리한다.
// Linear는 GraphQL 단일 엔드포인트라 검증 축이 URL이 아니라 **query 문서 + variables**다.

const AUTH = {
  kind: "apiKey",
  apiKey: "lin_api_KEY",
  viewerName: "u",
} as const;

let mf: MockFetch | undefined;

function sentAt(n: number) {
  return mf!.jsonBodyAt(n) as { query: string; variables?: Record<string, unknown> };
}

describe("linear GraphQL 요청 인코딩", () => {
  afterEach(() => mf?.restore());

  it("단일 엔드포인트에 POST + JSON 본문(query·variables), Authorization은 API Key 원문", async () => {
    mf = mockFetchOnce({ body: { data: { teams: { nodes: [] } } } });

    await getTeams(AUTH);

    const { url, init } = mf.callAt(0);
    const parsed = new URL(url);
    expect(parsed.protocol).toBe("https:");
    expect(parsed.host).toBe("api.linear.app");
    expect(parsed.pathname).toBe("/graphql");
    expect(parsed.search).toBe("");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "lin_api_KEY",
    });
    // variables가 undefined면 JSON.stringify가 키 자체를 떨어뜨린다(있는 경우는 아래 케이스들).
    expect(Object.keys(sentAt(0))).toEqual(["query"]);
    expect(sentAt(0).query).toContain("teams");
  });

  it("OAuth auth는 Authorization에 Bearer 접두사가 붙어 나간다", async () => {
    mf = mockFetchOnce({ body: { data: { teams: { nodes: [] } } } });

    await getTeams({
      kind: "oauth",
      accessToken: "ATK",
      refreshToken: "RTK",
      expiresAt: 9999999999999,
      scope: "read,write",
      viewerName: "u",
      grantedAt: 1,
    });

    expect((mf.callAt(0).init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer ATK",
    );
  });

  it("값은 query 문서에 보간되지 않고 variables로만 간다 — 따옴표·개행·비ASCII가 섞여도", async () => {
    mf = mockFetchOnce({ body: { data: { issueUpdate: { success: true } } } });

    await updateIssueDescription(AUTH, 'ISS"1', 'he said "hi"\n줄바꿈 ✓');

    const sent = sentAt(0);
    expect(sent.variables).toEqual({
      id: 'ISS"1',
      description: 'he said "hi"\n줄바꿈 ✓',
    });
    expect(sent.query).not.toContain("he said");
    expect(sent.query).not.toContain('ISS"1');
    expect(sent.query).toContain("$id: String!");
    expect(sent.query).toContain("$description: String!");
    expect(sent.query).toContain("issueUpdate(id: $id, input: { description: $description })");
  });
});

describe("linearGraphQL 에러 전파", () => {
  afterEach(() => mf?.restore());

  it("HTTP 실패는 status + messageForLinearStatus 메시지를 실은 LinearError", async () => {
    mf = mockFetchOnce({ ok: false, status: 429, body: { message: "rate limited" } });

    const err = await getTeams(AUTH).catch((e) => e as LinearError);

    expect(err).toBeInstanceOf(LinearError);
    expect((err as LinearError).status).toBe(429);
    expect((err as LinearError).message).toBe("linear.error.429");
  });

  it("HTTP 200이어도 errors[]가 있으면 status 200 + 메시지 결합 + body에 원본 errors", async () => {
    mf = mockFetchOnce({
      status: 200,
      body: {
        data: null,
        errors: [{ message: "Entity not found" }, { message: "Access denied" }],
      },
    });

    const err = await getTeams(AUTH).catch((e) => e as LinearError);

    expect(err).toBeInstanceOf(LinearError);
    expect((err as LinearError).status).toBe(200);
    expect((err as LinearError).message).toBe("Entity not found\nAccess denied");
    expect((err as LinearError).body).toEqual([
      { message: "Entity not found" },
      { message: "Access denied" },
    ]);
  });
});

describe("응답 봉투 — viewer / teams", () => {
  afterEach(() => mf?.restore());

  it("getMyself는 data.viewer를 그대로 돌려준다", async () => {
    mf = mockFetchOnce({
      body: {
        data: {
          viewer: {
            id: "U_1",
            name: "Kim",
            email: "kim@example.com",
            avatarUrl: "https://cdn.example.com/a.png",
          },
        },
      },
    });

    const me = await getMyself(AUTH);

    expect(me).toEqual({
      id: "U_1",
      name: "Kim",
      email: "kim@example.com",
      avatarUrl: "https://cdn.example.com/a.png",
    });
    expect(sentAt(0).query).toContain("viewer { id name email avatarUrl }");
    expect(sentAt(0).variables).toBeUndefined();
  });

  it("getTeams는 data.teams.nodes를 돌려준다", async () => {
    mf = mockFetchOnce({
      body: {
        data: {
          teams: {
            nodes: [
              { id: "T_1", name: "Web", key: "WEB" },
              { id: "T_2", name: "Core", key: "COR" },
            ],
          },
        },
      },
    });

    expect(await getTeams(AUTH)).toEqual([
      { id: "T_1", name: "Web", key: "WEB" },
      { id: "T_2", name: "Core", key: "COR" },
    ]);
    expect(sentAt(0).query).toContain("teams { nodes { id name key } }");
  });
});

describe("팀 스코프 조회 3종 — teamId variables + team.<field>.nodes 봉투", () => {
  afterEach(() => mf?.restore());

  const rows: Array<{
    label: string;
    fn: (auth: LinearAuth, teamId: string) => Promise<unknown[]>;
    field: string;
    nodes: Record<string, unknown>[];
  }> = [
    {
      label: "getProjects",
      fn: getProjects,
      field: "projects",
      nodes: [{ id: "P_1", name: "Redesign", state: "started" }],
    },
    {
      label: "getLabels",
      fn: getLabels,
      field: "labels",
      nodes: [{ id: "L_1", name: "bug", color: "#eb5757" }],
    },
    {
      label: "getMembers",
      fn: getMembers,
      field: "members",
      nodes: [
        { id: "U_9", name: "Lee", email: "lee@example.com", avatarUrl: "https://c/x.png" },
      ],
    },
  ];

  for (const row of rows) {
    it(`${row.label}은 teamId를 variables로 보내고 team.${row.field}.nodes를 돌려준다`, async () => {
      mf = mockFetchOnce({ body: { data: { team: { [row.field]: { nodes: row.nodes } } } } });

      const got = await row.fn(AUTH, "TEAM_1");

      expect(got).toEqual(row.nodes);
      const sent = sentAt(0);
      expect(sent.variables).toEqual({ teamId: "TEAM_1" });
      expect(sent.query).toContain("$teamId: String!");
      expect(sent.query).toContain("team(id: $teamId)");
      expect(sent.query).toContain(row.field);
    });
  }
});

describe("이슈 상태 조회·변경 — labels.nodes 평탄화", () => {
  afterEach(() => mf?.restore());

  const ISSUE = {
    id: "ISS_1",
    identifier: "WEB-12",
    title: "버튼이 안 눌린다",
    url: "https://linear.app/acme/issue/WEB-12",
    state: { name: "In Progress", type: "started" },
    labels: { nodes: [{ name: "bug", color: "#eb5757" }] },
  };

  it("getIssueStatus는 issueId를 보내고 labels를 배열로 펴서 돌려준다", async () => {
    mf = mockFetchOnce({ body: { data: { issue: ISSUE } } });

    const got = await getIssueStatus(AUTH, "ISS_1");

    expect(got).toEqual({
      id: "ISS_1",
      identifier: "WEB-12",
      title: "버튼이 안 눌린다",
      url: "https://linear.app/acme/issue/WEB-12",
      state: { name: "In Progress", type: "started" },
      labels: [{ name: "bug", color: "#eb5757" }],
    });
    const sent = sentAt(0);
    expect(sent.variables).toEqual({ issueId: "ISS_1" });
    expect(sent.query).toContain("$issueId: String!");
    expect(sent.query).toContain("issue(id: $issueId)");
  });

  it("updateIssueState는 id·stateId를 보내고 issueUpdate.issue를 평탄화해 돌려준다", async () => {
    mf = mockFetchOnce({
      body: {
        data: {
          issueUpdate: {
            success: true,
            issue: {
              ...ISSUE,
              state: { name: "Done", type: "completed" },
              labels: { nodes: [] },
            },
          },
        },
      },
    });

    const got = await updateIssueState(AUTH, "ISS_1", "STATE_9");

    expect(got).toEqual({
      id: "ISS_1",
      identifier: "WEB-12",
      title: "버튼이 안 눌린다",
      url: "https://linear.app/acme/issue/WEB-12",
      state: { name: "Done", type: "completed" },
      labels: [],
    });
    const sent = sentAt(0);
    expect(sent.variables).toEqual({ id: "ISS_1", stateId: "STATE_9" });
    expect(sent.query).toContain("$stateId: String!");
    expect(sent.query).toContain("issueUpdate(id: $id, input: { stateId: $stateId })");
  });
});

describe("getWorkflowStates", () => {
  afterEach(() => mf?.restore());

  // variables 키는 `teamId`가 아니라 `id`다 — 이슈 식별자로 팀을 거슬러 올라가는 질의라
  // `issue(id: $id) { team { states } }` 형태다.
  it("이슈 식별자를 id variables로 보내고 응답 nodes를 type 순으로 정렬해 돌려준다", async () => {
    mf = mockFetchOnce({
      body: {
        data: {
          issue: {
            team: {
              states: {
                nodes: [
                  { id: "S_3", name: "Done", type: "completed", color: "#5e6ad2" },
                  { id: "S_1", name: "Todo", type: "unstarted", color: "#e2e2e2" },
                  { id: "S_2", name: "In Progress", type: "started", color: "#f2c94c" },
                ],
              },
            },
          },
        },
      },
    });

    const got = await getWorkflowStates(AUTH, "WEB-12");

    expect(got).toEqual([
      { id: "S_1", name: "Todo", type: "unstarted", color: "#e2e2e2" },
      { id: "S_2", name: "In Progress", type: "started", color: "#f2c94c" },
      { id: "S_3", name: "Done", type: "completed", color: "#5e6ad2" },
    ]);
    const sent = sentAt(0);
    expect(sent.variables).toEqual({ id: "WEB-12" });
    expect(sent.query).toContain("$id: String!");
    expect(sent.query).toContain("issue(id: $id)");
    expect(sent.query).toContain("states { nodes { id name type color } }");
  });
});

describe("파일 업로드 2단 — requestFileUpload → PUT", () => {
  afterEach(() => mf?.restore());

  const UPLOAD_ENVELOPE = {
    data: {
      fileUpload: {
        uploadFile: {
          assetUrl: "https://uploads.linear.app/asset/abc.png",
          uploadUrl: "https://upload.example.com/signed?sig=abc",
          headers: [
            { key: "x-linear-sig", value: "SIG" },
            { key: "Content-Type", value: "text/plain" },
          ],
        },
      },
    },
  };

  it("requestFileUpload는 filename·contentType·size를 보내고 fileUpload.uploadFile을 돌려준다", async () => {
    mf = mockFetchOnce({ body: UPLOAD_ENVELOPE });

    const got = await requestFileUpload(AUTH, 'shot "1".png', "image/png", 1234);

    expect(got).toEqual({
      assetUrl: "https://uploads.linear.app/asset/abc.png",
      uploadUrl: "https://upload.example.com/signed?sig=abc",
      headers: [
        { key: "x-linear-sig", value: "SIG" },
        { key: "Content-Type", value: "text/plain" },
      ],
    });
    const sent = sentAt(0);
    expect(sent.variables).toEqual({
      filename: 'shot "1".png',
      contentType: "image/png",
      size: 1234,
    });
    expect(sent.query).toContain("$filename: String!");
    expect(sent.query).toContain("$contentType: String!");
    expect(sent.query).toContain("$size: Int!");
    expect(sent.query).toContain("fileUpload(filename: $filename, contentType: $contentType, size: $size)");
  });

  it("uploadFileToLinear는 blob.size를 실어 서명을 받고, 서버 헤더에 Content-Type·Cache-Control을 덮어써 raw blob을 PUT한다", async () => {
    mf = mockFetchOnce([{ body: UPLOAD_ENVELOPE }, { status: 200 }]);
    const blob = new Blob(["abcdefg"], { type: "image/png" });

    const assetUrl = await uploadFileToLinear(AUTH, "shot.png", "image/png", blob);

    expect(assetUrl).toBe("https://uploads.linear.app/asset/abc.png");
    expect(sentAt(0).variables).toEqual({
      filename: "shot.png",
      contentType: "image/png",
      size: 7,
    });

    const put = mf.callAt(1);
    expect(put.url).toBe("https://upload.example.com/signed?sig=abc");
    expect(put.init?.method).toBe("PUT");
    expect(put.init?.headers).toEqual({
      "x-linear-sig": "SIG",
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000",
    });
    // JSON 인코딩 없이 blob 자체가 실린다.
    expect(put.init?.body).toBe(blob);
  });

  it("PUT이 실패하면 status와 statusText를 실은 LinearError", async () => {
    mf = mockFetchOnce([
      { body: UPLOAD_ENVELOPE },
      { ok: false, status: 403, statusText: "Forbidden" },
    ]);

    const err = await uploadFileToLinear(
      AUTH,
      "shot.png",
      "image/png",
      new Blob(["x"], { type: "image/png" }),
    ).catch((e) => e as LinearError);

    expect(err).toBeInstanceOf(LinearError);
    expect((err as LinearError).status).toBe(403);
    expect((err as LinearError).message).toBe("linear.error.uploadFailed status=Forbidden");
  });
});

describe("createAttachment", () => {
  afterEach(() => mf?.restore());

  it("issueId·title·url을 input 하나로 묶어 attachmentCreate에 보낸다", async () => {
    mf = mockFetchOnce({ body: { data: { attachmentCreate: { success: true } } } });

    await createAttachment(
      AUTH,
      "ISS_1",
      "logs.html",
      "https://uploads.linear.app/asset/logs.html",
    );

    const sent = sentAt(0);
    expect(sent.variables).toEqual({
      input: {
        issueId: "ISS_1",
        title: "logs.html",
        url: "https://uploads.linear.app/asset/logs.html",
      },
    });
    expect(sent.query).toContain("$input: AttachmentCreateInput!");
    expect(sent.query).toContain("attachmentCreate(input: $input)");
  });
});
