import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withTimeout } from "@/lib/with-timeout";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("withTimeout", () => {
  it("시한 안에 resolve하면 그 값을 그대로 돌려준다", async () => {
    const p = withTimeout(Promise.resolve("ok"), 1000, "load");

    await expect(p).resolves.toBe("ok");
  });

  it("시한 안에 reject하면 원래 에러를 그대로 올린다", async () => {
    const original = new Error("decode failed");

    const p = withTimeout(Promise.reject(original), 1000, "load");

    await expect(p).rejects.toBe(original);
  });

  it("시한을 넘기면 label을 실은 에러로 reject한다", async () => {
    const p = withTimeout(new Promise(() => {}), 1000, "seek");
    const assertion = expect(p).rejects.toThrow("seek timed out");

    await vi.advanceTimersByTimeAsync(1000);

    await assertion;
  });

  it("시한 직전에는 아직 reject하지 않는다", async () => {
    const settled = vi.fn();
    void withTimeout(new Promise(() => {}), 1000, "seek").catch(settled);

    await vi.advanceTimersByTimeAsync(999);

    expect(settled).not.toHaveBeenCalled();
  });

  // clearTimeout을 빠뜨려도 위 케이스들은 전부 통과한다 — 남은 타이머는 이미 settle된
  // Promise를 다시 reject하려 들고, 그게 unhandled rejection으로 샌다.
  // 정리는 `.finally`라 await 재개보다 한 마이크로태스크 뒤다(원본 2벌도 동일) — 그래서
  // 바로 세면 항상 1이 나온다. flush 후에 센다.
  it("resolve한 뒤에는 타이머가 남아있지 않다", async () => {
    await withTimeout(Promise.resolve("ok"), 1000, "load");
    await Promise.resolve();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("reject한 뒤에도 타이머가 남아있지 않다", async () => {
    await withTimeout(Promise.reject(new Error("x")), 1000, "load").catch(() => {});
    await Promise.resolve();

    expect(vi.getTimerCount()).toBe(0);
  });
});
