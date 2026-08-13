import { describe, expect, it } from "vitest";
import { createSentinelRegistry } from "../sentinel-registry";

describe("createSentinelRegistry", () => {
  it("새 sentinel을 등록하면 true, list에 들어간다", () => {
    const reg = createSentinelRegistry();
    expect(reg.add("a")).toBe(true);
    expect(reg.list()).toContain("a");
    expect(reg.list()).toEqual(["a"]);
  });

  it("같은 sentinel 재등록은 false — 멱등 재발행(rebroadcastSentinelsToFrame)", () => {
    const reg = createSentinelRegistry();
    reg.add("a");
    expect(reg.add("a")).toBe(false);
    expect(reg.list()).toEqual(["a"]);
  });

  it("재등록이 FIFO 순서를 흔들지 않는다", () => {
    const reg = createSentinelRegistry(3);
    reg.add("a");
    reg.add("b");
    reg.add("a");
    expect(reg.list()).toEqual(["a", "b"]);
  });

  it("list()는 등록 순서 스냅샷 — 반환 배열을 바꿔도 레지스트리는 그대로", () => {
    const reg = createSentinelRegistry();
    reg.add("a");
    reg.add("b");
    const snapshot = reg.list();
    snapshot.push("c");
    expect(reg.list()).toEqual(["a", "b"]);
  });

  it("캡을 넘기면 가장 오래된 것부터 evict된다", () => {
    const reg = createSentinelRegistry(2);
    reg.add("a");
    reg.add("b");
    reg.add("c");
    expect(reg.list()).toEqual(["b", "c"]);
    expect(reg.list()).not.toContain("a");
  });

  it("evicted()는 밀려난 항목을 돌려주고 비운다(리스너 해제 1회 보장)", () => {
    const reg = createSentinelRegistry(1);
    reg.add("a");
    reg.add("b");
    expect(reg.evicted()).toEqual(["a"]);
    expect(reg.evicted()).toEqual([]);
  });

  it("evict가 없으면 evicted()는 빈 배열", () => {
    const reg = createSentinelRegistry(2);
    reg.add("a");
    expect(reg.evicted()).toEqual([]);
  });

  it("기본 캡은 8 — 9번째 등록에서 첫 항목이 밀린다", () => {
    const reg = createSentinelRegistry();
    for (let i = 0; i < 8; i++) reg.add(`s${i}`);
    expect(reg.list()).toHaveLength(8);
    expect(reg.evicted()).toEqual([]);

    reg.add("s8");
    expect(reg.list()).toHaveLength(8);
    expect(reg.evicted()).toEqual(["s0"]);
    expect(reg.list()).toContain("s8");
  });

  it("캡을 여러 번 초과하면 evicted()가 밀려난 순서대로 누적한다", () => {
    const reg = createSentinelRegistry(1);
    reg.add("a");
    reg.add("b");
    reg.add("c");
    expect(reg.evicted()).toEqual(["a", "b"]);
    expect(reg.list()).toEqual(["c"]);
  });
});
