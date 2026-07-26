import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/i18n", () => ({ useT: () => (key: string) => key, t: (key: string) => key }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/sidepanel/picker-control", () => ({ syncAndSettleLogs: vi.fn() }));
vi.mock("@/sidepanel/lib/log-merge", () => ({ trimByTime: vi.fn(), replayLogBounds: vi.fn() }));
vi.mock("@/store/blob-db", () => ({
  saveNetworkLog: vi.fn(),
  saveConsoleLog: vi.fn(),
  saveActionLog: vi.fn(),
}));
vi.mock("@/sidepanel/hooks/usePickerMessages", () => ({
  networkLogPersist: { flush: vi.fn() },
  consoleLogPersist: { flush: vi.fn() },
  actionLogPersist: { flush: vi.fn() },
}));
vi.mock("./../mp4-encoder", () => ({ encodeToMp4: vi.fn() }));
vi.mock("@/store/editor-store", () => ({
  useEditorStore: {
    getState: () => ({ phase: "idle" }),
    setState: vi.fn(),
    subscribe: () => () => {},
  },
}));

const sendBg = vi.fn();
vi.mock("@/types/messages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/types/messages")>();
  return { ...actual, sendBg: (req: unknown) => sendBg(req) };
});

import { use30sReplay } from "../use-30s-replay";

// "<all_urls>가 required라 권한 확인 없이 폴링을 시작한다"는 전제가 패널이 미지원 페이지에
// 존재할 수 없다는 가정에 기대고 있었고, 이번 변경이 그 가정을 깬다.
describe("use30sReplay — enabled 게이트", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sendBg.mockReset();
    sendBg.mockResolvedValue("data:image/jpeg;base64,x");
    vi.stubGlobal("chrome", {
      tabs: { get: vi.fn(() => Promise.resolve({ active: true })) },
      storage: { session: { get: vi.fn(() => Promise.resolve({})), set: vi.fn(() => Promise.resolve()) } },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ blob: () => Promise.resolve(new Blob(["x"])) })),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("enabled=false면 폴링을 시작하지 않는다 (captureVisibleTab 미호출)", async () => {
    renderHook(() => use30sReplay(1, false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(sendBg).not.toHaveBeenCalled();
  });

  it("tabId가 null이면 폴링을 시작하지 않는다", async () => {
    renderHook(() => use30sReplay(null, true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(sendBg).not.toHaveBeenCalled();
  });

  it("enabled=true + tabId가 있으면 폴링해 captureVisibleTab을 호출한다 (회귀 방지)", async () => {
    renderHook(() => use30sReplay(1, true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
    });
    expect(sendBg).toHaveBeenCalled();
    expect(sendBg.mock.calls[0][0]).toMatchObject({ type: "captureVisibleTab", tabId: 1 });
  });

  it("suspended=true면 폴링하지 않는다 (미지원 페이지)", async () => {
    renderHook(() => use30sReplay(1, true, true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(sendBg).not.toHaveBeenCalled();
  });

  // enabled를 끄면 effect가 재실행돼 buffer.clear()가 돌지만 suspended는 tick만 막는다.
  // 지원 → chrome:// → 지원 왕복에서 모아둔 프레임이 살아 있어야 한다.
  it("suspended가 true→false로 풀리면 폴링이 재개된다 (버퍼 유지 경로)", async () => {
    const { rerender } = renderHook(
      ({ off }: { off: boolean }) => use30sReplay(1, true, off),
      { initialProps: { off: true } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(sendBg).not.toHaveBeenCalled();

    rerender({ off: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
    });
    expect(sendBg).toHaveBeenCalled();
  });

  // 이게 suspended를 enabled와 분리한 진짜 이유다 — ARCHITECTURE.md는 replay 버퍼가
  // 네비게이션과 무관하게 유지된다고 명시한다. enabled를 끄면 teardown이 buffer.clear()까지
  // 돌아 모아둔 30초가 날아간다.
  it("suspended는 모아둔 버퍼를 유지한다 (isReady 보존)", async () => {
    const { result, rerender } = renderHook(
      ({ off }: { off: boolean }) => use30sReplay(1, true, off),
      { initialProps: { off: false } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(result.current.isReady).toBe(true);

    rerender({ off: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current.isReady).toBe(true);
  });

  it("반대로 enabled를 끄면 버퍼가 비워진다 (대조군)", async () => {
    const { result, rerender } = renderHook(
      ({ on }: { on: boolean }) => use30sReplay(1, on),
      { initialProps: { on: true } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(result.current.isReady).toBe(true);

    rerender({ on: false });
    expect(result.current.isReady).toBe(false);
  });

  it("enabled가 true→false로 바뀌면 폴링이 멎는다", async () => {
    const { rerender } = renderHook(({ on }: { on: boolean }) => use30sReplay(1, on), {
      initialProps: { on: true },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
    });
    const before = sendBg.mock.calls.length;
    expect(before).toBeGreaterThan(0);

    rerender({ on: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(sendBg.mock.calls.length).toBe(before);
  });
});
