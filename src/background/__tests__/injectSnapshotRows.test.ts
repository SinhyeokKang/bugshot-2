import { describe, it, expect } from "vitest";
import { injectSnapshotRows, isStyleChangesTable } from "../injectSnapshotRows";

// buildIssueAdf의 table()가 만드는 styleChanges table 구조를 흉내낸다(헤더 셀 텍스트).
function styleChangesTable(): unknown {
  const header = (text: string) => ({
    type: "tableHeader",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
  return {
    type: "table",
    content: [
      { type: "tableRow", content: [header("Property"), header("As is"), header("To be")] },
      { type: "tableRow", content: [{ type: "tableCell", content: [] }] },
    ],
  };
}

function userTable(): unknown {
  const header = (text: string) => ({
    type: "tableHeader",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
  return {
    type: "table",
    content: [{ type: "tableRow", content: [header("Name"), header("Value")] }],
  };
}

const heading = (text: string) => ({
  type: "heading",
  attrs: { level: 2 },
  content: [{ type: "text", text }],
});

type Row = { before?: string; after?: string };
const make = (before?: string, after?: string): Row => ({ before, after });

function run(content: unknown[], files: Record<string, string>) {
  injectSnapshotRows<string>(
    content,
    (name) => files[name],
    (before, after) => make(before, after),
  );
}

describe("isStyleChangesTable", () => {
  it("헤더에 As is/To be 있으면 true", () => {
    expect(isStyleChangesTable(styleChangesTable())).toBe(true);
  });
  it("일반 table은 false", () => {
    expect(isStyleChangesTable(userTable())).toBe(false);
  });
  it("table 아닌 노드는 false", () => {
    expect(isStyleChangesTable(heading("x"))).toBe(false);
  });
});

describe("injectSnapshotRows — table N개 ↔ element N개 인덱스 일치", () => {
  it("복수 table: i번째 table에 before-${i}/after-${i} Snapshot 행 (교차 없음)", () => {
    const content: unknown[] = [
      heading("Style Changes (a)"),
      styleChangesTable(),
      heading("Style Changes (b)"),
      styleChangesTable(),
    ];
    run(content, {
      "before-0.webp": "B0",
      "after-0.webp": "A0",
      "before-1.webp": "B1",
      "after-1.webp": "A1",
    });
    const row0 = (content[1] as any).content[1] as Row;
    const row1 = (content[3] as any).content[1] as Row;
    expect(row0).toEqual({ before: "B0", after: "A0" });
    expect(row1).toEqual({ before: "B1", after: "A1" });
  });

  it("단일 table: before-0 회귀", () => {
    const content: unknown[] = [heading("Style Changes (a)"), styleChangesTable()];
    run(content, { "before-0.webp": "B0", "after-0.webp": "A0" });
    expect((content[1] as any).content[1]).toEqual({ before: "B0", after: "A0" });
  });

  it("일반 user table은 건너뛰고 인덱스도 소비하지 않음", () => {
    const content: unknown[] = [
      userTable(),
      heading("Style Changes (a)"),
      styleChangesTable(),
    ];
    run(content, { "before-0.webp": "B0", "after-0.webp": "A0" });
    // user table(0)은 변형 없음
    expect((content[0] as any).content).toHaveLength(1);
    // styleChanges table은 before-0(인덱스 0)을 받음
    expect((content[2] as any).content[1]).toEqual({ before: "B0", after: "A0" });
  });

  it("파일 없으면 splice 안 함", () => {
    const content: unknown[] = [heading("x"), styleChangesTable()];
    run(content, {});
    expect((content[1] as any).content).toHaveLength(2);
  });
});
