import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getElapsedSec = vi.fn<() => number>();
const getMaxDuration = vi.fn<() => number>();

vi.mock("@/sidepanel/video-recorder", () => ({
  getElapsedSec: () => getElapsedSec(),
  getMaxDuration: () => getMaxDuration(),
}));

import { useRecordingElapsed } from "../useRecordingElapsed";

describe("useRecordingElapsed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getElapsedSec.mockReset();
    getMaxDuration.mockReset();
    getElapsedSec.mockReturnValue(0);
    getMaxDuration.mockReturnValue(120);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("마운트 직후 getElapsedSec() 값이 바로 반영된다", () => {
    getElapsedSec.mockReturnValue(7);
    const { result } = renderHook(() => useRecordingElapsed());
    expect(result.current.elapsedSec).toBe(7);
  });

  // 이펙트가 돌기 전(서버 렌더는 이펙트를 실행하지 않는다)의 첫 렌더가 이미 값을 들고 있어야 0:00 깜빡임이 없다.
  it("첫 렌더(이펙트 flush 전)에 이미 getElapsedSec() 값이 반영돼 있다", () => {
    getElapsedSec.mockReturnValue(12);
    function Probe() {
      return <span>{useRecordingElapsed().elapsedSec}</span>;
    }
    expect(renderToString(<Probe />)).toContain(">12<");
  });

  it("elapsed가 0이면 0이다", () => {
    const { result } = renderHook(() => useRecordingElapsed());
    expect(result.current.elapsedSec).toBe(0);
  });

  it("500ms 진행마다 갱신된다", () => {
    getElapsedSec.mockReturnValue(1);
    const { result } = renderHook(() => useRecordingElapsed());
    expect(result.current.elapsedSec).toBe(1);

    getElapsedSec.mockReturnValue(2);
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(result.current.elapsedSec).toBe(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.elapsedSec).toBe(2);

    getElapsedSec.mockReturnValue(3);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.elapsedSec).toBe(3);
  });

  // stopRecording 뒤 onstop이 state=null을 먼저 하고 썸네일·settle을 await하는 동안 getElapsedSec가 0을 돌려준다.
  it("45를 반환하다가 0을 반환하면 45를 유지한다", () => {
    getElapsedSec.mockReturnValue(45);
    const { result } = renderHook(() => useRecordingElapsed());
    expect(result.current.elapsedSec).toBe(45);

    getElapsedSec.mockReturnValue(0);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.elapsedSec).toBe(45);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current.elapsedSec).toBe(45);
  });

  it("0이 아닌 새 값은 그대로 반영한다", () => {
    getElapsedSec.mockReturnValue(45);
    const { result } = renderHook(() => useRecordingElapsed());
    getElapsedSec.mockReturnValue(46);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.elapsedSec).toBe(46);
  });

  it("언마운트 시 interval을 해제한다", () => {
    const { unmount } = renderHook(() => useRecordingElapsed());
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("maxSec === getMaxDuration()", () => {
    getMaxDuration.mockReturnValue(90);
    const { result } = renderHook(() => useRecordingElapsed());
    expect(result.current.maxSec).toBe(90);
  });

  it("새로 마운트하면 이전 녹화의 마지막 값이 새지 않는다", () => {
    getElapsedSec.mockReturnValue(45);
    const first = renderHook(() => useRecordingElapsed());
    first.unmount();

    getElapsedSec.mockReturnValue(0);
    const second = renderHook(() => useRecordingElapsed());
    expect(second.result.current.elapsedSec).toBe(0);
  });
});
