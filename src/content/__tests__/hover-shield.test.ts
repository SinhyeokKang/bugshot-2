import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createHoverShield } from "../hover-shield";

const EXPIRE_MS = 2000;

function setup() {
  const apply = vi.fn((_on: boolean) => {});
  const shield = createHoverShield(apply, EXPIRE_MS);
  const current = () => apply.mock.calls.at(-1)?.[0];
  return { apply, shield, current };
}

describe("hover shield", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("이유를 켜면 방패를 올리고, 끄면 내린다", () => {
    const { shield, current } = setup();
    shield.setReason("capture-prep", true);
    expect(current()).toBe(true);
    shield.setReason("capture-prep", false);
    expect(current()).toBe(false);
  });

  // 선택 커밋과 캡처 준비가 겹친다 — 한쪽이 끝났다고 방패를 내리면 그 순간 커서 밑
  // 페이지 요소가 :hover를 받아 캡처에 굳는다.
  it("이유가 둘이면 하나만 해제해도 방패를 유지한다", () => {
    const { shield, current } = setup();
    shield.setReason("selection-commit", true);
    shield.setReason("capture-prep", true);
    shield.setReason("capture-prep", false);
    expect(current()).toBe(true);
  });

  // 사이드패널이 before 캡처를 건너뛰면(이미 beforeImage 보유) endCapture가 영영 안 온다.
  it("selection-commit은 만료 시간이 지나면 스스로 내려간다", () => {
    const { shield, current } = setup();
    shield.setReason("selection-commit", true);
    vi.advanceTimersByTime(EXPIRE_MS);
    expect(current()).toBe(false);
  });

  it("capture-prep은 시간이 지나도 스스로 내려가지 않는다", () => {
    const { shield, current } = setup();
    shield.setReason("capture-prep", true);
    vi.advanceTimersByTime(EXPIRE_MS * 10);
    expect(current()).toBe(true);
  });

  it("selection-commit 만료가 진행 중인 capture-prep을 끄지 않는다", () => {
    const { shield, current } = setup();
    shield.setReason("selection-commit", true);
    shield.setReason("capture-prep", true);
    vi.advanceTimersByTime(EXPIRE_MS);
    expect(current()).toBe(true);
  });

  // 다른 이유가 만료 타이머를 건드리면(가드 누락) 캡처가 끝나는 순간 커밋 방패의 수명이
  // 통째로 늘어나거나 사라진다 — 타이머 소유자는 selection-commit 하나뿐이어야 한다.
  it("다른 이유를 껐다고 selection-commit 만료가 취소되지 않는다", () => {
    const { shield, current } = setup();
    shield.setReason("selection-commit", true);
    shield.setReason("capture-prep", true);
    shield.setReason("capture-prep", false);
    vi.advanceTimersByTime(EXPIRE_MS);
    expect(current()).toBe(false);
  });

  // 타이머를 이유와 함께 소유하지 않으면 죽은 타이머가 나중에 켠 이유를 무단 취소한다.
  it("selection-commit을 명시 해제하면 타이머도 취소한다", () => {
    const { apply, shield } = setup();
    shield.setReason("selection-commit", true);
    shield.setReason("selection-commit", false);
    vi.advanceTimersByTime(EXPIRE_MS * 2);
    // 살아남은 타이머가 깨어나면 해제가 한 번 더 적용된다 — 그 흔적으로 취소를 관찰한다.
    expect(apply).toHaveBeenCalledTimes(2);
  });

  // 연속 커밋이면 두 번째 무장이 첫 타이머를 물려받아야 한다 — 안 죽이면 첫 타이머가
  // 만료하며 두 번째 선택의 방패를 걷는다.
  it("selection-commit을 다시 무장하면 만료를 처음부터 다시 센다", () => {
    const { shield, current } = setup();
    shield.setReason("selection-commit", true);
    vi.advanceTimersByTime(EXPIRE_MS - 100);
    shield.setReason("selection-commit", true);
    vi.advanceTimersByTime(100);
    expect(current()).toBe(true);
  });

  it("clearReasons는 이유를 실제로 비운다", () => {
    const { shield, current } = setup();
    shield.setReason("selection-commit", true);
    shield.clearReasons();
    shield.setReason("capture-prep", true);
    shield.setReason("capture-prep", false);
    // 좀비 이유가 남아 있으면 방패가 영영 안 내려간다.
    expect(current()).toBe(false);
  });

  it("clearReasons도 타이머를 정리한다", () => {
    const { apply, shield } = setup();
    shield.setReason("selection-commit", true);
    shield.clearReasons();
    shield.setReason("capture-prep", true);
    vi.advanceTimersByTime(EXPIRE_MS * 2);
    // 살아남은 타이머는 이유를 안 바꿔 상태로는 안 드러난다 — 깨어난 흔적(적용 1회)으로 본다.
    expect(apply).toHaveBeenCalledTimes(3);
  });

  it("상태가 바뀔 때마다 적용을 호출한다 (누락 방지)", () => {
    const { apply, shield } = setup();
    shield.setReason("capture-prep", true);
    shield.setReason("capture-prep", false);
    shield.clearReasons();
    expect(apply).toHaveBeenCalledTimes(3);
  });
});

// blocker와 방패는 같은 shadow root의 hit target을 나눠 갖는다 — 프로브가 blocker만
// 비켜세우면 elementFromPoint가 방패(=우리 host)를 돌려줘 picking이 조용히 죽는다.
describe("hover shield hit-test", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hit-test 동안 비켜서고 끝나면 되돌아온다", () => {
    const { shield, current } = setup();
    shield.setReason("capture-prep", true);
    const seen: (boolean | undefined)[] = [];
    const el = shield.withHitTest(() => {
      seen.push(current());
      return "el";
    });
    expect(seen).toEqual([false]);
    expect(el).toBe("el");
    expect(current()).toBe(true);
  });

  it("hit-test가 던져도 방패를 복원한다", () => {
    const { shield, current } = setup();
    shield.setReason("capture-prep", true);
    expect(() =>
      shield.withHitTest(() => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(current()).toBe(true);
  });

  it("이유가 없으면 hit-test가 끝나도 그대로 내려가 있다", () => {
    const { shield, current } = setup();
    shield.withHitTest(() => null);
    expect(current()).toBe(false);
  });
});
