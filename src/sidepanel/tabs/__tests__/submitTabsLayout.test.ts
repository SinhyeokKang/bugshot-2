import { describe, expect, it } from "vitest";
import { SUBMIT_TABS_GRID_MAX, submitTabsLayout } from "../submitTabsLayout";

describe("submitTabsLayout", () => {
  it("그리드 상한은 8이다", () => {
    expect(SUBMIT_TABS_GRID_MAX).toBe(8);
  });

  describe("그리드 모드 (2~8개)", () => {
    it.each([2, 3, 4, 5, 6, 7, 8])("%i개면 grid-cols-%i 그리드로 깐다", (count) => {
      const { listClass, triggerClass, forceCollapsed } = submitTabsLayout(count);
      expect(listClass).toContain("grid");
      expect(listClass).toContain("h-9");
      expect(listClass).toContain("w-full");
      expect(listClass).toContain(`grid-cols-${count}`);
      expect(triggerClass).toContain("min-w-0");
      expect(forceCollapsed).toBe(false);
    });

    it.each([2, 5, 8])("%i개면 래퍼가 비어 있다 — 스크롤 컨테이너가 안 생겨 기존 렌더와 같다", (count) => {
      expect(submitTabsLayout(count).wrapperClass).toBe("");
    });

  });

  describe("스크롤 모드 (9개 이상)", () => {
    it.each([9, 10, 12])("%i개면 그리드를 버린다 — grid-cols가 아예 없다", (count) => {
      expect(submitTabsLayout(count).listClass).not.toMatch(/grid-cols-/);
    });

    it("높이는 유지하고 트리거는 shrink-0으로 아이콘이 눌리지 않게 한다", () => {
      const { listClass, triggerClass } = submitTabsLayout(9);
      expect(listClass).toContain("h-9");
      expect(triggerClass).toContain("shrink-0");
    });

    it("폭 바닥을 min-w-full로 깐다", () => {
      expect(submitTabsLayout(9).listClass).toContain("min-w-full");
    });

    it("폭을 w-full·flex로 고정하지 않는다", () => {
      const { listClass } = submitTabsLayout(9);
      expect(listClass.split(/\s+/)).not.toContain("w-full");
      expect(listClass.split(/\s+/)).not.toContain("flex");
    });

    it("라벨을 강제로 접는다 — 아이콘만 남겨 스크롤 거리를 줄인다", () => {
      expect(submitTabsLayout(9).forceCollapsed).toBe(true);
    });

    it("래퍼가 스크롤을 맡는다", () => {
      expect(submitTabsLayout(9).wrapperClass).toContain("overflow-x-auto");
    });

    it("래퍼의 세로 패딩이 상쇄된다 — 포커스 링 여유를 만들되 탭 줄을 밀지 않는다", () => {
      const { wrapperClass } = submitTabsLayout(9);
      expect(wrapperClass).toContain("py-1");
      expect(wrapperClass).toContain("-my-1");
    });
  });

  describe("2개 미만 (showTabs가 막는 도달 불가 방어 경로)", () => {
    it.each([0, 1])("%i개면 기존 grid-cols-2 폴백을 보존한다", (count) => {
      const { listClass, forceCollapsed } = submitTabsLayout(count);
      expect(listClass).toContain("grid-cols-2");
      expect(forceCollapsed).toBe(false);
    });
  });
});
