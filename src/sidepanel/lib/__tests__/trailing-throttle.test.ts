import { describe, it, expect, vi } from "vitest";
import { createTrailingThrottle as createSidepanelThrottle } from "../trailing-throttle";
import { createTrailingThrottle as createContentThrottle } from "@/content/log-throttle";

// 이 둘은 pre-arm 청크 제약(recorders-entry가 동기 IIFE로 emit돼야 한다) 때문에 의도적으로 분리된
// 복제본이다. 한쪽만 고치는 드리프트는 타입도 빌드도 안 잡으므로, 같은 케이스를 두 구현에 함께 태운다.
// (테스트 파일은 번들 산출물이 아니라 content 모듈을 import해도 청크 제약과 무관하다.)
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

describe.each([
  ["sidepanel/lib/trailing-throttle", createSidepanelThrottle],
  ["content/log-throttle", createContentThrottle],
])("createTrailingThrottle (%s)", (_name, createTrailingThrottle) => {
  it("schedule 후 타이머가 발화하면 flush가 1회 호출된다", () => {
    const timer = makeFakeTimer();
    const flush = vi.fn();
    const t = createTrailingThrottle(flush, 500, timer.schedule, timer.clear);

    t.schedule();
    expect(flush).not.toHaveBeenCalled();
    timer.fireAll();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("연속 schedule은 타이머를 하나만 유지해 interval당 flush 1회만 보장한다", () => {
    const timer = makeFakeTimer();
    const flush = vi.fn();
    const t = createTrailingThrottle(flush, 500, timer.schedule, timer.clear);

    t.schedule();
    t.schedule();
    t.schedule();
    expect(timer.pending()).toBe(1);
    timer.fireAll();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("flushNow는 즉시 flush하고 예약된 타이머를 취소한다(중복 flush 없음)", () => {
    const timer = makeFakeTimer();
    const flush = vi.fn();
    const t = createTrailingThrottle(flush, 500, timer.schedule, timer.clear);

    t.schedule();
    t.flushNow();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(timer.pending()).toBe(0);
    timer.fireAll();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("예약 없이 flushNow를 호출해도 즉시 flush한다", () => {
    const timer = makeFakeTimer();
    const flush = vi.fn();
    const t = createTrailingThrottle(flush, 500, timer.schedule, timer.clear);

    t.flushNow();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("cancel은 예약된 타이머만 취소하고 flush는 호출하지 않는다", () => {
    const timer = makeFakeTimer();
    const flush = vi.fn();
    const t = createTrailingThrottle(flush, 500, timer.schedule, timer.clear);

    t.schedule();
    t.cancel();
    expect(timer.pending()).toBe(0);
    expect(flush).not.toHaveBeenCalled();
    timer.fireAll();
    expect(flush).not.toHaveBeenCalled();
  });

  it("flush 발화 후 다시 schedule하면 다음 주기를 새로 예약한다", () => {
    const timer = makeFakeTimer();
    const flush = vi.fn();
    const t = createTrailingThrottle(flush, 500, timer.schedule, timer.clear);

    t.schedule();
    timer.fireAll();
    t.schedule();
    expect(timer.pending()).toBe(1);
    timer.fireAll();
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("flush가 throw해도 타이머 상태가 깨지지 않아 이후 schedule이 정상 동작한다", () => {
    const timer = makeFakeTimer();
    const flush = vi.fn(() => {
      throw new Error("persist failed");
    });
    const t = createTrailingThrottle(flush, 500, timer.schedule, timer.clear);

    t.schedule();
    expect(() => timer.fireAll()).not.toThrow();
    t.schedule();
    timer.fireAll();
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("전달한 interval을 그대로 타이머에 넘긴다", () => {
    const timer = makeFakeTimer();
    const t = createTrailingThrottle(vi.fn(), 1234, timer.schedule, timer.clear);
    t.schedule();
    expect(timer.lastMs()).toBe(1234);
  });
});
