/**
 * 열 수 → Tailwind `grid-cols-N` 클래스. Tailwind JIT은 클래스명을 **정적으로** 스캔하므로
 * 템플릿 리터럴로 만들면 purge된다 — 그래서 표가 필요하고, 표가 두 벌이면 한쪽만 늘어난다.
 */
const GRID_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
  7: "grid-cols-7",
  8: "grid-cols-8",
};

/** 표 밖이면 8열로 접는다 — 클래스가 통째로 빠져 1열로 무너지는 것보다 낫다. */
export function gridColsFor(count: number): string {
  return GRID_COLS[count] ?? GRID_COLS[8];
}
