import { describe, it, expect, vi, beforeEach } from "vitest";

import type { CaptureContext } from "@/types/picker";

const mockCapture = vi.hoisted(() => vi.fn());

vi.mock("@/sidepanel/capture", () => ({
  captureElementSnapshot: mockCapture,
}));

// 스토어 전체 그래프(IDB·레코더)를 끌어오지 않고 훅의 계약만 본다: after가 찍힌 기준과
// 커밋 시점 기준이 갈렸을 때 무엇을 버퍼에 넘기는가.
const state = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("@/store/editor-store", () => ({
  useEditorStore: { getState: () => state.current },
}));

import { useBufferThenSwitch } from "../useBufferThenSwitch";

const DIALOG_CTX: CaptureContext = {
  contextSelector: '[role="dialog"]#dlg',
  rect: { x: 10, y: 20, width: 300, height: 200 },
  viewport: { width: 1000, height: 800 },
  scrollX: 0,
  scrollY: 0,
};

const SELECTION = {
  selector: "button.cta",
  frameId: 0,
  classList: ["cta"],
  specifiedStyles: {},
  computedStyles: { color: "#000000" },
  text: null,
};

const EDITS = { classList: ["cta"], inlineStyle: { color: "#ffffff" }, text: "" };

function setup(captureContext: CaptureContext | null) {
  const bufferCurrentElement = vi.fn();
  state.current = {
    selection: SELECTION,
    styleEdits: EDITS,
    beforeImage: null,
    captureContext,
    bufferCurrentElement,
  };
  return bufferCurrentElement;
}

beforeEach(() => {
  mockCapture.mockReset();
});

describe("useBufferThenSwitch", () => {
  it("기준이 유지되면 after 이미지를 그대로 버퍼에 넘긴다", async () => {
    const bufferCurrentElement = setup(DIALOG_CTX);
    mockCapture.mockResolvedValue({ image: "data:after", context: DIALOG_CTX });

    await useBufferThenSwitch()(1, () => {});

    // context를 안 실으면 after가 확장을 잃는다 — 인자까지 고정한다.
    expect(mockCapture).toHaveBeenCalledWith(1, {
      frameId: 0,
      context: DIALOG_CTX,
    });
    expect(bufferCurrentElement).toHaveBeenCalledWith("data:after", DIALOG_CTX);
  });

  // POSTMORTEM 2026-07-29: before 캡처가 in-flight인 동안 전환하면 after는 낡은 기준
  // (확장 없음)으로 찍히는데, 그 await 창에 before가 확장본으로 착지해 한 카드 안에서
  // before/after 기준이 갈린다. 잠금은 StyleEditorPanel 한 문에만 있었다.
  it("캡처 창 안에 before가 확장본으로 착지하면 after를 버린다", async () => {
    const bufferCurrentElement = setup(null);
    mockCapture.mockImplementation(async () => {
      // 늦게 도착한 before 캡처가 store 기준을 확장본으로 갈아치운다.
      state.current.beforeImage = "data:before-expanded";
      state.current.captureContext = DIALOG_CTX;
      return { image: "data:after-bbox", context: null };
    });

    await useBufferThenSwitch()(1, () => {});

    expect(bufferCurrentElement).toHaveBeenCalledWith(null, DIALOG_CTX);
  });

  it("착지한 before가 확장에 실패했으면 기준이 같으므로 after를 유지한다", async () => {
    const rejected: CaptureContext = { ...DIALOG_CTX, contextSelector: null };
    const bufferCurrentElement = setup(null);
    mockCapture.mockImplementation(async () => {
      state.current.beforeImage = "data:before-bbox";
      state.current.captureContext = rejected;
      return { image: "data:after-bbox", context: null };
    });

    await useBufferThenSwitch()(1, () => {});

    expect(bufferCurrentElement).toHaveBeenCalledWith("data:after-bbox", rejected);
  });

  it("diff가 없으면 캡처도 버퍼도 없이 전환만 한다", async () => {
    const bufferCurrentElement = setup(null);
    state.current.styleEdits = { classList: ["cta"], inlineStyle: {}, text: "" };
    const switchAction = vi.fn();

    await useBufferThenSwitch()(1, switchAction);

    expect(mockCapture).not.toHaveBeenCalled();
    expect(bufferCurrentElement).not.toHaveBeenCalled();
    expect(switchAction).toHaveBeenCalledOnce();
  });
});
