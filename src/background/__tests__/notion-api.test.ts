import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildNotionAuthHeader,
  expandBlock,
  footerBlockObjects,
  listUsers,
  messageForNotionStatus,
  parseDatabaseSchema,
  parsePageStatus,
  richText,
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
