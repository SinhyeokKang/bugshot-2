import { describe, it, expect } from "vitest";
import { createFinalizeGuard } from "../video-recorder";

// onstop이 state를 비운 뒤 썸네일·탭 조회를 await 하는 창의 커밋/폐기 판정만 분리해 검증한다.
describe("createFinalizeGuard", () => {
  it("취소 없이 끝나면 커밋한다", () => {
    const g = createFinalizeGuard();
    const id = g.begin();
    expect(g.end(id)).toBe("commit");
  });

  it("finalize 창 안의 취소는 접수되고 커밋 대신 폐기된다", () => {
    const g = createFinalizeGuard();
    const id = g.begin();
    expect(g.cancel()).toBe(true);
    expect(g.end(id)).toBe("discard");
  });

  it("창이 없으면(진짜 idle) 취소는 접수되지 않는다", () => {
    const g = createFinalizeGuard();
    expect(g.cancel()).toBe(false);
  });

  it("end는 창을 닫아, 같은 id로 다시 끝내도 커밋하지 않는다", () => {
    const g = createFinalizeGuard();
    const id = g.begin();
    expect(g.end(id)).toBe("commit");
    expect(g.end(id)).toBe("discard");
    expect(g.cancel()).toBe(false);
  });

  it("다음 창이 열린 뒤 도착한 이전 continuation은 폐기되고 현재 창을 닫지 않는다", () => {
    const g = createFinalizeGuard();
    const stale = g.begin();
    const current = g.begin();
    expect(g.end(stale)).toBe("discard");
    expect(g.end(current)).toBe("commit");
  });

  it("직전 창의 취소가 다음 창으로 새지 않는다", () => {
    const g = createFinalizeGuard();
    const first = g.begin();
    g.cancel();
    expect(g.end(first)).toBe("discard");
    const second = g.begin();
    expect(g.end(second)).toBe("commit");
  });
});
