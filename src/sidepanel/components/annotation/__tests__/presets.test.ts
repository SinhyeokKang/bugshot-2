import { describe, expect, it } from "vitest";
import {
  ANNOTATION_COLORS,
  ANNOTATION_THICKNESS,
  ANNOTATION_TOOLS,
  DEFAULT_COLOR,
  DEFAULT_THICKNESS,
  HIGHLIGHT_OPACITY,
  RECORDING_MIN_COLORS,
  recordingColorCount,
} from "../presets";

describe("presets — 색상", () => {
  it("색상은 5개다", () => {
    expect(ANNOTATION_COLORS).toHaveLength(5);
  });

  it("모든 색상은 hex 문자열이다", () => {
    for (const c of ANNOTATION_COLORS) {
      expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("중복 색상이 없다", () => {
    expect(new Set(ANNOTATION_COLORS).size).toBe(ANNOTATION_COLORS.length);
  });

  it("DEFAULT_COLOR는 색상 목록에 포함된다", () => {
    expect(ANNOTATION_COLORS).toContain(DEFAULT_COLOR);
  });
});

describe("presets — 두께", () => {
  it("S/M/L 3키를 가진다", () => {
    expect(Object.keys(ANNOTATION_THICKNESS).sort()).toEqual(["L", "M", "S"]);
  });

  it("모든 두께는 양수다", () => {
    expect(ANNOTATION_THICKNESS.S).toBeGreaterThan(0);
    expect(ANNOTATION_THICKNESS.M).toBeGreaterThan(0);
    expect(ANNOTATION_THICKNESS.L).toBeGreaterThan(0);
  });

  it("S < M < L 순서다", () => {
    expect(ANNOTATION_THICKNESS.S).toBeLessThan(ANNOTATION_THICKNESS.M);
    expect(ANNOTATION_THICKNESS.M).toBeLessThan(ANNOTATION_THICKNESS.L);
  });

  it("DEFAULT_THICKNESS는 유효한 두께 키다", () => {
    expect(Object.keys(ANNOTATION_THICKNESS)).toContain(DEFAULT_THICKNESS);
  });
});

describe("presets — 기타 상수", () => {
  it("HIGHLIGHT_OPACITY는 0~1 사이다", () => {
    expect(HIGHLIGHT_OPACITY).toBeGreaterThan(0);
    expect(HIGHLIGHT_OPACITY).toBeLessThanOrEqual(1);
  });

});

describe("presets — 녹화 footer 색 개수(폭 대응)", () => {
  it("넉넉하면 5색 전부", () => {
    expect(recordingColorCount(404)).toBe(5);
    expect(recordingColorCount(600)).toBe(5);
  });

  it("좁아지면 우측부터 하나씩 접어 4색", () => {
    expect(recordingColorCount(403)).toBe(4);
    expect(recordingColorCount(372)).toBe(4);
  });

  it("가장 좁으면 최소 3색 바닥", () => {
    expect(recordingColorCount(371)).toBe(RECORDING_MIN_COLORS);
    expect(recordingColorCount(0)).toBe(RECORDING_MIN_COLORS);
  });

  it("폭이 커질수록 색 개수는 단조 증가한다", () => {
    let prev = 0;
    for (let w = 0; w <= 500; w += 4) {
      const c = recordingColorCount(w);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });
});

describe("presets — 도구 목록", () => {
  it("7종 도구(select/arrow/rect/ellipse/pen/text/highlight)를 모두 포함한다", () => {
    const keys = ANNOTATION_TOOLS.map((t) => t.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "select",
        "arrow",
        "rect",
        "ellipse",
        "pen",
        "text",
        "highlight",
      ]),
    );
    expect(ANNOTATION_TOOLS).toHaveLength(7);
  });

  it("각 도구는 i18n 라벨 키를 가진다", () => {
    for (const t of ANNOTATION_TOOLS) {
      expect(typeof t.labelKey).toBe("string");
      expect(t.labelKey.length).toBeGreaterThan(0);
    }
  });

  it("도구 key는 중복되지 않는다", () => {
    const keys = ANNOTATION_TOOLS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
