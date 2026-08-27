import { describe, it, expect } from "vitest";
import { injectSnapshotRows, isStyleChangesTable } from "../injectSnapshotRows";

// styleChanges table 식별 라벨은 본문 언어(bodyLocale)를 따르므로 호출부가 주입한다 —
// messages.ts가 injectSnapshotRows를 부르는 자리는 이미 withLocale(bodyLocale) 구간 안이다.
const EN = { asIs: "As is", toBe: "To be" };
const KO = { asIs: "변경 전", toBe: "변경 후" };

// buildIssueAdf의 table()가 만드는 styleChanges table 구조를 흉내낸다(헤더 셀 텍스트).
function styleChangesTable(headers = EN): unknown {
  const header = (text: string) => ({
    type: "tableHeader",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
  return {
    type: "table",
    content: [
      {
        type: "tableRow",
        content: [header("Property"), header(headers.asIs), header(headers.toBe)],
      },
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

function run(content: unknown[], files: Record<string, string>, headers = EN) {
  injectSnapshotRows<string>(
    content,
    (name) => files[name],
    (before, after) => make(before, after),
    headers,
  );
}

describe("isStyleChangesTable", () => {
  it("헤더에 As is/To be 있으면 true", () => {
    expect(isStyleChangesTable(styleChangesTable(), EN)).toBe(true);
  });
  it("일반 table은 false", () => {
    expect(isStyleChangesTable(userTable(), EN)).toBe(false);
  });
  it("table 아닌 노드는 false", () => {
    expect(isStyleChangesTable(heading("x"), EN)).toBe(false);
  });
});

// 표 헤더가 본문 언어를 타게 되면 영어 리터럴 식별은 ko/fr 제출에서 통째로 무음 실패한다
// (table을 못 찾아 Snapshot 행이 안 붙고, 예외도 로그도 없다). 식별 라벨은 본문을 만든
// 로케일과 같은 출처에서 와야 한다.
describe("isStyleChangesTable — 식별이 본문 언어를 따른다", () => {
  it("ko 본문 table을 ko 라벨로 식별한다", () => {
    expect(isStyleChangesTable(styleChangesTable(KO), KO)).toBe(true);
  });

  it("영어 라벨로는 ko 본문 table을 식별하지 못한다 (라벨 주입이 필수임을 실증)", () => {
    expect(isStyleChangesTable(styleChangesTable(KO), EN)).toBe(false);
  });

  it("ko 본문에서도 Snapshot 행이 splice된다", () => {
    const content: unknown[] = [heading("스타일 변경 (a)"), styleChangesTable(KO)];
    run(content, { "before-0.webp": "B0", "after-0.webp": "A0" }, KO);
    expect((content[1] as any).content[1]).toEqual({ before: "B0", after: "A0" });
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
