// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { scheduleDeferredExport, useDeferredExport } from "../deferredExport";

describe("scheduleDeferredExport", () => {
  it("취소 뒤 예약 콜백을 실행하지 않는다", () => {
    let pending: FrameRequestCallback = () => {};
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      pending = callback;
      return 17;
    });
    const cancelFrame = vi.fn();
    const callback = vi.fn();

    const cancel = scheduleDeferredExport(callback, requestFrame, cancelFrame);
    cancel();
    pending(0);

    expect(cancelFrame).toHaveBeenCalledWith(17);
    expect(callback).not.toHaveBeenCalled();
  });

  it("소유 컴포넌트가 언마운트되면 pending export를 취소한다", () => {
    let pending: FrameRequestCallback = () => {};
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      pending = callback;
      return 23;
    });
    const cancelFrame = vi.fn();
    const callback = vi.fn();
    const { result, unmount } = renderHook(() =>
      useDeferredExport(requestFrame, cancelFrame),
    );

    result.current(callback);
    unmount();
    pending(0);

    expect(cancelFrame).toHaveBeenCalledWith(23);
    expect(callback).not.toHaveBeenCalled();
  });
});
