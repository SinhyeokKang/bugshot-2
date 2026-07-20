import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { AiLoadingText } from "../AiLoadingText";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AiLoadingText", () => {
  it("문구가 바뀌면 이전 문구가 잠깐 함께 보인다", () => {
    vi.useFakeTimers();
    const { rerender, queryByText } = render(<AiLoadingText text="첫 문구" />);
    expect(queryByText("첫 문구")).toBeTruthy();

    rerender(<AiLoadingText text="둘째 문구" />);
    expect(queryByText("첫 문구")).toBeTruthy();
    expect(queryByText("둘째 문구")).toBeTruthy();
  });

  it("전환 800ms 뒤 이전 문구가 DOM에서 제거된다", () => {
    vi.useFakeTimers();
    const { rerender, queryByText } = render(<AiLoadingText text="첫 문구" />);
    rerender(<AiLoadingText text="둘째 문구" />);
    expect(queryByText("첫 문구")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(850);
    });

    expect(queryByText("첫 문구")).toBeNull();
    expect(queryByText("둘째 문구")).toBeTruthy();
  });
});
