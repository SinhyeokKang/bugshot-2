import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ClickupError,
  clickupAuthHeader,
  createTask,
  flattenLists,
  getLists,
  getMembers,
  getMyself,
  getSpaces,
  getTaskStatus,
  getTeams,
  isCompletedStatus,
  mapCreateTaskBody,
  messageForClickupStatus,
  normalizeTaskStatus,
  setTaskCompleted,
  updateTaskMarkdown,
  uploadAttachment,
} from "../clickup-api";
import { mockFetchOnce, mockFetchRoutes, type MockFetch } from "@/test/fetch-mock";
import type { ClickupAuth } from "@/types/clickup";

// 다른 어댑터 테스트 6벌과 달리 params를 문자열에 붙인다 — clickup.error.generic 사전 값에는
// {status} placeholder가 있지만 *키*에는 없어서, 키만 돌려주는 목이면 `{ status }` 인자를
// 지워도 green이 된다.
vi.mock("@/i18n", () => ({
  t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k),
}));

describe("clickupAuthHeader — raw token (Bearer 없음)", () => {
  it("PAT은 Authorization에 pk_ 토큰을 그대로 (Bearer 접두사 없음)", () => {
    const auth: ClickupAuth = {
      kind: "pat",
      pat: "pk_123",
      viewerId: "u1",
      viewerName: "Me",
    };
    const headers = clickupAuthHeader(auth);
    expect(headers.Authorization).toBe("pk_123");
    expect(headers.Authorization).not.toContain("Bearer");
  });

  it("OAuth는 Authorization에 accessToken을 그대로 (Bearer 접두사 없음)", () => {
    const auth: ClickupAuth = {
      kind: "oauth",
      accessToken: "tok_abc",
      grantedAt: 1700000000000,
      viewerId: "u1",
      viewerName: "Me",
    };
    const headers = clickupAuthHeader(auth);
    expect(headers.Authorization).toBe("tok_abc");
    expect(headers.Authorization).not.toContain("Bearer");
  });
});

describe("flattenLists — folderless + folder list 평탄화", () => {
  it("folderless만 있으면 folderName 없이 반환", () => {
    const out = flattenLists(
      [
        { id: "l1", name: "List 1" },
        { id: "l2", name: "List 2" },
      ],
      [],
    );
    expect(out).toEqual([
      { id: "l1", name: "List 1" },
      { id: "l2", name: "List 2" },
    ]);
  });

  it("folder의 list는 folderName 라벨이 붙는다", () => {
    const out = flattenLists(
      [],
      [{ name: "Sprint", lists: [{ id: "l3", name: "List 3" }] }],
    );
    expect(out).toEqual([{ id: "l3", name: "List 3", folderName: "Sprint" }]);
  });

  it("folderless가 folder list보다 먼저 온다", () => {
    const out = flattenLists(
      [{ id: "l1", name: "Free" }],
      [{ name: "F", lists: [{ id: "l2", name: "InFolder" }] }],
    );
    expect(out.map((l) => l.id)).toEqual(["l1", "l2"]);
    expect(out[0].folderName).toBeUndefined();
    expect(out[1].folderName).toBe("F");
  });

  it("빈 lists를 가진 folder는 결과에 기여하지 않는다", () => {
    const out = flattenLists(
      [],
      [
        { name: "Empty", lists: [] },
        { name: "Has", lists: [{ id: "l9", name: "Nine" }] },
      ],
    );
    expect(out).toEqual([{ id: "l9", name: "Nine", folderName: "Has" }]);
  });

  it("입력이 모두 비면 빈 배열", () => {
    expect(flattenLists([], [])).toEqual([]);
  });
});

describe("URL 경로 인코딩", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetch(body: unknown = {}) {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body,
    } as Response);
    vi.stubGlobal("fetch", f);
    return f;
  }

  const auth: ClickupAuth = {
    kind: "pat",
    pat: "pk_123",
    viewerId: "u1",
    viewerName: "Me",
  };

  // 정상 id에서 URL이 종전과 동일해야 한다(이중 인코딩 금지).
  it("영숫자 id는 URL 문자열이 그대로다", async () => {
    const f = mockFetch({ spaces: [] });
    await getSpaces(auth, "9001");
    expect(f.mock.calls[0][0]).toBe(
      "https://api.clickup.com/api/v2/team/9001/space?archived=false",
    );
  });

  it("특수문자가 든 id는 인코딩된다", async () => {
    const f = mockFetch({ spaces: [] });
    await getSpaces(auth, "a b#c");
    expect(f.mock.calls[0][0]).toContain("/team/a%20b%23c/space");
  });
});

// ─── 순수 함수 (fetch 목 불필요) ──────────────────────────────────────────────

describe("messageForClickupStatus", () => {
  it("상태코드마다 전용 키로 갈린다", () => {
    expect(messageForClickupStatus(401)).toBe("clickup.oauthRevoked");
    expect(messageForClickupStatus(403)).toBe("clickup.error.403");
    expect(messageForClickupStatus(404)).toBe("clickup.error.404");
    expect(messageForClickupStatus(429)).toBe("clickup.error.429");
  });

  it("5xx는 하나의 키로 모인다", () => {
    expect(messageForClickupStatus(500)).toBe("clickup.error.5xx");
    expect(messageForClickupStatus(503)).toBe("clickup.error.5xx");
  });

  it("그 밖의 상태는 generic + status 인자", () => {
    expect(messageForClickupStatus(418)).toBe('clickup.error.generic:{"status":418}');
    expect(messageForClickupStatus(400)).toBe('clickup.error.generic:{"status":400}');
  });
});

describe("mapCreateTaskBody", () => {
  it("이름과 markdown_content만 싣는다 (assignees 없으면 키 자체가 없다)", () => {
    const body = mapCreateTaskBody({
      listId: "l1",
      name: "버튼 정렬 깨짐",
      markdownContent: "## 재현\n1. 클릭",
    });
    expect(body).toEqual({
      name: "버튼 정렬 깨짐",
      markdown_content: "## 재현\n1. 클릭",
    });
    expect("assignees" in body).toBe(false);
  });

  it("assignees는 정수 문자열을 Number로 바꿔 싣는다", () => {
    expect(
      mapCreateTaskBody({
        listId: "l1",
        name: "n",
        markdownContent: "m",
        assignees: ["1234", "5678"],
      }).assignees,
    ).toEqual([1234, 5678]);
  });

  it("빈 assignees 배열은 키를 만들지 않는다", () => {
    const body = mapCreateTaskBody({
      listId: "l1",
      name: "n",
      markdownContent: "m",
      assignees: [],
    });
    expect("assignees" in body).toBe(false);
  });
});

describe("isCompletedStatus", () => {
  it("done·closed 타입만 완료다", () => {
    expect(isCompletedStatus({ type: "done" })).toBe(true);
    expect(isCompletedStatus({ type: "closed" })).toBe(true);
  });

  it("그 밖의 타입과 status 부재는 미완료다", () => {
    expect(isCompletedStatus({ type: "open" })).toBe(false);
    expect(isCompletedStatus({ type: "custom" })).toBe(false);
    expect(isCompletedStatus(undefined)).toBe(false);
  });
});

describe("normalizeTaskStatus", () => {
  it("완료 판정은 status.status 라벨이 아니라 status.type만 본다", () => {
    expect(
      normalizeTaskStatus({
        id: "86a",
        name: "Task",
        url: "https://app.clickup.com/t/86a",
        status: { status: "done", type: "open" },
      }),
    ).toEqual({
      id: "86a",
      name: "Task",
      completed: false,
      url: "https://app.clickup.com/t/86a",
    });
  });

  it("type이 closed면 완료", () => {
    expect(
      normalizeTaskStatus({
        id: "86b",
        name: "T",
        url: "u",
        status: { status: "무엇이든", type: "closed" },
      }).completed,
    ).toBe(true);
  });

  it("status가 없으면 미완료이고 list 같은 여분 필드는 버린다", () => {
    expect(
      normalizeTaskStatus({ id: "86c", name: "T", url: "u", list: { id: "l1" } }),
    ).toEqual({ id: "86c", name: "T", completed: false, url: "u" });
  });
});

// ─── fetch 경로 ──────────────────────────────────────────────────────────────
//
// 이 파일엔 fetch 목이 둘이다. 위 `URL 경로 인코딩` describe는 로컬 목이라 **어떤 URL이든**
// 같은 응답을 주고, 아래는 `@/test/fetch-mock`이라 라우트 미매칭이면 **throw**한다.
// 실패 모드가 다르니 한 describe 안에서 섞지 않는다(restore도 각자 부른다).
describe("clickup fetch 경로 (@/test/fetch-mock)", () => {
  let mf: MockFetch | undefined;

  afterEach(() => {
    mf?.restore();
    mf = undefined;
  });

  const auth: ClickupAuth = {
    kind: "pat",
    pat: "pk_123",
    viewerId: "u1",
    viewerName: "Me",
  };

  describe("getMyself", () => {
    it("user 봉투를 벗기고 id를 문자열화한다", async () => {
      mf = mockFetchOnce({
        body: { user: { id: 4823, username: "hyeok", email: "h@example.com" } },
      });

      await expect(getMyself(auth)).resolves.toEqual({
        id: "4823",
        name: "hyeok",
        email: "h@example.com",
      });
      expect(mf.callAt(0).url).toBe("https://api.clickup.com/api/v2/user");
    });

    it("email이 null이면 undefined로 떨어뜨린다", async () => {
      mf = mockFetchOnce({ body: { user: { id: "9", username: "n", email: null } } });

      await expect(getMyself(auth)).resolves.toEqual({
        id: "9",
        name: "n",
        email: undefined,
      });
    });

    it("Authorization은 Bearer 없는 raw 토큰, Accept는 JSON", async () => {
      mf = mockFetchOnce({ body: { user: { id: "1", username: "n" } } });

      await getMyself(auth);
      const headers = mf.callAt(0).init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("pk_123");
      expect(headers.Accept).toBe("application/json");
    });
  });

  describe("getTeams", () => {
    it("teams를 id·name만 남겨 매핑한다", async () => {
      mf = mockFetchOnce({
        body: {
          teams: [
            { id: "t1", name: "Design", color: "#fff" },
            { id: "t2", name: "Eng", avatar: null },
          ],
        },
      });

      await expect(getTeams(auth)).resolves.toEqual([
        { id: "t1", name: "Design" },
        { id: "t2", name: "Eng" },
      ]);
      expect(mf.callAt(0).url).toBe("https://api.clickup.com/api/v2/team");
    });
  });

  describe("getLists", () => {
    const spaceId = "sp ace/1";

    function routes() {
      return mockFetchRoutes([
        {
          // 쿼리스트링을 match에 넣지 않는다 — archived=false를 지우는 뮤테이션이 "라우트
          // 미매칭 throw"로 새면 실패 이유가 URL이 아니라 목 설정으로 오진된다.
          match: "/list",
          respond: { body: { lists: [{ id: "l1", name: "Free", archived: false }] } },
        },
        {
          match: "/folder",
          respond: {
            body: {
              folders: [{ name: "Sprint", lists: [{ id: "l2", name: "InFolder" }] }],
            },
          },
        },
      ]);
    }

    it("folderless list와 folder를 병렬 조회해 평탄화한다", async () => {
      mf = routes();

      await expect(getLists(auth, spaceId)).resolves.toEqual([
        { id: "l1", name: "Free" },
        { id: "l2", name: "InFolder", folderName: "Sprint" },
      ]);
      expect(mf.fn).toHaveBeenCalledTimes(2);
    });

    it("spaceId는 두 경로 모두에서 인코딩된다", async () => {
      mf = routes();

      await getLists(auth, spaceId);
      expect(mf.callAt(0).url).toContain("/space/sp%20ace%2F1/list");
      expect(mf.callAt(1).url).toContain("/space/sp%20ace%2F1/folder");
      expect(mf.callAt(0).url).not.toContain("sp ace/1");
    });

    it("두 경로 모두 archived=false를 붙인다", async () => {
      mf = routes();

      await getLists(auth, spaceId);
      expect(mf.callAt(0).url).toContain("?archived=false");
      expect(mf.callAt(1).url).toContain("?archived=false");
    });
  });

  describe("getMembers", () => {
    const body = {
      teams: [
        { id: "t1", members: [{ user: { id: 1, username: "a", email: "a@x.com" } }] },
        {
          id: "t2",
          members: [
            { user: { id: 2, username: "b", email: null } },
            { user: { id: 3, username: "c" } },
          ],
        },
      ],
    };

    it("teamId는 URL이 아니라 /team 응답에서 골라낸다", async () => {
      mf = mockFetchOnce({ body });

      await expect(getMembers(auth, "t2")).resolves.toEqual([
        { id: "2", name: "b", email: undefined },
        { id: "3", name: "c", email: undefined },
      ]);
      expect(mf.callAt(0).url).toBe("https://api.clickup.com/api/v2/team");
      expect(mf.callAt(0).url).not.toContain("t2");
    });

    it("teamId가 응답에 없으면 빈 배열", async () => {
      mf = mockFetchOnce({ body });

      await expect(getMembers(auth, "t9")).resolves.toEqual([]);
    });
  });

  describe("createTask", () => {
    it("listId를 인코딩한 경로로 POST하고 매퍼 출력을 그대로 싣는다", async () => {
      mf = mockFetchOnce({
        body: { id: "86xyz", url: "https://app.clickup.com/t/86xyz", name: "무시" },
      });

      await expect(
        createTask(auth, {
          listId: "li st#1",
          name: "정렬 깨짐",
          markdownContent: "## 재현",
          assignees: ["77"],
        }),
      ).resolves.toEqual({ id: "86xyz", url: "https://app.clickup.com/t/86xyz" });

      const { url, init } = mf.callAt(0);
      expect(url).toContain("/list/li%20st%231/task");
      expect(init?.method).toBe("POST");
      expect(mf.jsonBodyAt(0)).toEqual({
        name: "정렬 깨짐",
        markdown_content: "## 재현",
        assignees: [77],
      });
      expect((init?.headers as Record<string, string>)["Content-Type"]).toBe(
        "application/json",
      );
    });
  });

  describe("uploadAttachment", () => {
    it("attachment 필드에 파일명을 붙여 multipart로 올린다", async () => {
      mf = mockFetchOnce({ body: { url: "https://cdn.clickup.com/a.png" } });

      await expect(
        uploadAttachment(
          auth,
          "86a b",
          "스크린샷.png",
          new Blob(["png-bytes"], { type: "image/png" }),
        ),
      ).resolves.toEqual({ url: "https://cdn.clickup.com/a.png" });

      expect(mf.callAt(0).url).toContain("/task/86a%20b/attachment");
      const file = mf.formDataAt(0).get("attachment") as File;
      expect(file.name).toBe("스크린샷.png");
      await expect(file.text()).resolves.toBe("png-bytes");
    });

    it("FormData 본문에는 Content-Type을 직접 붙이지 않는다 (boundary 파괴 방지)", async () => {
      mf = mockFetchOnce({ body: {} });

      await uploadAttachment(auth, "86a", "a.png", new Blob(["x"]));
      const headers = mf.callAt(0).init?.headers as Record<string, string>;
      expect(headers["Content-Type"]).toBeUndefined();
      expect(headers.Accept).toBe("application/json");
    });

    it("응답에 url이 없으면 undefined", async () => {
      mf = mockFetchOnce({ body: {} });

      await expect(uploadAttachment(auth, "86a", "a.png", new Blob(["x"]))).resolves.toEqual({
        url: undefined,
      });
    });
  });

  describe("updateTaskMarkdown", () => {
    it("markdown_content만 담아 PUT한다", async () => {
      mf = mockFetchOnce({ status: 204 });

      await expect(updateTaskMarkdown(auth, "86a/b", "새 본문")).resolves.toBeUndefined();
      expect(mf.callAt(0).url).toContain("/task/86a%2Fb");
      expect(mf.callAt(0).init?.method).toBe("PUT");
      expect(mf.jsonBodyAt(0)).toEqual({ markdown_content: "새 본문" });
    });
  });

  describe("getTaskStatus", () => {
    it("raw task를 normalizeTaskStatus로 통과시킨다", async () => {
      mf = mockFetchOnce({
        body: {
          id: "86c",
          name: "Task C",
          url: "https://app.clickup.com/t/86c",
          status: { status: "Complete", type: "closed" },
          list: { id: "l1" },
        },
      });

      await expect(getTaskStatus(auth, "86c")).resolves.toEqual({
        id: "86c",
        name: "Task C",
        completed: true,
        url: "https://app.clickup.com/t/86c",
      });
      expect(mf.callAt(0).url).toContain("/task/86c");
    });
  });

  describe("setTaskCompleted", () => {
    const task = {
      id: "86d",
      name: "Task D",
      url: "https://app.clickup.com/t/86d",
      status: { status: "to do", type: "open" },
      list: { id: "l 1" },
    };
    const statuses = [
      { status: "to do", type: "open" },
      { status: "complete", type: "done" },
    ];

    function routes(listBody: unknown) {
      return mockFetchRoutes([
        { match: "/list/", respond: { body: listBody } },
        {
          match: "/task/",
          respond: [
            { body: task },
            {
              body: {
                ...task,
                status: { status: "complete", type: "done" },
              },
            },
          ],
        },
      ]);
    }

    it("완료 요청은 list의 done 타입 status 이름으로 PUT한다", async () => {
      mf = routes({ statuses });

      await expect(setTaskCompleted(auth, "86d", true)).resolves.toEqual({
        id: "86d",
        name: "Task D",
        completed: true,
        url: "https://app.clickup.com/t/86d",
      });

      expect(mf.fn).toHaveBeenCalledTimes(3);
      expect(mf.callAt(1).url).toContain("/list/l%201");
      expect(mf.callAt(2).init?.method).toBe("PUT");
      expect(mf.jsonBodyAt(2)).toEqual({ status: "complete" });
    });

    it("해제 요청은 done·closed가 아닌 첫 status로 PUT한다", async () => {
      mf = routes({ statuses });

      await setTaskCompleted(auth, "86d", false);
      expect(mf.jsonBodyAt(2)).toEqual({ status: "to do" });
    });

    it("task에 list가 없으면 list 조회 없이 매핑 실패로 끝난다", async () => {
      mf = mockFetchRoutes([
        { match: "/task/", respond: { body: { ...task, list: undefined } } },
      ]);

      await expect(setTaskCompleted(auth, "86d", true)).rejects.toMatchObject({
        name: "ClickupError",
        status: 400,
        message: "clickup.error.statusMappingFailed",
      });
      expect(mf.fn).toHaveBeenCalledTimes(1);
    });

    it("list에 statuses 키가 없으면 매핑 실패 (PUT을 보내지 않는다)", async () => {
      mf = routes({});

      await expect(setTaskCompleted(auth, "86d", true)).rejects.toBeInstanceOf(
        ClickupError,
      );
      expect(mf.fn).toHaveBeenCalledTimes(2);
    });
  });

  describe("에러 전파", () => {
    it("404 본문의 err·ECODE를 상태 메시지 뒤에 붙인다", async () => {
      mf = mockFetchOnce({
        status: 404,
        body: { err: "Task not found", ECODE: "ITEM_013" },
      });

      await expect(getTaskStatus(auth, "86z")).rejects.toMatchObject({
        name: "ClickupError",
        status: 404,
        message: "clickup.error.404\nTask not found\nITEM_013",
      });
    });

    it("JSON이 아닌 500 본문은 원문으로 읽히고 detail은 붙지 않는다", async () => {
      mf = mockFetchOnce({ status: 500, body: "<html>oops</html>" });

      await expect(getTeams(auth)).rejects.toMatchObject({
        status: 500,
        message: "clickup.error.5xx",
        body: "<html>oops</html>",
      });
    });

    it("본문 읽기 자체가 실패해도 상태 메시지는 나온다", async () => {
      mf = mockFetchOnce({ status: 401, body: new Error("stream closed") });

      await expect(getMyself(auth)).rejects.toMatchObject({
        status: 401,
        message: "clickup.oauthRevoked",
        body: undefined,
      });
    });
  });
});
