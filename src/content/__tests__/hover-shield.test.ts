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

  // 타이머를 이유와 함께 소유하지 않으면 죽은 타이머가 나중에 켠 이유를 무단 취소한다.
  it("selection-commit을 명시 해제하면 타이머도 취소한다", () => {
    const { shield, current } = setup();
    shield.setReason("selection-commit", true);
    shield.setReason("selection-commit", false);
    vi.advanceTimersByTime(EXPIRE_MS / 2);
    shield.setReason("selection-commit", true);
    vi.advanceTimersByTime(EXPIRE_MS / 2);
    expect(current()).toBe(true);
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

  it("clearReasons도 타이머를 정리한다", () => {
    const { shield, current } = setup();
    shield.setReason("selection-commit", true);
    shield.clearReasons();
    shield.setReason("capture-prep", true);
    vi.advanceTimersByTime(EXPIRE_MS);
    expect(current()).toBe(true);
  });

  it("상태가 바뀔 때마다 적용을 호출한다 (누락 방지)", () => {
    const { apply, shield } = setup();
    shield.setReason("capture-prep", true);
    shield.setReason("capture-prep", false);
    shield.clearReasons();
    expect(apply).toHaveBeenCalledTimes(3);
  });
});
