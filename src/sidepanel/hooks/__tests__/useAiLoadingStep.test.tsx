import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAiLoadingStep } from "../useAiLoadingStep";

afterEach(() => vi.useRealTimers());

describe("useAiLoadingStep", () => {
  it("activeKey가 있으면 interval마다 step을 올린다", () => {
    vi.useFakeTimers();
    const { result } = renderHook(
      ({ k }) => useAiLoadingStep(k, 1000),
      { initialProps: { k: "styling" as string | null } },
    );
    expect(result.current).toBe(0);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(1);
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toBe(3);
  });

  it("activeKey가 바뀌면 step을 0으로 리셋한다", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ k }) => useAiLoadingStep(k, 1000),
      { initialProps: { k: "styling" as string | null } },
    );
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toBe(2);
    rerender({ k: "draft" });
    expect(result.current).toBe(0);
  });

  it("activeKey가 null이면 0을 유지한다", () => {
    vi.useFakeTimers();
    const { result } = renderHook(
      ({ k }) => useAiLoadingStep(k, 1000),
      { initialProps: { k: null as string | null } },
    );
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current).toBe(0);
  });
});
