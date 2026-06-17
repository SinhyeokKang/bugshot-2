import { describe, it, expect } from "vitest";
import { shouldLiftListItem, type ListBackspaceContext } from "../listKeymap";

const base: ListBackspaceContext = {
  selectionEmpty: true,
  parentOffset: 0,
  parentContentSize: 0,
  parentDepth: 2,
  grandParentTypeName: "listItem",
};

describe("shouldLiftListItem", () => {
  it("빈 list item 시작 + 커서만 → 리스트 종료", () => {
    expect(shouldLiftListItem(base)).toBe(true);
  });

  it("내용이 있는 항목 → 기본 동작 유지", () => {
    expect(shouldLiftListItem({ ...base, parentContentSize: 5 })).toBe(false);
  });

  it("항목 중간(오프셋 > 0) → 기본 동작 유지", () => {
    expect(shouldLiftListItem({ ...base, parentOffset: 3 })).toBe(false);
  });

  it("텍스트 선택 중 → 기본 동작 유지", () => {
    expect(shouldLiftListItem({ ...base, selectionEmpty: false })).toBe(false);
  });

  it("리스트 밖(부모가 list item 아님) → 기본 동작 유지", () => {
    expect(
      shouldLiftListItem({ ...base, grandParentTypeName: "blockquote" }),
    ).toBe(false);
  });

  it("부모 타입 없음 → 기본 동작 유지", () => {
    expect(shouldLiftListItem({ ...base, grandParentTypeName: null })).toBe(
      false,
    );
  });

  it("depth 0 (최상위) → 기본 동작 유지", () => {
    expect(shouldLiftListItem({ ...base, parentDepth: 0 })).toBe(false);
  });
});
