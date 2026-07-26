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

// 30s Replay의 600ms 폴링엔 지원 URL 게이트가 없었다 — "<all_urls>가 required라 권한 확인 없이
// 폴링을 시작한다"는 전제가 패널이 미지원 페이지에 존재할 수 없다는 가정에 기대고 있었고,
// 미지원 페이지에서 패널이 열리게 되면서 그 가정이 깨진다. 웹스토어는 https라 캡처가 실제로
// 성공하므로 "캡처할 수 없습니다"라고 써놓고 계속 찍는 상태가 된다.
// App.tsx는 `unsupported`를 `suspended`로 넘긴다 — `enabled`로 넘기면 effect가 재실행돼
// buffer.clear()까지 돌아 왕복 시 30초가 날아간다.
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

  it("suspended는 interval을 살려둔다 — 재개에 새 effect가 필요하지 않다", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const { rerender } = renderHook(
      ({ off }: { off: boolean }) => use30sReplay(1, true, off),
      { initialProps: { off: false } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
    });
    clearSpy.mockClear();
    rerender({ off: true });
    expect(clearSpy).not.toHaveBeenCalled();
    clearSpy.mockRestore();
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
