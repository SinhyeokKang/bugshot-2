import { describe, it, expect, vi } from "vitest";
import { createLogPersistGuard } from "../log-persist-guard";

function makeFakeTimer() {
  let nextId = 1;
  const timers = new Map<number, () => void>();
  return {
    schedule: (cb: () => void): number => {
      const id = nextId++;
      timers.set(id, cb);
      return id;
    },
    clear: (id: number): void => {
      timers.delete(id);
    },
    fireAll: (): void => {
      for (const [id, cb] of [...timers]) {
        timers.delete(id);
        cb();
      }
    },
    pending: (): number => timers.size,
  };
}

describe("createLogPersistGuard", () => {
  it("push N회 후 타이머 발화 시 마지막 payload만 1회 저장한다(throttle)", () => {
    const save = vi.fn();
    const timer = makeFakeTimer();
    const g = createLogPersistGuard<number>(save, 1000, timer.schedule, timer.clear);

    g.push("k", 1);
    g.push("k", 2);
    g.push("k", 3);
    expect(save).not.toHaveBeenCalled();
    expect(timer.pending()).toBe(1); // 예약 1개만

    timer.fireAll();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("k", 3); // 최신본
  });

  it("flushNow는 대기 payload를 즉시 저장하고 예약을 취소한다", () => {
    const save = vi.fn();
    const timer = makeFakeTimer();
    const g = createLogPersistGuard<number>(save, 1000, timer.schedule, timer.clear);

    g.push("k", 42);
    g.flushNow();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("k", 42);
    expect(timer.pending()).toBe(0);

    timer.fireAll(); // 남은 예약 없음 → 추가 저장 없음
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("대기 payload 없이 flushNow하면 저장하지 않는다", () => {
    const save = vi.fn();
    const timer = makeFakeTimer();
    const g = createLogPersistGuard<number>(save, 1000, timer.schedule, timer.clear);

    g.flushNow();
    expect(save).not.toHaveBeenCalled();
  });

  it("discard는 예약과 대기 payload를 폐기해 이후 flush가 저장하지 않는다", () => {
    const save = vi.fn();
    const timer = makeFakeTimer();
    const g = createLogPersistGuard<number>(save, 1000, timer.schedule, timer.clear);

    g.push("k", 7);
    g.discard();
    expect(timer.pending()).toBe(0);

    timer.fireAll();
    g.flushNow(); // discard로 payload가 비워졌으므로 저장 안 됨
    expect(save).not.toHaveBeenCalled();
  });

  it("save가 throw하면 pending을 보존해 다음 flush에서 재시도한다", () => {
    const save = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("IDB write failed");
      })
      .mockImplementation(() => {});
    const timer = makeFakeTimer();
    const g = createLogPersistGuard<number>(save, 1000, timer.schedule, timer.clear);

    g.push("k", 9);
    timer.fireAll(); // 1차 flush: save throw → pending 보존
    expect(save).toHaveBeenCalledTimes(1);

    g.flushNow(); // 재시도: 동일 payload 저장
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("k", 9);
  });

  it("discard 후 다시 push하면 정상적으로 재예약·저장된다", () => {
    const save = vi.fn();
    const timer = makeFakeTimer();
    const g = createLogPersistGuard<number>(save, 1000, timer.schedule, timer.clear);

    g.push("k", 1);
    g.discard();
    g.push("k", 2);
    timer.fireAll();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("k", 2);
  });
});
