import { describe, expect, it } from "vitest";
import { SUBMIT_TABS_GRID_MAX, submitTabsLayout } from "../submitTabsLayout";

describe("submitTabsLayout", () => {
  it("상한이 8이다 — 400px 패널에서 9등분(33.8px)이 트리거 최소폭(38px)을 밑돈다", () => {
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

    it("count마다 서로 다른 grid-cols를 돌려준다", () => {
      const cols = [2, 3, 4, 5, 6, 7, 8].map((n) => submitTabsLayout(n).listClass);
      expect(new Set(cols).size).toBe(cols.length);
    });
  });

  describe("스크롤 모드 (9개 이상)", () => {
    it.each([9, 10, 12])("%i개면 그리드를 버린다 — grid-cols가 아예 없다", (count) => {
      expect(submitTabsLayout(count).listClass).not.toMatch(/grid-cols-/);
    });

    it("grid-cols-2 폴백으로 무너지지 않는다", () => {
      expect(submitTabsLayout(9).listClass).not.toContain("grid-cols-2");
    });

    it("존재하지 않는 grid-cols-9를 동적 조립하지 않는다 (Tailwind JIT 미추출 클래스)", () => {
      expect(submitTabsLayout(9).listClass).not.toContain("grid-cols-9");
    });

    it("높이는 유지하고 트리거는 shrink-0으로 아이콘이 눌리지 않게 한다", () => {
      const { listClass, triggerClass } = submitTabsLayout(9);
      expect(listClass).toContain("h-9");
      expect(triggerClass).toContain("shrink-0");
    });

    it("라벨을 강제로 접는다 — 아이콘만 남겨 스크롤 거리를 줄인다", () => {
      expect(submitTabsLayout(9).forceCollapsed).toBe(true);
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
