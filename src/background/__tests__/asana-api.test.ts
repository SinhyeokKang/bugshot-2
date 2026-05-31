import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthHeader,
  mapCreateTaskBody,
  messageForAsanaStatus,
  searchUsers,
  updateTaskNotes,
} from "../asana-api";
import type { AsanaAuth } from "@/types/asana";

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
