import { describe, expect, it, vi } from "vitest";

import { createBlockerPassthrough, isScrollIntent } from "../blocker-state";

function setup() {
  const apply = vi.fn((_value: "auto" | "none") => {});
  const state = createBlockerPassthrough(apply);
  const current = () => apply.mock.calls.at(-1)?.[0];
  return { apply, state, current };
}

describe("blocker passthrough", () => {
  it("이유를 켜면 투과, 끄면 다시 잡는다", () => {
    const { state, current } = setup();
    state.setReason("scroll-yield", true);
    expect(current()).toBe("none");
    state.setReason("scroll-yield", false);
    expect(current()).toBe("auto");
  });

  // 소유권이 갈려 있으면 한쪽 해제가 다른 쪽 투과를 무단 취소한다 — 이 저장소에서 실제로
  // hit-test가 스크롤 양보를 되돌려 스크롤이 안 먹던 자리다.
  it("이유가 둘이면 하나만 해제해도 투과를 유지한다", () => {
    const { state, current } = setup();
    state.setReason("scroll-yield", true);
    state.setReason("handoff", true);
    state.setReason("handoff", false);
    expect(current()).toBe("none");
  });

  it("hit-test 동안 투과시키고 끝나면 되돌린다", () => {
    const { state, current } = setup();
    const seen: (string | undefined)[] = [];
    const el = state.withHitTest(() => {
      seen.push(current());
      return "el";
    });
    expect(seen).toEqual(["none"]);
    expect(el).toBe("el");
    expect(current()).toBe("auto");
  });

  it("hit-test가 끝나도 남아있는 이유의 투과는 되돌리지 않는다", () => {
    const { state, current } = setup();
    state.setReason("scroll-yield", true);
    state.withHitTest(() => null);
    expect(current()).toBe("none");
  });

  it("hit-test가 던져도 투과 상태를 복원한다", () => {
    const { state, current } = setup();
    expect(() =>
      state.withHitTest(() => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(current()).toBe("auto");
  });

  it("이유를 전부 비우면 잡는다", () => {
    const { state, current } = setup();
    state.setReason("scroll-yield", true);
    state.setReason("handoff", true);
    state.clearReasons();
    expect(current()).toBe("auto");
  });

  it("이유를 비워도 진행 중인 hit-test 투과는 유지한다", () => {
    const { state, current } = setup();
    state.withHitTest(() => {
      state.setReason("handoff", true);
      state.clearReasons();
      expect(current()).toBe("none");
      return null;
    });
  });

  it("상태가 바뀔 때마다 적용을 호출한다 (누락 방지)", () => {
    const { apply, state } = setup();
    state.setReason("handoff", true);
    state.clearReasons();
    state.withHitTest(() => null);
    expect(apply).toHaveBeenCalledTimes(4);
  });
});

describe("isScrollIntent", () => {
  it("휠 직후의 이동은 스크롤의 일부로 본다", () => {
    expect(isScrollIntent(1030, 1000, 60)).toBe(true);
  });

  it("창을 벗어난 이동은 포인팅으로 본다", () => {
    expect(isScrollIntent(1060, 1000, 60)).toBe(false);
  });

  it("경계값은 포인팅으로 본다 (양보 타이머보다 먼저 닫혀야 한다)", () => {
    expect(isScrollIntent(1059, 1000, 60)).toBe(true);
    expect(isScrollIntent(1060, 1000, 60)).toBe(false);
  });

  it("휠이 없었으면(초기값 0) 포인팅으로 본다", () => {
    expect(isScrollIntent(1000, 0, 60)).toBe(false);
  });
});
