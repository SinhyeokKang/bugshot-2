import { describe, it, expect } from "vitest";
import { EditorState, Transaction } from "@uiw/react-codemirror";
import {
  selectorLineProtectedRange,
  selectorLineChangeFilter,
} from "../selectorLock";

describe("selectorLineProtectedRange", () => {
  it("1행 끝(firstLineTo)까지를 protected range로 반환", () => {
    // e.g. ".foo {" 끝 위치가 10이면 [0,10]을 보호 → 1행 편집만 드롭, 본문은 통과.
    expect(selectorLineProtectedRange(10)).toEqual([0, 10]);
  });

  it("빈/짧은 선택자(길이 0)도 안전", () => {
    expect(selectorLineProtectedRange(0)).toEqual([0, 0]);
  });
});

describe("selectorLineChangeFilter", () => {
  it("사용자 입력이면 1행을 보호한다", () => {
    expect(
      selectorLineChangeFilter({ hasUserEvent: true, firstLineTo: 10 }),
    ).toEqual([0, 10]);
  });

  it("프로그램적 변경(userEvent 없음)은 보호 없이 통과시킨다", () => {
    expect(
      selectorLineChangeFilter({ hasUserEvent: false, firstLineTo: 10 }),
    ).toBe(true);
  });
});

// 회귀: protected range는 "겹치는 변경 조각"을 통째로 드롭한다. uiw가 value prop 동기화에
// 쓰는 전체 doc 교체({from:0,to:len})는 1행과 겹치므로 삽입분이 사라지고 삭제만 남아
// doc이 선택자 1행으로 붕괴했다(AI 스타일링·전체 리셋 직후 본문 전멸).
describe("changeFilter 통합 — 전체 doc 교체", () => {
  const BEFORE = "a:nth-child(4) {\ncolor: red;\n}";
  const AFTER = "a:nth-child(4) {\ncolor: red;\nborder-radius: 999px;\n}";

  const filter = EditorState.changeFilter.of((tr) =>
    selectorLineChangeFilter({
      hasUserEvent: tr.annotation(Transaction.userEvent) !== undefined,
      firstLineTo: tr.startState.doc.lineAt(0).to,
    }),
  );

  const create = (doc: string) =>
    EditorState.create({ doc, extensions: [filter] });

  it("프로그램적 전체 교체는 본문을 보존한다", () => {
    const state = create(BEFORE);
    const tr = state.update({
      changes: { from: 0, to: state.doc.length, insert: AFTER },
    });
    expect(tr.state.doc.toString()).toBe(AFTER);
  });

  it("사용자 입력의 1행 편집은 여전히 드롭한다", () => {
    const state = create(BEFORE);
    const tr = state.update({
      changes: { from: 0, to: 1, insert: "X" },
      userEvent: "input.type",
    });
    expect(tr.state.doc.toString()).toBe(BEFORE);
  });

  it("사용자 입력의 본문 편집은 통과시킨다", () => {
    const state = create(BEFORE);
    const at = state.doc.line(2).to;
    const tr = state.update({
      changes: { from: at, insert: "\nmargin: 0;" },
      userEvent: "input.type",
    });
    expect(tr.state.doc.toString()).toBe(
      "a:nth-child(4) {\ncolor: red;\nmargin: 0;\n}",
    );
  });

  it("사용자 입력의 select-all 삭제는 선택자 1행만 남긴다 (삭제=원복 유지)", () => {
    const state = create(BEFORE);
    const tr = state.update({
      changes: { from: 0, to: state.doc.length },
      userEvent: "delete.selection",
    });
    expect(tr.state.doc.toString()).toBe("a:nth-child(4) {");
  });
});
