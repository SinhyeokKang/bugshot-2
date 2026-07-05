import { describe, it, expect } from "vitest";
import { overlayStrokeStyle } from "../recording-pen";
import {
  ANNOTATION_THICKNESS,
  HIGHLIGHT_OPACITY,
  HIGHLIGHT_STROKE_SCALE,
} from "../presets";

describe("overlayStrokeStyle — 녹화 오버레이 펜 스타일 매핑", () => {
  it("pen → 프리셋 두께 그대로 + 불투명(opacity 1)", () => {
    expect(overlayStrokeStyle("pen", "S")).toEqual({ strokeWidth: 2, opacity: 1 });
    expect(overlayStrokeStyle("pen", "M")).toEqual({ strokeWidth: 4, opacity: 1 });
    expect(overlayStrokeStyle("pen", "L")).toEqual({ strokeWidth: 8, opacity: 1 });
  });

  it("highlight → 두께 배율(×4) + 반투명(0.4)", () => {
    expect(overlayStrokeStyle("highlight", "S")).toEqual({ strokeWidth: 8, opacity: 0.4 });
    expect(overlayStrokeStyle("highlight", "M")).toEqual({ strokeWidth: 16, opacity: 0.4 });
    expect(overlayStrokeStyle("highlight", "L")).toEqual({ strokeWidth: 32, opacity: 0.4 });
  });

  it("프리셋 상수(ANNOTATION_THICKNESS·HIGHLIGHT_*)에서 파생된다(하드코딩 아님)", () => {
    const k = "M";
    expect(overlayStrokeStyle("pen", k).strokeWidth).toBe(ANNOTATION_THICKNESS[k]);
    expect(overlayStrokeStyle("highlight", k).strokeWidth).toBe(
      ANNOTATION_THICKNESS[k] * HIGHLIGHT_STROKE_SCALE,
    );
    expect(overlayStrokeStyle("highlight", k).opacity).toBe(HIGHLIGHT_OPACITY);
  });
});
