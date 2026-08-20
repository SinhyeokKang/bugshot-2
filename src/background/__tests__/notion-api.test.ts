import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetchOnce, mockFetchRoutes, type MockFetch } from "@/test/fetch-mock";
import type { NotionCreatePagePayload } from "@/types/notion";
import { OAuthError } from "../oauth";
import {
  buildNotionAuthHeader,
  createFileUpload,
  createPage,
  // notionFetch·dataUrlToBlob은 아직 export가 아니다 — /implement에서 export를 추가한다.
  dataUrlToBlob,
  expandBlock,
  footerBlockObjects,
  getDatabaseSchema,
  getMyself,
  getPageStatus,
  listUsers,
  messageForNotionStatus,
  NotionError,
  notionFetch,
  parseDatabaseSchema,
  parsePageStatus,
  richText,
  searchDatabases,
  sendFileUpload,
  updatePageStatus,
  uploadFile,
} from "../notion-api";

describe("buildNotionAuthHeader", () => {
  it("API Key는 'Bearer <token>'", () => {
    expect(
      buildNotionAuthHeader({
        kind: "apiKey",
        token: "secret_x",
        botName: "Bot",
      }),
    ).toBe("Bearer secret_x");
  });

  it("OAuth는 'Bearer <accessToken>'", () => {
    expect(
      buildNotionAuthHeader({
        kind: "oauth",
        accessToken: "ATK",
        botId: "b",
        workspaceId: "w",
        workspaceName: "W",
        botName: "Bot",
        grantedAt: 1,
      }),
    ).toBe("Bearer ATK");
  });
});

describe("messageForNotionStatus", () => {
  it("주요 상태 코드별 비어있지 않은 메시지 반환", () => {
    expect(messageForNotionStatus(401)).toBeTruthy();
    expect(messageForNotionStatus(403)).toBeTruthy();
    expect(messageForNotionStatus(404)).toBeTruthy();
    expect(messageForNotionStatus(429)).toBeTruthy();
    expect(messageForNotionStatus(500)).toBeTruthy();
    expect(messageForNotionStatus(502)).toBeTruthy();
  });

  it("알려지지 않은 상태 코드는 generic 메시지에 코드 포함", () => {
    expect(messageForNotionStatus(418)).toContain("418");
  });
});

describe("parseDatabaseSchema", () => {
  it("title/status/select/multi_select 추출 + 다른 type 무시", () => {
    const schema = parseDatabaseSchema({
      id: "db1",
      title: [{ plain_text: "Bugs" }],
      properties: {
        Name: { id: "title", name: "Name", type: "title" },
        Status: {
          id: "s",
          name: "Status",
          type: "status",
          status: {
            options: [
              { id: "1", name: "To Do", color: "gray" },
              { id: "2", name: "Done", color: "green" },
            ],
          },
        },
        Severity: {
          id: "sev",
          name: "Severity",
          type: "select",
          select: {
            options: [{ id: "10", name: "P1", color: "red" }],
          },
        },
        Tags: {
          id: "tg",
          name: "Tags",
          type: "multi_select",
          multi_select: {
            options: [{ id: "20", name: "frontend", color: "blue" }],
          },
        },
        Note: { id: "rt", name: "Note", type: "rich_text" },
        Due: { id: "dt", name: "Due", type: "date" },
      },
    });
    expect(schema.id).toBe("db1");
    expect(schema.title).toBe("Bugs");
    expect(schema.titlePropertyName).toBe("Name");
    expect(schema.statusProperty?.options?.length).toBe(2);
    expect(schema.selectProperties.map((p) => p.name).sort()).toEqual([
      "Severity",
      "Tags",
    ]);
    expect(schema.selectProperties.find((p) => p.name === "Severity")?.type).toBe(
      "select",
    );
    expect(schema.selectProperties.find((p) => p.name === "Tags")?.type).toBe(
      "multi_select",
    );
  });

  it("title이 비어있으면 fallback 라벨", () => {
    const schema = parseDatabaseSchema({
      id: "db2",
      properties: {
        Name: { id: "t", name: "Name", type: "title" },
      },
    });
    expect(schema.title).toBeTruthy();
  });

  it("statusProperty 없는 DB → undefined, selectProperties 빈 배열도 허용", () => {
    const schema = parseDatabaseSchema({
      id: "db3",
      title: [{ plain_text: "Notes" }],
      properties: {
        Name: { id: "t", name: "Name", type: "title" },
        Body: { id: "b", name: "Body", type: "rich_text" },
      },
    });
    expect(schema.statusProperty).toBeUndefined();
    expect(schema.selectProperties).toEqual([]);
    expect(schema.titlePropertyName).toBe("Name");
  });

  it("title 프로퍼티가 'Title' 같은 다른 이름이어도 추출", () => {
    const schema = parseDatabaseSchema({
      id: "db4",
      properties: {
        "이름": { id: "x", name: "이름", type: "title" },
      },
    });
    expect(schema.titlePropertyName).toBe("이름");
  });
});

describe("parsePageStatus", () => {
  it("title rich_text 배열을 plain_text join으로 추출", () => {
    const out = parsePageStatus({
      id: "p1",
      url: "https://www.notion.so/x-abc",
      last_edited_time: "2026-01-01T00:00:00.000Z",
      properties: {
        Name: {
          id: "title",
          type: "title",
          title: [{ plain_text: "Hello " }, { plain_text: "World" }],
        },
      },
    });
    expect(out.title).toBe("Hello World");
    expect(out.pageId).toBe("p1");
    expect(out.statusOption).toBeUndefined();
  });

  it("status property 동시 추출", () => {
    const out = parsePageStatus({
      id: "p2",
      url: "https://www.notion.so/x",
      last_edited_time: "2026-01-01T00:00:00.000Z",
      properties: {
        Title: {
          id: "t",
          type: "title",
          title: [{ plain_text: "버그" }],
        },
        State: {
          id: "s",
          type: "status",
          status: { name: "In Progress", color: "blue" },
        },
      },
    });
    expect(out.title).toBe("버그");
    expect(out.statusOption).toEqual({ name: "In Progress", color: "blue" });
  });

  it("title이 모두 빈 plain_text면 undefined (trim 후)", () => {
    const out = parsePageStatus({
      id: "p3",
      url: "https://www.notion.so/x",
      last_edited_time: "2026-01-01T00:00:00.000Z",
      properties: {
        Name: { id: "t", type: "title", title: [{ plain_text: "  " }] },
      },
    });
    expect(out.title).toBeUndefined();
  });

  it("title property 없으면 title undefined, status만 추출", () => {
    const out = parsePageStatus({
      id: "p4",
      url: "https://www.notion.so/x",
      last_edited_time: "2026-01-01T00:00:00.000Z",
      properties: {
        State: {
          id: "s",
          type: "status",
          status: { name: "Done", color: "green" },
        },
      },
    });
    expect(out.title).toBeUndefined();
    expect(out.statusOption).toEqual({ name: "Done", color: "green" });
  });
});

describe("footerBlockObjects — Reported via *BugShot* (HR + italic)", () => {
  it("순서: divider → paragraph(italic) with BugShot 링크", () => {
    const out = footerBlockObjects();
    expect(out).toEqual([
      { object: "block", type: "divider", divider: {} },
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              type: "text",
              text: { content: "Reported via " },
              annotations: { italic: true },
            },
            {
              type: "text",
              text: { content: "BugShot", link: { url: "https://bug-shot.com" } },
              annotations: { italic: true },
            },
          ],
        },
      },
    ]);
  });
});

describe("listUsers", () => {
  const auth = { kind: "apiKey", token: "secret_x", botName: "Bot" } as const;

  function pageResponse(body: unknown): Response {
    return { ok: true, status: 200, json: async () => body } as Response;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("start_cursor 페이지네이션으로 전량 로드 + bot 필터", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        pageResponse({
          results: [
            { id: "u1", type: "person", name: "Alice", avatar_url: "https://a/1.png" },
            { id: "b1", type: "bot", name: "BugShot Bot" },
          ],
          has_more: true,
          next_cursor: "cur2",
        }),
      )
      .mockResolvedValueOnce(
        pageResponse({
          results: [{ id: "u2", type: "person", name: "Bob", avatar_url: null }],
          has_more: false,
          next_cursor: null,
        }),
      );
    vi.stubGlobal("fetch", f);

    const users = await listUsers(auth);

    expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls[0][0]).toContain("/users?page_size=100");
    expect(f.mock.calls[1][0]).toContain("start_cursor=cur2");
    expect(users).toEqual([
      { id: "u1", name: "Alice", avatarUrl: "https://a/1.png" },
      { id: "u2", name: "Bob", avatarUrl: undefined },
    ]);
  });

  it("has_more=false 단일 페이지면 1회 호출", async () => {
    const f = vi.fn().mockResolvedValue(
      pageResponse({
        results: [{ id: "u1", type: "person", name: "Alice" }],
        has_more: false,
        next_cursor: null,
      }),
    );
    vi.stubGlobal("fetch", f);

    const users = await listUsers(auth);
    expect(f).toHaveBeenCalledTimes(1);
    expect(users).toHaveLength(1);
  });
});

describe("expandBlock mention_paragraph", () => {
  it('"cc " 텍스트 + user mention rich text(쉼표 구분)로 전개', () => {
    expect(
      expandBlock(
        { type: "mention_paragraph", userIds: ["id1", "id2"] },
        new Map(),
      ),
    ).toEqual({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [
          { type: "text", text: { content: "cc " } },
          { type: "mention", mention: { user: { id: "id1" } } },
          { type: "text", text: { content: ", " } },
          { type: "mention", mention: { user: { id: "id2" } } },
        ],
      },
    });
  });
});

describe("richText", () => {
  it("빈 문자열은 빈 배열", () => {
    expect(richText("")).toEqual([]);
  });

  it("2000자 이하는 단일 원소(기존과 동형)", () => {
    const s = "a".repeat(2000);
    expect(richText(s)).toEqual([{ type: "text", text: { content: s } }]);
  });

  it("2001자는 2000 + 1로 분할", () => {
    const s = "a".repeat(2001);
    expect(richText(s)).toEqual([
      { type: "text", text: { content: "a".repeat(2000) } },
      { type: "text", text: { content: "a" } },
    ]);
  });

  it("2000자 경계에 걸친 이모지를 서로게이트 페어로 쪼개지 않는다", () => {
    // 1999자 + 이모지(코드유닛 2) → 코드유닛 slice면 2000번째에서 페어가 갈린다.
    const s = "a".repeat(1999) + "😀" + "b";
    const out = richText(s);

    expect(out.map((rt) => rt.text.content).join("")).toBe(s);
    for (const rt of out) {
      expect(rt.text.content).not.toMatch(/[\uD800-\uDBFF]$/);
      expect(rt.text.content).not.toMatch(/^[\uDC00-\uDFFF]/);
    }
  });

  it("16384자는 9청크로 분할되고 원문이 보존된다", () => {
    const s = "b".repeat(16384);
    const out = richText(s);
    expect(out).toHaveLength(9);
    expect(out.every((rt) => rt.text.content.length <= 2000)).toBe(true);
    expect(out.map((rt) => rt.text.content).join("")).toBe(s);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fetch 경로. 위 describe("listUsers")는 로컬 목(vi.stubGlobal + 응답 리터럴)을 쓰고
// 여기부터는 공용 @/test/fetch-mock을 쓴다 — 실패 모드가 둘이다(로컬 목은 큐 고갈 시
// undefined 응답으로 죽고, 공용 목은 라우트 미매칭이면 throw한다).
// ─────────────────────────────────────────────────────────────────────────────

const AUTH = { kind: "apiKey", token: "secret_x", botName: "Bot" } as const;

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}

describe("notion fetch 경로 (@/test/fetch-mock)", () => {
  let mf: MockFetch;

  afterEach(() => {
    mf?.restore();
  });

  describe("getMyself", () => {
    it("GET /users/me + 공통 헤더, body 없음", async () => {
      mf = mockFetchOnce({
        body: {
          type: "bot",
          name: "BugShot",
          bot: {
            workspace_name: "Acme",
            owner: {
              type: "user",
              user: { name: "Alice", person: { email: "alice@acme.test" } },
            },
          },
        },
      });

      const me = await getMyself(AUTH);

      const { url, init } = mf.callAt(0);
      expect(new URL(url).origin).toBe("https://api.notion.com");
      expect(new URL(url).pathname).toBe("/v1/users/me");
      expect(init?.method).toBe("GET");
      expect(headersOf(init).Authorization).toBe("Bearer secret_x");
      expect(headersOf(init)["Notion-Version"]).toBe("2022-06-28");
      // body가 없으면 Content-Type도 안 붙는다.
      expect(headersOf(init)["Content-Type"]).toBeUndefined();
      expect(init?.body).toBeUndefined();
      expect(me).toEqual({
        botName: "BugShot",
        workspaceName: "Acme",
        ownerUserName: "Alice",
        ownerUserEmail: "alice@acme.test",
      });
    });

    it("name·bot 정보가 없으면 botName 기본값 + 나머지 undefined", async () => {
      mf = mockFetchOnce({ body: { type: "bot" } });

      expect(await getMyself(AUTH)).toEqual({
        botName: "Notion bot",
        workspaceName: undefined,
        ownerUserName: undefined,
        ownerUserEmail: undefined,
      });
    });
  });

  describe("searchDatabases", () => {
    it("POST /search — query·filter·page_size를 body로 싣고 JSON Content-Type", async () => {
      mf = mockFetchOnce({
        body: {
          results: [
            {
              id: "d1",
              title: [{ plain_text: "Bug " }, { plain_text: "Tracker" }],
              icon: { type: "emoji", emoji: "🐛" },
            },
          ],
        },
      });

      const out = await searchDatabases(AUTH, "bug");

      const { url, init } = mf.callAt(0);
      expect(new URL(url).pathname).toBe("/v1/search");
      expect(new URL(url).search).toBe("");
      expect(init?.method).toBe("POST");
      expect(headersOf(init)["Content-Type"]).toBe("application/json");
      expect(mf.jsonBodyAt(0)).toEqual({
        query: "bug",
        filter: { value: "database", property: "object" },
        page_size: 20,
      });
      expect(out).toEqual([{ id: "d1", title: "Bug Tracker", iconEmoji: "🐛" }]);
    });

    it("emoji가 아닌 icon은 iconEmoji undefined, 빈 title은 대체 라벨", async () => {
      mf = mockFetchOnce({
        body: {
          results: [
            { id: "d2", title: [], icon: { type: "external" } },
            { id: "d3" },
          ],
        },
      });

      const out = await searchDatabases(AUTH, "");
      expect(out[0].iconEmoji).toBeUndefined();
      expect(out[0].title).toBeTruthy();
      expect(out[1].title).toBe(out[0].title);
    });
  });

  describe("getDatabaseSchema — 경로 인코딩", () => {
    it("databaseId의 /·공백·?를 percent-encode해서 경로 조각 하나로 유지", async () => {
      mf = mockFetchOnce({
        body: {
          id: "db/1",
          title: [{ plain_text: "Bugs" }],
          properties: { "이름": { id: "t", name: "이름", type: "title" } },
        },
      });

      const schema = await getDatabaseSchema(AUTH, "db/1 x?q=2");

      const { url } = mf.callAt(0);
      expect(url).toBe("https://api.notion.com/v1/databases/db%2F1%20x%3Fq%3D2");
      // ?가 살아있으면 쿼리로 잘려 databaseId가 반토막 난다.
      expect(new URL(url).search).toBe("");
      expect(new URL(url).pathname.split("/")).toHaveLength(4);
      expect(schema.titlePropertyName).toBe("이름");
      expect(schema.title).toBe("Bugs");
    });
  });

  describe("getPageStatus / updatePageStatus", () => {
    const pageRaw = {
      id: "PG1",
      url: "https://www.notion.so/PG1",
      last_edited_time: "2026-01-01T00:00:00.000Z",
      properties: {
        Name: { id: "t", type: "title", title: [{ plain_text: "버그" }] },
        State: { id: "s", type: "status", status: { name: "To Do", color: "gray" } },
      },
    };

    it("getPageStatus는 GET /pages/<encoded> + parsePageStatus 배선", async () => {
      mf = mockFetchOnce({ body: pageRaw });

      const out = await getPageStatus(AUTH, "PG 1/2");

      const { url, init } = mf.callAt(0);
      expect(url).toBe("https://api.notion.com/v1/pages/PG%201%2F2");
      expect(init?.method).toBe("GET");
      expect(out).toEqual({
        pageId: "PG1",
        url: "https://www.notion.so/PG1",
        title: "버그",
        statusOption: { name: "To Do", color: "gray" },
        lastEditedTime: Date.UTC(2026, 0, 1),
      });
    });

    it("updatePageStatus는 PATCH + properties.<이름>.status.name만 싣는다", async () => {
      mf = mockFetchOnce({
        body: {
          ...pageRaw,
          properties: {
            ...pageRaw.properties,
            State: { id: "s", type: "status", status: { name: "Done", color: "green" } },
          },
        },
      });

      const out = await updatePageStatus(AUTH, "PG1", "State", "Done");

      const { url, init } = mf.callAt(0);
      expect(new URL(url).pathname).toBe("/v1/pages/PG1");
      expect(init?.method).toBe("PATCH");
      expect(mf.jsonBodyAt(0)).toEqual({
        properties: { State: { status: { name: "Done" } } },
      });
      expect(out.statusOption).toEqual({ name: "Done", color: "green" });
    });
  });

  describe("파일 업로드 3단 (createFileUpload → sendFileUpload → uploadFile)", () => {
    it("createFileUpload: POST /file_uploads, filename·content_type을 snake_case로", async () => {
      mf = mockFetchOnce({
        body: {
          id: "FU1",
          upload_url: "https://file.notion.so/send/FU1",
          expiry_time: "2026-02-03T04:05:06.000Z",
        },
      });

      const out = await createFileUpload(AUTH, "shot.png", "image/png");

      expect(new URL(mf.callAt(0).url).pathname).toBe("/v1/file_uploads");
      expect(mf.callAt(0).init?.method).toBe("POST");
      expect(mf.jsonBodyAt(0)).toEqual({
        filename: "shot.png",
        content_type: "image/png",
      });
      expect(out).toEqual({
        id: "FU1",
        uploadUrl: "https://file.notion.so/send/FU1",
        expiresAt: Date.UTC(2026, 1, 3, 4, 5, 6),
      });
    });

    it("sendFileUpload: uploadUrl 그대로 POST + multipart 'file' 파트, Content-Type은 안 붙인다", async () => {
      mf = mockFetchOnce({});

      await sendFileUpload(
        AUTH,
        "https://file.notion.so/send/FU1",
        "shot.png",
        `data:image/png;base64,${btoa("PNGDATA")}`,
        "image/png",
      );

      const { url, init } = mf.callAt(0);
      // API base(/v1)를 앞에 붙이면 안 된다 — createFileUpload가 준 절대 URL이다.
      expect(url).toBe("https://file.notion.so/send/FU1");
      expect(init?.method).toBe("POST");
      expect(headersOf(init).Authorization).toBe("Bearer secret_x");
      expect(headersOf(init)["Notion-Version"]).toBe("2022-06-28");
      // 직접 지정하면 boundary가 빠져 Notion이 파트를 못 읽는다.
      expect(headersOf(init)["Content-Type"]).toBeUndefined();

      const file = mf.formDataAt(0).get("file") as File;
      expect(file.name).toBe("shot.png");
      expect(file.type).toBe("image/png");
      expect(await file.text()).toBe("PNGDATA");
    });

    it("sendFileUpload: declaredContentType이 없으면 dataUrl의 mime이 파트 타입", async () => {
      mf = mockFetchOnce({});

      await sendFileUpload(AUTH, "https://file.notion.so/send/FU2", "a.txt", "data:text/plain;base64,aGk=");

      const file = mf.formDataAt(0).get("file") as File;
      expect(file.type).toBe("text/plain");
      expect(await file.text()).toBe("hi");
    });

    it("uploadFile: 2회 호출로 create→send를 잇고 create 응답의 upload_url을 따라간다", async () => {
      mf = mockFetchRoutes([
        {
          match: "/v1/file_uploads",
          respond: {
            body: {
              id: "FU9",
              upload_url: "https://file.notion.so/send/FU9",
              expiry_time: "2026-03-04T00:00:00.000Z",
            },
          },
        },
        { match: "file.notion.so/send/", respond: {} },
      ]);

      const out = await uploadFile(
        AUTH,
        "log.json",
        "application/json",
        `data:application/json;base64,${btoa('{"a":1}')}`,
      );

      expect(mf.fn).toHaveBeenCalledTimes(2);
      expect(mf.jsonBodyAt(0)).toEqual({
        filename: "log.json",
        content_type: "application/json",
      });
      expect(mf.callAt(1).url).toBe("https://file.notion.so/send/FU9");
      const file = mf.formDataAt(1).get("file") as File;
      expect(file.name).toBe("log.json");
      expect(file.type).toBe("application/json");
      expect(await file.text()).toBe('{"a":1}');
      expect(out).toEqual({
        fileUploadId: "FU9",
        expiresAt: Date.UTC(2026, 2, 4),
      });
    });

    it("sendFileUpload 실패는 notionFetch를 안 거치고도 NotionError로 전파", async () => {
      mf = mockFetchOnce({ status: 413, body: { code: "validation_error" } });

      const err = await sendFileUpload(
        AUTH,
        "https://file.notion.so/send/FU3",
        "big.mp4",
        "data:video/mp4;base64,AAAA",
      ).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(NotionError);
      expect((err as NotionError).status).toBe(413);
      expect((err as NotionError).body).toEqual({ code: "validation_error" });
      expect((err as NotionError).message).toBeTruthy();
    });
  });

  describe("createPage", () => {
    function payload(
      over: Partial<NotionCreatePagePayload> = {},
    ): NotionCreatePagePayload {
      return {
        databaseId: "DB1",
        title: "저장 버튼이 반응하지 않음",
        titlePropertyName: "이름",
        statusOption: { propertyName: "State", optionName: "To Do" },
        selectValues: [
          { propertyName: "Severity", type: "select", options: ["P1", "P2"] },
          { propertyName: "Tags", type: "multi_select", options: ["fe", "be"] },
          { propertyName: "Empty", type: "select", options: [] },
        ],
        blocks: [{ type: "paragraph", text: "본문" }],
        attachments: [],
        ...over,
      };
    }

    it("POST /pages — parent·properties 매핑과 결과 봉투", async () => {
      mf = mockFetchOnce({
        body: { id: "PG1", url: "https://www.notion.so/PG1" },
      });

      const out = await createPage(AUTH, payload());

      expect(new URL(mf.callAt(0).url).pathname).toBe("/v1/pages");
      expect(mf.callAt(0).init?.method).toBe("POST");
      const body = mf.jsonBodyAt(0) as {
        parent: unknown;
        properties: Record<string, unknown>;
        children: unknown[];
      };
      expect(body.parent).toEqual({ database_id: "DB1" });
      expect(body.properties["이름"]).toEqual({
        title: [{ type: "text", text: { content: "저장 버튼이 반응하지 않음" } }],
      });
      expect(body.properties.State).toEqual({ status: { name: "To Do" } });
      // select는 첫 옵션 하나, multi_select는 전량, 빈 옵션 필드는 키 자체가 없다.
      expect(body.properties.Severity).toEqual({ select: { name: "P1" } });
      expect(body.properties.Tags).toEqual({
        multi_select: [{ name: "fe" }, { name: "be" }],
      });
      expect(Object.keys(body.properties).sort()).toEqual([
        "Severity",
        "State",
        "Tags",
        "이름",
      ]);
      expect(out).toEqual({ pageId: "PG1", url: "https://www.notion.so/PG1" });
    });

    it("statusOption이 없으면 status 프로퍼티를 안 만든다", async () => {
      mf = mockFetchOnce({ body: { id: "PG2", url: "u" } });

      await createPage(AUTH, payload({ statusOption: undefined, selectValues: [] }));

      const body = mf.jsonBodyAt(0) as { properties: Record<string, unknown> };
      expect(Object.keys(body.properties)).toEqual(["이름"]);
    });

    it("children이 100개를 넘으면 잘라 보내고 경고를 남긴다", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      mf = mockFetchOnce({ body: { id: "PG3", url: "u" } });

      const blocks = Array.from({ length: 120 }, (_, i) => ({
        type: "paragraph" as const,
        text: `line ${i}`,
      }));
      await createPage(AUTH, payload({ blocks }));

      const body = mf.jsonBodyAt(0) as { children: { type: string }[] };
      expect(body.children).toHaveLength(100);
      expect(body.children[0]).toEqual({
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: [{ type: "text", text: { content: "line 0" } }] },
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("122");
      warn.mockRestore();
    });
  });

  describe("에러 전파", () => {
    it("401은 NotionError가 아니라 OAuthError(refreshFailed + profile_fetch_failed)", async () => {
      mf = mockFetchOnce({ status: 401, body: { code: "unauthorized" } });

      const err = await getMyself(AUTH).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(OAuthError);
      expect(err).not.toBeInstanceOf(NotionError);
      expect((err as OAuthError).platform).toBe("notion");
      expect((err as OAuthError).refreshFailed).toBe(true);
      expect((err as OAuthError).reason).toBe("profile_fetch_failed");
      expect(mf.fn).toHaveBeenCalledTimes(1);
    });

    it("4xx는 status·본문을 실은 NotionError", async () => {
      mf = mockFetchOnce({
        status: 404,
        body: { object: "error", code: "object_not_found" },
      });

      const err = await getDatabaseSchema(AUTH, "missing").catch((e: unknown) => e);

      expect(err).toBeInstanceOf(NotionError);
      expect((err as NotionError).status).toBe(404);
      expect((err as NotionError).body).toEqual({
        object: "error",
        code: "object_not_found",
      });
      expect((err as NotionError).name).toBe("NotionError");
    });

    it("에러 본문이 JSON이 아니면 body는 undefined이고 status는 유지", async () => {
      mf = mockFetchOnce({ status: 500, body: new Error("not json") });

      const err = await searchDatabases(AUTH, "x").catch((e: unknown) => e);

      expect(err).toBeInstanceOf(NotionError);
      expect((err as NotionError).status).toBe(500);
      expect((err as NotionError).body).toBeUndefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 아래 두 describe는 아직 export가 아닌 함수를 부른다 — /implement가 `export`를 붙이기 전까지
// red다(`typeof … is not a function`). 우회 export를 여기서 만들지 않는다.
// ─────────────────────────────────────────────────────────────────────────────

describe("notionFetch — 다른 함수로는 못 닿는 body 분기", () => {
  let mf: MockFetch;

  afterEach(() => {
    mf?.restore();
  });

  it("string body는 JSON.stringify하지 않고 원문 그대로 보낸다", async () => {
    mf = mockFetchOnce({ body: { ok: 1 } });

    await notionFetch(AUTH, "/raw", { method: "POST", body: '{"already":"json"}' });

    expect(mf.callAt(0).init?.body).toBe('{"already":"json"}');
    expect(headersOf(mf.callAt(0).init)["Content-Type"]).toBe("application/json");
  });

  it("FormData body는 그대로 싣고 Content-Type을 덮어쓰지 않는다", async () => {
    mf = mockFetchOnce({ body: {} });
    const form = new FormData();
    form.append("k", "v");

    await notionFetch(AUTH, "/form", {
      method: "POST",
      body: form,
      headers: { "Content-Type": "multipart/form-data; boundary=X" },
    });

    expect(mf.formDataAt(0).get("k")).toBe("v");
    expect(headersOf(mf.callAt(0).init)["Content-Type"]).toBe(
      "multipart/form-data; boundary=X",
    );
  });

  it("opts.headers가 공통 헤더에 합쳐진다", async () => {
    mf = mockFetchOnce({ body: {} });

    await notionFetch(AUTH, "/x", { headers: { "X-Trace": "t1" } });

    const h = headersOf(mf.callAt(0).init);
    expect(h["X-Trace"]).toBe("t1");
    expect(h.Authorization).toBe("Bearer secret_x");
    expect(h["Notion-Version"]).toBe("2022-06-28");
  });
});

// 저장소에 dataUrlToBlob 판본이 둘이다 — 여기(background/notion-api.ts:294)와
// store/blob-db.ts:735. 아래 3케이스가 갈리는 지점이고 반대편 단언은
// store/__tests__/blob-db.test.ts의 describe("dataUrlToBlob — notion 판본과 갈리는 입력")에 있다.
// 한쪽을 다른 쪽으로 바꿔 끼우려면 두 파일을 함께 본다.
describe("dataUrlToBlob — blob-db 판본과 갈리는 입력", () => {
  it("base64 payload를 바이트 그대로 복원하고 contentType을 함께 반환", async () => {
    const out = dataUrlToBlob(`data:image/png;base64,${btoa("PNG")}`);
    expect(out.contentType).toBe("image/png");
    expect(out.blob.type).toBe("image/png");
    expect(await out.blob.text()).toBe("PNG");
  });

  it("base64가 아닌 percent-encoded payload도 디코드한다 (blob-db 판본은 throw)", async () => {
    const out = dataUrlToBlob("data:text/plain,%ED%95%9C%EA%B8%80%20a");
    expect(out.contentType).toBe("text/plain");
    expect(await out.blob.text()).toBe("한글 a");
  });

  it("mime 없는 data URL은 throw (blob-db 판본은 type:\"\"로 성공)", () => {
    expect(() => dataUrlToBlob("data:;base64,QUJD")).toThrow("invalid dataUrl");
  });

  it("payload가 빈 data URL은 빈 Blob으로 성공 (blob-db 판본은 throw)", async () => {
    const out = dataUrlToBlob("data:text/plain;base64,");
    expect(out.blob.size).toBe(0);
    expect(out.contentType).toBe("text/plain");
  });

  it("charset이 섞인 mime은 charset을 떼고 mime만 남긴다 (blob-db 판본은 통째로 붙인다)", async () => {
    const out = dataUrlToBlob("data:text/plain;charset=utf-8;base64,aGk=");
    expect(out.contentType).toBe("text/plain");
    expect(await out.blob.text()).toBe("hi");
  });
});
