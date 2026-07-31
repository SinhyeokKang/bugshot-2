import { describe, expect, it } from "vitest";

import {
  clearPassthroughReasons,
  createPassthrough,
  pointerEventsOf,
  setHitTest,
  setPassthroughReason,
} from "../blocker-state";

describe("blocker passthrough 상태", () => {
  it("이유가 없으면 blocker가 이벤트를 잡는다", () => {
    expect(pointerEventsOf(createPassthrough())).toBe("auto");
  });

  it("스크롤 양보 중에는 투과시킨다", () => {
    const s = createPassthrough();
    setPassthroughReason(s, "scroll-yield", true);
    expect(pointerEventsOf(s)).toBe("none");
  });

  it("iframe 핸드오프 중에는 투과시킨다", () => {
    const s = createPassthrough();
    setPassthroughReason(s, "handoff", true);
    expect(pointerEventsOf(s)).toBe("none");
  });

  it("이유를 해제하면 다시 잡는다", () => {
    const s = createPassthrough();
    setPassthroughReason(s, "scroll-yield", true);
    setPassthroughReason(s, "scroll-yield", false);
    expect(pointerEventsOf(s)).toBe("auto");
  });

  // 소유권이 갈려 있으면 한쪽 해제가 다른 쪽 투과를 무단 취소한다 — 이 저장소에서 실제로
  // hit-test가 스크롤 양보를 되돌려 스크롤이 안 먹던 자리다.
  it("이유가 둘이면 하나만 해제해도 투과를 유지한다", () => {
    const s = createPassthrough();
    setPassthroughReason(s, "scroll-yield", true);
    setPassthroughReason(s, "handoff", true);
    setPassthroughReason(s, "handoff", false);
    expect(pointerEventsOf(s)).toBe("none");
  });

  it("같은 이유를 두 번 켜도 한 번 해제하면 풀린다", () => {
    const s = createPassthrough();
    setPassthroughReason(s, "handoff", true);
    setPassthroughReason(s, "handoff", true);
    setPassthroughReason(s, "handoff", false);
    expect(pointerEventsOf(s)).toBe("auto");
  });

  it("hit-test 동안 투과시키고 끝나면 되돌린다", () => {
    const s = createPassthrough();
    setHitTest(s, true);
    expect(pointerEventsOf(s)).toBe("none");
    setHitTest(s, false);
    expect(pointerEventsOf(s)).toBe("auto");
  });

  it("hit-test가 끝나도 남아있는 이유의 투과는 되돌리지 않는다", () => {
    const s = createPassthrough();
    setPassthroughReason(s, "scroll-yield", true);
    setHitTest(s, true);
    setHitTest(s, false);
    expect(pointerEventsOf(s)).toBe("none");
  });

  it("이유를 전부 비우면 잡는다", () => {
    const s = createPassthrough();
    setPassthroughReason(s, "scroll-yield", true);
    setPassthroughReason(s, "handoff", true);
    clearPassthroughReasons(s);
    expect(pointerEventsOf(s)).toBe("auto");
  });

  it("이유를 비워도 진행 중인 hit-test 투과는 유지한다", () => {
    const s = createPassthrough();
    setHitTest(s, true);
    setPassthroughReason(s, "handoff", true);
    clearPassthroughReasons(s);
    expect(pointerEventsOf(s)).toBe("none");
  });
});
