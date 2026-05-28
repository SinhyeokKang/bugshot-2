import { describe, expect, it, vi } from "vitest";
import { retryResolve } from "../jira-api";

const noSleep = () => Promise.resolve();

describe("retryResolve", () => {
  it("첫 시도 성공 시 재시도 안 함", async () => {
    const attempt = vi.fn(async () => "ok");
    const result = await retryResolve(attempt, [10, 20], noSleep);
    expect(result).toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("실패하다가 마지막 시도에 성공 (총 3회 시도)", async () => {
    const attempt = vi
      .fn<() => Promise<string | undefined>>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce("late");
    const result = await retryResolve(attempt, [10, 20], noSleep);
    expect(result).toBe("late");
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("모두 실패하면 undefined, 시도 횟수는 delays+1", async () => {
    const attempt = vi.fn(async () => undefined);
    const result = await retryResolve(attempt, [10, 20], noSleep);
    expect(result).toBeUndefined();
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("delays가 비면 단일 시도", async () => {
    const attempt = vi.fn(async () => undefined);
    const result = await retryResolve(attempt, [], noSleep);
    expect(result).toBeUndefined();
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("성공 후에는 남은 지연/시도를 건너뜀", async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const attempt = vi
      .fn<() => Promise<string | undefined>>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce("ok");
    await retryResolve(attempt, [10, 20], sleep);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(10);
  });
});
