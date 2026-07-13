import { describe, it, expect, vi } from "vitest";

import { runScrollCapture, type ScrollCaptureDeps, type TileShot } from "../scroll-capture";

import type { PageMetrics, PickerMessage } from "@/types/picker";

const VH = 600;
const METRICS: PageMetrics = {
  scrollHeight: 1200, // 타일 2개
  viewport: { width: 800, height: VH },
  devicePixelRatio: 1,
};

function makeDeps(over: Partial<ScrollCaptureDeps> = {}): {
  deps: ScrollCaptureDeps;
  sent: PickerMessage[];
  stitched: TileShot[];
} {
  const sent: PickerMessage[] = [];
  const stitched: TileShot[] = [];
  const deps: ScrollCaptureDeps = {
    send: vi.fn(async (_tabId: number, msg: PickerMessage) => {
      sent.push(msg);
      if (msg.type === "picker.beginScrollCapture") return { metrics: METRICS };
      if (msg.type === "picker.scrollCaptureTo") return { y: msg.y };
      return undefined;
    }) as ScrollCaptureDeps["send"],
    captureTab: vi.fn(async () => "data:image/png;base64,tile"),
    isTabActive: vi.fn(async () => true),
    createStitcher: () => ({
      add: async (tile) => {
        stitched.push(tile);
      },
      finish: async () => "data:image/webp;base64,stitched",
    }),
    ...over,
  };
  return { deps, sent, stitched };
}

function types(sent: PickerMessage[]): string[] {
  return sent.map((m) => m.type);
}

describe("runScrollCapture", () => {
  it("정상 흐름 — begin → 타일별 scroll+capture → end, 스티치 결과 반환", async () => {
    const { deps, sent, stitched } = makeDeps();
    const onProgress = vi.fn();

    const result = await runScrollCapture(1, {
      onProgress,
      signal: new AbortController().signal,
      deps,
    });

    expect(types(sent)).toEqual([
      "picker.beginScrollCapture",
      "picker.scrollCaptureTo",
      "picker.scrollCaptureTo",
      "picker.endScrollCapture",
    ]);
    expect(deps.captureTab).toHaveBeenCalledTimes(2);
    // 타일을 모아뒀다 한 번에 디코드하지 않고 캡처 즉시 스티치(메모리 스파이크 방지).
    expect(stitched.map((s) => s.index)).toEqual([0, 1]);
    expect(onProgress).toHaveBeenNthCalledWith(1, 1, 2);
    expect(onProgress).toHaveBeenNthCalledWith(2, 2, 2);
    expect(result.dataUrl).toBe("data:image/webp;base64,stitched");
    expect(result.viewport).toEqual(METRICS.viewport);
    expect(result.truncated).toBe(false);
  });

  it("첫 타일만 고정 요소를 남기고 이후 타일은 hideFixed=true", async () => {
    const { deps, sent } = makeDeps();

    await runScrollCapture(1, { onProgress: vi.fn(), signal: new AbortController().signal, deps });

    const scrolls = sent.filter(
      (m): m is Extract<PickerMessage, { type: "picker.scrollCaptureTo" }> =>
        m.type === "picker.scrollCaptureTo",
    );
    expect(scrolls.map((m) => m.hideFixed)).toEqual([false, true]);
    expect(scrolls.map((m) => m.y)).toEqual([0, VH]);
  });

  it("중간 타일 캡처가 throw해도 endScrollCapture는 반드시 나간다", async () => {
    const captureTab = vi.fn(async () => {
      throw new Error("quota exceeded");
    });
    const { deps, sent } = makeDeps({ captureTab });

    await expect(
      runScrollCapture(1, { onProgress: vi.fn(), signal: new AbortController().signal, deps }),
    ).rejects.toThrow("quota exceeded");

    expect(types(sent)).toContain("picker.endScrollCapture");
  });

  it("abort되면 남은 타일을 캡처하지 않고 end로 복원한다", async () => {
    const controller = new AbortController();
    const captureTab = vi.fn(async () => {
      controller.abort(); // 첫 타일 직후 취소
      return "data:image/png;base64,tile";
    });
    const { deps, sent } = makeDeps({ captureTab });

    await expect(
      runScrollCapture(1, { onProgress: vi.fn(), signal: controller.signal, deps }),
    ).rejects.toThrow();

    expect(captureTab).toHaveBeenCalledTimes(1);
    expect(types(sent)).toContain("picker.endScrollCapture");
  });

  it("탭이 비활성이면 중단한다 (다른 탭 화면 오염 방지)", async () => {
    const { deps, sent } = makeDeps({ isTabActive: vi.fn(async () => false) });

    await expect(
      runScrollCapture(1, { onProgress: vi.fn(), signal: new AbortController().signal, deps }),
    ).rejects.toThrow();

    expect(deps.captureTab).not.toHaveBeenCalled();
    expect(types(sent)).toContain("picker.endScrollCapture");
  });

  it("content script 응답이 undefined면(주입 소실) 중단한다", async () => {
    const { deps } = makeDeps({
      send: vi.fn(async () => undefined) as ScrollCaptureDeps["send"],
    });

    await expect(
      runScrollCapture(1, { onProgress: vi.fn(), signal: new AbortController().signal, deps }),
    ).rejects.toThrow();

    expect(deps.captureTab).not.toHaveBeenCalled();
  });

  it("타일 상한에 걸린 페이지는 truncated true로 반환한다", async () => {
    const longMetrics: PageMetrics = {
      scrollHeight: VH * 100,
      viewport: { width: 800, height: VH },
      devicePixelRatio: 1,
    };
    const { deps } = makeDeps({
      send: vi.fn(async (_tabId: number, msg: PickerMessage) => {
        if (msg.type === "picker.beginScrollCapture") return { metrics: longMetrics };
        if (msg.type === "picker.scrollCaptureTo") return { y: msg.y };
        return undefined;
      }) as ScrollCaptureDeps["send"],
    });

    const result = await runScrollCapture(1, {
      onProgress: vi.fn(),
      signal: new AbortController().signal,
      deps,
    });

    expect(result.truncated).toBe(true);
    expect(deps.captureTab).toHaveBeenCalledTimes(20);
  });
});
