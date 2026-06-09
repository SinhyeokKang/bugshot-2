import { describe, it, expect, vi } from "vitest";
import { createTrailingThrottle } from "../log-throttle";

// 주입형 fake 타이머 — 실시간 대기 없이 예약/취소/발화를 제어한다.
function makeFakeTimer() {
  let nextId = 1;
  const timers = new Map<number, { cb: () => void; ms: number }>();
  return {
    schedule: (cb: () => void, ms: number): number => {
      const id = nextId++;
      timers.set(id, { cb, ms });
      return id;
    },
    clear: (id: number): void => {
      timers.delete(id);
    },
    // 예약된 모든 타이머를 발화 순서대로 실행
    fireAll: (): void => {
      for (const [id, { cb }] of [...timers]) {
        timers.delete(id);
        cb();
      }
    },
    pending: (): number => timers.size,
    lastMs: (): number | undefined => [...timers.values()].at(-1)?.ms,
  };
}

describe("createTrailingThrottle", () => {
  it("schedule 후 타이머가 발화하면 flush가 1회 호출된다", () => {
    const flush = vi.fn();
    const timer = makeFakeTimer();
    const t = createTrailingThrottle(flush, 200, timer.schedule, timer.clear);

    t.schedule();
    expect(flush).not.toHaveBeenCalled(); // trailing — 예약만, 즉시 호출 안 함
    expect(timer.lastMs()).toBe(200); // intervalMs가 타이머에 전달됨

    timer.fireAll();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("연속 schedule은 타이머를 하나만 유지해 interval당 flush 1회만 보장한다", () => {
    const flush = vi.fn();
    const timer = makeFakeTimer();
    const t = createTrailingThrottle(flush, 200, timer.schedule, timer.clear);

    t.schedule();
    t.schedule();
    t.schedule();
    expect(timer.pending()).toBe(1); // 중복 예약 없음

    timer.fireAll();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("flushNow는 즉시 flush하고 예약된 타이머를 취소한다(중복 flush 없음)", () => {
    const flush = vi.fn();
    const timer = makeFakeTimer();
    const t = createTrailingThrottle(flush, 200, timer.schedule, timer.clear);

    t.schedule();
    t.flushNow();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(timer.pending()).toBe(0); // 예약 취소됨

    timer.fireAll(); // 남은 타이머 없으니 추가 flush 없음
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("예약 없이 flushNow를 호출해도 즉시 flush한다", () => {
    const flush = vi.fn();
    const timer = makeFakeTimer();
    const t = createTrailingThrottle(flush, 200, timer.schedule, timer.clear);

    t.flushNow();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("cancel은 예약된 타이머만 취소하고 flush는 호출하지 않는다", () => {
    const flush = vi.fn();
    const timer = makeFakeTimer();
    const t = createTrailingThrottle(flush, 200, timer.schedule, timer.clear);

    t.schedule();
    t.cancel();
    expect(timer.pending()).toBe(0);

    timer.fireAll();
    expect(flush).not.toHaveBeenCalled();
  });

  it("flush 발화 후 다시 schedule하면 다음 주기를 새로 예약한다", () => {
    const flush = vi.fn();
    const timer = makeFakeTimer();
    const t = createTrailingThrottle(flush, 200, timer.schedule, timer.clear);

    t.schedule();
    timer.fireAll();
    expect(flush).toHaveBeenCalledTimes(1);

    t.schedule(); // 첫 주기 종료 후 재예약 가능해야 함
    expect(timer.pending()).toBe(1);
    timer.fireAll();
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("flush가 throw해도 타이머 상태가 깨지지 않아 이후 schedule이 정상 동작한다", () => {
    const flush = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("boom");
      })
      .mockImplementation(() => {});
    const timer = makeFakeTimer();
    const t = createTrailingThrottle(flush, 200, timer.schedule, timer.clear);

    t.schedule();
    expect(() => timer.fireAll()).not.toThrow(); // 예외가 콜백 밖으로 새지 않음

    t.schedule(); // 예외 후에도 재예약 가능(pending 플래그 리셋됨)
    expect(timer.pending()).toBe(1);
    timer.fireAll();
    expect(flush).toHaveBeenCalledTimes(2);
  });
});
