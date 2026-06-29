import { describe, expect, it } from "vitest";
import {
  canRedo,
  canUndo,
  initHistory,
  pushHistory,
  redo,
  undo,
} from "../history";

describe("initHistory", () => {
  it("present만 채우고 past/future는 비어있다", () => {
    const h = initHistory(0);
    expect(h.present).toBe(0);
    expect(h.past).toEqual([]);
    expect(h.future).toEqual([]);
  });
});

describe("pushHistory", () => {
  it("present를 갱신하고 이전 값을 past에 쌓는다", () => {
    const h = pushHistory(initHistory(0), 1);
    expect(h.present).toBe(1);
    expect(h.past).toEqual([0]);
  });

  it("future를 비운다", () => {
    let h = pushHistory(initHistory(0), 1);
    h = undo(h); // future=[1]
    h = pushHistory(h, 2);
    expect(h.future).toEqual([]);
  });

  it("입력 history를 변형하지 않는다(불변)", () => {
    const h0 = initHistory(0);
    pushHistory(h0, 1);
    expect(h0.present).toBe(0);
    expect(h0.past).toEqual([]);
  });
});

describe("undo / redo", () => {
  it("undo는 present를 직전 값으로 되돌린다", () => {
    let h = pushHistory(initHistory(0), 1);
    h = undo(h);
    expect(h.present).toBe(0);
  });

  it("redo는 undo를 복원한다", () => {
    let h = pushHistory(initHistory(0), 1);
    h = undo(h);
    h = redo(h);
    expect(h.present).toBe(1);
  });

  it("여러 단계 undo/redo가 순서를 지킨다", () => {
    let h = initHistory(0);
    h = pushHistory(h, 1);
    h = pushHistory(h, 2);
    h = undo(h);
    expect(h.present).toBe(1);
    h = undo(h);
    expect(h.present).toBe(0);
    h = redo(h);
    expect(h.present).toBe(1);
  });
});

describe("경계 — no-op", () => {
  it("빈 past에서 undo는 no-op", () => {
    const h = initHistory(0);
    const next = undo(h);
    expect(next.present).toBe(0);
    expect(next.past).toEqual([]);
  });

  it("빈 future에서 redo는 no-op", () => {
    const h = initHistory(0);
    const next = redo(h);
    expect(next.present).toBe(0);
    expect(next.future).toEqual([]);
  });
});

describe("canUndo / canRedo", () => {
  it("초기 상태는 둘 다 false", () => {
    const h = initHistory(0);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it("push 후 canUndo는 true, canRedo는 false", () => {
    const h = pushHistory(initHistory(0), 1);
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);
  });

  it("undo 후 canRedo는 true", () => {
    const h = undo(pushHistory(initHistory(0), 1));
    expect(canRedo(h)).toBe(true);
    expect(canUndo(h)).toBe(false);
  });
});
