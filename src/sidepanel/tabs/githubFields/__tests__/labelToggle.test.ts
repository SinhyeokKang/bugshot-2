import { describe, expect, it } from "vitest";
import { toggleLabel } from "../labelToggle";

describe("toggleLabel", () => {
  it("없는 라벨은 추가", () => {
    expect(toggleLabel(["bug"], "ui")).toEqual(["bug", "ui"]);
  });

  it("이미 있는 라벨은 제거", () => {
    expect(toggleLabel(["bug", "ui"], "bug")).toEqual(["ui"]);
  });

  it("빈 배열에 추가", () => {
    expect(toggleLabel([], "bug")).toEqual(["bug"]);
  });

  it("단일 항목 제거", () => {
    expect(toggleLabel(["bug"], "bug")).toEqual([]);
  });

  it("순서 보존 — 추가는 끝에", () => {
    expect(toggleLabel(["a", "b", "c"], "d")).toEqual(["a", "b", "c", "d"]);
  });

  it("순서 보존 — 가운데 제거", () => {
    expect(toggleLabel(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("immutable — 입력 배열을 변경하지 않음", () => {
    const input = ["a", "b"];
    const out = toggleLabel(input, "c");
    expect(input).toEqual(["a", "b"]);
    expect(out).not.toBe(input);
  });
});
