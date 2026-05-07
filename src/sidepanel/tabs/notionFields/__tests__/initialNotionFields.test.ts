import { describe, expect, it } from "vitest";
import { initialNotionFields } from "../NotionIssueFields";

describe("initialNotionFields — 우선순위 룰", () => {
  it("last가 있으면 last 우선", () => {
    const out = initialNotionFields(
      {
        databaseId: "last-db",
        databaseTitle: "Last DB",
        statusOption: "Done",
        selectValues: [{ propertyName: "Sev", type: "select", options: ["P1"] }],
      },
      { databaseId: "default-db", databaseTitle: "Default" },
    );
    expect(out.databaseId).toBe("last-db");
    expect(out.databaseTitle).toBe("Last DB");
    expect(out.statusOption).toBe("Done");
    expect(out.selectValues).toHaveLength(1);
  });

  it("last 없으면 defaults (status/select 포함)", () => {
    const out = initialNotionFields(undefined, {
      databaseId: "default-db",
      databaseTitle: "Default",
      statusOption: "To Do",
      selectValues: [
        { propertyName: "Sev", type: "select", options: ["P1"] },
      ],
    });
    expect(out.databaseId).toBe("default-db");
    expect(out.databaseTitle).toBe("Default");
    expect(out.statusOption).toBe("To Do");
    expect(out.selectValues).toEqual([
      { propertyName: "Sev", type: "select", options: ["P1"] },
    ]);
  });

  it("last의 databaseId가 defaults와 같으면 defaults가 fallback", () => {
    const out = initialNotionFields(
      { databaseId: "same-db" },
      {
        databaseId: "same-db",
        databaseTitle: "Same",
        statusOption: "To Do",
        selectValues: [
          { propertyName: "Sev", type: "select", options: ["P1"] },
        ],
      },
    );
    expect(out.databaseTitle).toBe("Same");
    expect(out.statusOption).toBe("To Do");
    expect(out.selectValues).toHaveLength(1);
  });

  it("last의 databaseId가 defaults와 다르면 defaults는 무시", () => {
    const out = initialNotionFields(
      { databaseId: "last-db", statusOption: "Done" },
      {
        databaseId: "other-db",
        statusOption: "To Do",
        selectValues: [
          { propertyName: "Sev", type: "select", options: ["P1"] },
        ],
      },
    );
    expect(out.databaseId).toBe("last-db");
    expect(out.statusOption).toBe("Done");
    expect(out.selectValues).toEqual([]);
  });

  it("last에 databaseId만 있고 selectValues 없으면 빈 배열로 초기화", () => {
    const out = initialNotionFields(
      { databaseId: "last-db" },
      undefined,
    );
    expect(out.databaseId).toBe("last-db");
    expect(out.selectValues).toEqual([]);
  });

  it("last/defaults 모두 없으면 빈 값", () => {
    const out = initialNotionFields(undefined, undefined);
    expect(out.databaseId).toBeUndefined();
    expect(out.selectValues).toEqual([]);
  });
});
