import { describe, expect, it } from "vitest";
import { isCaptureEntryScreen } from "../capture-commands";

type GateState = Parameters<typeof isCaptureEntryScreen>[0];

function state(overrides: Partial<GateState> = {}): GateState {
  return { phase: "idle", captureMode: "element", selection: null, ...overrides };
}

describe("isCaptureEntryScreen", () => {
  it("phase가 idle이면 진입 화면이다", () => {
    expect(isCaptureEntryScreen(state({ phase: "idle" }))).toBe(true);
  });

  it("element 모드 + 선택 전(selection null)이면 진입 화면이다", () => {
    expect(
      isCaptureEntryScreen(state({ phase: "styling", captureMode: "element", selection: null })),
    ).toBe(true);
  });

  it("element 모드 + 선택 완료(selection 있음)면 진입 화면이 아니다", () => {
    expect(
      isCaptureEntryScreen(
        state({ phase: "styling", captureMode: "element", selection: { id: 1 } }),
      ),
    ).toBe(false);
  });

  it("idle이 아니고 element 모드도 아니면 진입 화면이 아니다", () => {
    expect(
      isCaptureEntryScreen(state({ phase: "drafting", captureMode: "screenshot", selection: null })),
    ).toBe(false);
  });
});
