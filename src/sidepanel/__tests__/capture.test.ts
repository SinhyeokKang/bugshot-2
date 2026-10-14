import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { onCaptureFailed } from "@/lib/app-events";
import { captureInactiveMessage } from "@/lib/capture-messages";
import type { PrepareCaptureResponse } from "@/types/picker";

const prepareCapture = vi.fn<(...args: unknown[]) => Promise<PrepareCaptureResponse | null>>();
const prepareCaptureBySelector = vi.fn<(...args: unknown[]) => Promise<PrepareCaptureResponse | null>>();
const endCapture = vi.fn(async () => {});
const sendBg = vi.fn<(...args: unknown[]) => Promise<string>>();

vi.mock("../picker-control", async () => {
  const { isActiveTabPermissionError } = await import("../lib/capture-error");
  const { onPickerPermissionExpired } = await import("@/lib/app-events");
  return {
    prepareCapture: (...a: unknown[]) => prepareCapture(...a),
    prepareCaptureBySelector: (...a: unknown[]) => prepareCaptureBySelector(...a),
    endCapture: () => endCapture(),
    // 실제 구현과 같은 판정 — 권한 만료면 다이얼로그 이벤트를 띄우고 true.
    maybeSurfacePermissionExpired: (err: unknown) => {
      if (!isActiveTabPermissionError(err)) return false;
      onPickerPermissionExpired.fire();
      return true;
    },
  };
});

vi.mock("@/lib/bg-client", () => ({
  sendBg: (...a: unknown[]) => sendBg(...a),
}));

const { captureElementSnapshot, captureElementSnapshotBySelector } = await import("../capture");
const { setActiveTabExpiryDeferred } = await import("../lib/capture-error");

const PREP: PrepareCaptureResponse = {
  rect: { x: 10, y: 10, width: 100, height: 40 },
  viewport: { width: 800, height: 600 },
  scrollX: 0,
  scrollY: 0,
  contextSelector: null,
};

describe("captureWithPrep 실패 발화 (경로당 한 곳)", () => {
  const failed = vi.fn();
  let off: () => void = () => {};

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    prepareCapture.mockReset();
    prepareCaptureBySelector.mockReset();
    sendBg.mockReset();
    endCapture.mockClear();
    failed.mockReset();
    off = onCaptureFailed.subscribe(failed);
    setActiveTabExpiryDeferred(false);
  });

  afterEach(() => {
    off();
    setActiveTabExpiryDeferred(false);
    vi.restoreAllMocks();
  });

  it("prepare가 rect를 못 주면(요소 소실) element-missing 1회", async () => {
    prepareCapture.mockResolvedValue(null);

    await expect(captureElementSnapshot(1)).resolves.toBeNull();

    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith("element-missing");
    expect(sendBg).not.toHaveBeenCalled();
    expect(endCapture).toHaveBeenCalled();
  });

  it("by-selector 재캡처도 selector 미일치면 element-missing 1회", async () => {
    prepareCaptureBySelector.mockResolvedValue(null);

    await expect(captureElementSnapshotBySelector(1, ".gone")).resolves.toBeNull();

    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith("element-missing");
  });

  // 좌표 기준 강등은 의도된 스킵이다 — "No snapshot"만 남기고 에러로 오인시키지 않는다.
  it("basis downgrade(!usable)는 발화하지 않는다", async () => {
    prepareCapture.mockResolvedValue({ ...PREP, rect: { x: 0, y: 0, width: 0, height: 0 } });

    await expect(
      captureElementSnapshot(1, {
        frameId: 2,
        context: {
          contextSelector: null,
          rect: PREP.rect,
          viewport: PREP.viewport,
          scrollX: 0,
          scrollY: 0,
        },
      }),
    ).resolves.toBeNull();

    expect(failed).not.toHaveBeenCalled();
    expect(sendBg).not.toHaveBeenCalled();
  });

  it("관문이 비활성 탭으로 거부하면 inactive 1회", async () => {
    prepareCapture.mockResolvedValue(PREP);
    sendBg.mockRejectedValue(new Error(captureInactiveMessage(1)));

    await expect(captureElementSnapshot(1)).resolves.toBeNull();

    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith("inactive");
    expect(endCapture).toHaveBeenCalled();
  });

  it("그 외 throw는 other 1회", async () => {
    prepareCapture.mockResolvedValue(PREP);
    sendBg.mockRejectedValue(new Error("No tab with id: 1."));

    await captureElementSnapshot(1);

    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith("other");
  });

  it("권한 만료는 다이얼로그만 — 토스트 미발화", async () => {
    const { onPickerPermissionExpired } = await import("@/lib/app-events");
    const dialog = vi.fn();
    const offDialog = onPickerPermissionExpired.subscribe(dialog);
    prepareCapture.mockResolvedValue(PREP);
    sendBg.mockRejectedValue(
      new Error("Either the '<all_urls>' or 'activeTab' permission is required."),
    );

    await captureElementSnapshot(1);
    offDialog();

    expect(dialog).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  });

  it("지연 권한 만료 플래그가 켜져 있으면 발화하지 않는다", async () => {
    setActiveTabExpiryDeferred(true);
    prepareCapture.mockResolvedValue(null);

    await captureElementSnapshot(1);

    expect(failed).not.toHaveBeenCalled();
  });
});
