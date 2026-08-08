import { describe, expect, it } from "vitest";
import { gridColsFor } from "../grid-cols";

// Tailwind JIT은 클래스명을 정적으로 스캔한다 — 템플릿 리터럴로 만들면 purge돼 클래스가
// 통째로 빠지고 그리드가 1열로 무너진다. 그래서 표가 필요하고, 표 밖 입력이 조용히
// `undefined`를 돌려주면 같은 붕괴가 난다.
describe("gridColsFor", () => {
  it("표 안의 열 수는 그대로 매핑된다", () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(gridColsFor(n)).toBe(`grid-cols-${n}`);
    }
  });

  it("표를 벗어나도 undefined를 돌려주지 않는다", () => {
    for (const n of [0, 9, 12, -1]) {
      expect(gridColsFor(n)).toBe("grid-cols-8");
    }
  });
});
