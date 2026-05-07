import { describe, expect, it } from "vitest";
import { reconcileNotionFields } from "../reconcileNotionFields";
import type { NotionDatabaseSchema } from "@/types/notion";

function schema(
  statusOptions: string[] | null,
  selectProperties: Array<{
    name: string;
    type: "select" | "multi_select";
    options: string[];
  }>,
): NotionDatabaseSchema {
  return {
    id: "db1",
    title: "DB",
    titlePropertyName: "Name",
    statusProperty: statusOptions
      ? {
          id: "s",
          name: "Status",
          type: "status",
          options: statusOptions.map((n, i) => ({
            id: `${i}`,
            name: n,
            color: "gray",
          })),
        }
      : undefined,
    selectProperties: selectProperties.map((p, i) => ({
      id: `p${i}`,
      name: p.name,
      type: p.type,
      options: p.options.map((n, j) => ({
        id: `${i}-${j}`,
        name: n,
        color: "blue",
      })),
    })),
  };
}

describe("reconcileNotionFields — statusOption", () => {
  it("schema에 옵션 있으면 보존", () => {
    const out = reconcileNotionFields(
      { statusOption: "Done", selectValues: [] },
      schema(["To Do", "Done"], []),
    );
    expect(out.statusOption).toBe("Done");
    expect(out.changed).toBe(false);
  });

  it("schema에서 옵션 사라지면 undefined + changed", () => {
    const out = reconcileNotionFields(
      { statusOption: "Cancelled", selectValues: [] },
      schema(["To Do", "Done"], []),
    );
    expect(out.statusOption).toBeUndefined();
    expect(out.changed).toBe(true);
  });

  it("DB에 status property 자체가 없으면 undefined", () => {
    const out = reconcileNotionFields(
      { statusOption: "Done", selectValues: [] },
      schema(null, []),
    );
    expect(out.statusOption).toBeUndefined();
    expect(out.changed).toBe(true);
  });

  it("statusOption이 원래 없으면 변경 없음", () => {
    const out = reconcileNotionFields(
      { selectValues: [] },
      schema(["To Do"], []),
    );
    expect(out.statusOption).toBeUndefined();
    expect(out.changed).toBe(false);
  });
});

describe("reconcileNotionFields — selectValues", () => {
  it("propertyName이 schema에 없으면 항목 제거", () => {
    const out = reconcileNotionFields(
      {
        selectValues: [
          { propertyName: "Removed", type: "select", options: ["P1"] },
        ],
      },
      schema(null, [{ name: "Sev", type: "select", options: ["P1"] }]),
    );
    expect(out.selectValues).toEqual([]);
    expect(out.changed).toBe(true);
  });

  it("options 중 schema에 없는 것만 제거, 남은 것 유지", () => {
    const out = reconcileNotionFields(
      {
        selectValues: [
          {
            propertyName: "Tags",
            type: "multi_select",
            options: ["frontend", "removed-tag"],
          },
        ],
      },
      schema(null, [
        {
          name: "Tags",
          type: "multi_select",
          options: ["frontend", "backend"],
        },
      ]),
    );
    expect(out.selectValues).toEqual([
      { propertyName: "Tags", type: "multi_select", options: ["frontend"] },
    ]);
    expect(out.changed).toBe(true);
  });

  it("options 모두 사라지면 항목 통째로 제거", () => {
    const out = reconcileNotionFields(
      {
        selectValues: [
          { propertyName: "Sev", type: "select", options: ["P1", "P2"] },
        ],
      },
      schema(null, [{ name: "Sev", type: "select", options: ["High", "Low"] }]),
    );
    expect(out.selectValues).toEqual([]);
    expect(out.changed).toBe(true);
  });

  it("schema의 type이 select↔multi_select로 바뀌면 type 갱신 + changed", () => {
    const out = reconcileNotionFields(
      {
        selectValues: [
          { propertyName: "Tags", type: "select", options: ["a"] },
        ],
      },
      schema(null, [
        { name: "Tags", type: "multi_select", options: ["a", "b"] },
      ]),
    );
    expect(out.selectValues[0]).toEqual({
      propertyName: "Tags",
      type: "multi_select",
      options: ["a"],
    });
    expect(out.changed).toBe(true);
  });

  it("모든 값이 유효하면 변경 없음", () => {
    const out = reconcileNotionFields(
      {
        selectValues: [
          { propertyName: "Sev", type: "select", options: ["P1"] },
          {
            propertyName: "Tags",
            type: "multi_select",
            options: ["frontend"],
          },
        ],
      },
      schema(null, [
        { name: "Sev", type: "select", options: ["P1", "P2"] },
        { name: "Tags", type: "multi_select", options: ["frontend"] },
      ]),
    );
    expect(out.selectValues).toHaveLength(2);
    expect(out.changed).toBe(false);
  });
});

describe("reconcileNotionFields — 복합", () => {
  it("status + selectValues 둘 다 정리", () => {
    const out = reconcileNotionFields(
      {
        statusOption: "Removed",
        selectValues: [
          { propertyName: "Stale", type: "select", options: ["x"] },
          {
            propertyName: "Sev",
            type: "select",
            options: ["P1", "deleted"],
          },
        ],
      },
      schema(["To Do", "Done"], [
        { name: "Sev", type: "select", options: ["P1", "P2"] },
      ]),
    );
    expect(out.statusOption).toBeUndefined();
    expect(out.selectValues).toEqual([
      { propertyName: "Sev", type: "select", options: ["P1"] },
    ]);
    expect(out.changed).toBe(true);
  });
});
