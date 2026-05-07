import { describe, expect, it } from "vitest";
import {
  buildNotionAuthHeader,
  messageForNotionStatus,
  parseDatabaseSchema,
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
