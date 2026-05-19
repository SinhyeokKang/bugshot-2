import { describe, expect, it } from "vitest";
import {
  CAPTURE_COMMANDS,
  isCaptureEntryScreen,
  resolveCaptureShortcut,
} from "../capture-commands";

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

describe("resolveCaptureShortcut", () => {
  it("capture-element → 'element' (진입 화면에서)", () => {
    expect(resolveCaptureShortcut("capture-element", state())).toBe("element");
  });

  it("capture-screenshot → 'screenshot' (진입 화면에서)", () => {
    expect(resolveCaptureShortcut("capture-screenshot", state())).toBe("screenshot");
  });

  it("capture-video → 'video' (진입 화면에서)", () => {
    expect(resolveCaptureShortcut("capture-video", state())).toBe("video");
  });

  it("element 모드 + 선택 전이면 게이트 통과해 액션을 반환한다", () => {
    expect(
      resolveCaptureShortcut(
        "capture-element",
        state({ phase: "styling", captureMode: "element", selection: null }),
      ),
    ).toBe("element");
  });

  it("element 모드 + 선택 완료면 null (진행 중 작업 보호)", () => {
    expect(
      resolveCaptureShortcut(
        "capture-element",
        state({ phase: "styling", captureMode: "element", selection: { id: 1 } }),
      ),
    ).toBeNull();
  });

  it("screenshot 모드 + phase가 idle이 아니면 null", () => {
    expect(
      resolveCaptureShortcut(
        "capture-screenshot",
        state({ phase: "previewing", captureMode: "screenshot", selection: null }),
      ),
    ).toBeNull();
  });

  it("recording / drafting phase에서는 null", () => {
    expect(
      resolveCaptureShortcut("capture-video", state({ phase: "recording", captureMode: "video" })),
    ).toBeNull();
    expect(
      resolveCaptureShortcut("capture-element", state({ phase: "drafting", captureMode: "video" })),
    ).toBeNull();
  });

  it("미지 커맨드는 진입 화면이어도 null", () => {
    expect(resolveCaptureShortcut("capture-foo", state())).toBeNull();
    expect(resolveCaptureShortcut("_execute_action", state())).toBeNull();
  });

  it("빈/비정상 state(빈 phase 문자열)는 방어적으로 null", () => {
    expect(
      resolveCaptureShortcut(
        "capture-element",
        state({ phase: "", captureMode: "", selection: null }),
      ),
    ).toBeNull();
  });
});

describe("CAPTURE_COMMANDS", () => {
  it("캡처 커맨드 3개를 담는다", () => {
    expect([...CAPTURE_COMMANDS].sort()).toEqual(
      ["capture-element", "capture-screenshot", "capture-video"].sort(),
    );
  });
});
