import { describe, expect, it } from "vitest";
import {
  ANNOTATION_COLORS,
  ANNOTATION_THICKNESS,
  ANNOTATION_TOOLS,
  DEFAULT_COLOR,
  DEFAULT_THICKNESS,
  HIGHLIGHT_OPACITY,
  RECORDING_MIN_COLORS,
  isStrokeTool,
  recordingColorCount,
  type AnnotationTool,
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

// ── isStrokeTool 전수 표 ────────────────────────────────────────────────────
// 타입이 `Record<AnnotationTool, boolean>`인 게 이 표의 본체다 — 배열 리터럴로 쓰면
// AnnotationTool union에 도구가 늘어도 컴파일이 안 깨져 전수성이 무음으로 새어나간다.
// 기대값은 손으로 쓴 리터럴이다. STROKE_TOOLS를 import해 대조하면 항진명제가 된다.
//
// 사실 ① 이 함수는 오늘 **UI 동작을 봉인하지 않는다.** 유일 소비처가
//   `AnnotationToolbar.tsx:89`의 `thicknessEnabled = !styleDisabled && isStrokeTool(styleTool)`
//   하나인데, 그 값이 실제로 읽히는 자리는 `showTextSize`(:90, `styleTool === "text"`)의
//   else 가지뿐이라 text가 이미 걸러진 뒤고, styleTool은 애초에 select가 될 수 없다
//   (`AnnotationOverlay.tsx:566` — select면 lastDrawTool로 대체, lastDrawTool은 non-select만
//   대입). 즉 소비 시점의 styleTool ∈ {arrow,rect,ellipse,pen,highlight}라 항상 true인
//   dead guard다. 이 표의 실질 가치는 UI 회귀 방지가 아니라 **타입 강제(전수성)**다.
// 사실 ② `ShapeBase`가 `TextShape`에도 `strokeWidth`를 요구하므로
//   (`shapes.ts:3-7,37-45`) 타입이 "두께가 의미 있는 도형"이라는 구분을 인코딩하지 않는다.
//   그 진실은 `isStrokeTool` 한 곳에만 산다 — 그래서 손으로 쓴 표가 유일한 그물이다.
const STROKE_TOOL_EXPECTATIONS: Record<AnnotationTool, boolean> = {
  select: false,
  arrow: true,
  rect: true,
  ellipse: true,
  pen: true,
  text: false,
  highlight: true,
};

describe("presets — isStrokeTool 전수", () => {
  for (const [tool, expected] of Object.entries(STROKE_TOOL_EXPECTATIONS) as [
    AnnotationTool,
    boolean,
  ][]) {
    it(`${tool} → ${expected}`, () => {
      expect(isStrokeTool(tool)).toBe(expected);
    });
  }

  it("표는 도구 7종을 빠짐없이 덮는다", () => {
    // ANNOTATION_TOOLS(툴바 노출 목록)와 키 집합 대조 — SUT가 아닌 다른 출처라 항진명제가 아니다.
    expect(Object.keys(STROKE_TOOL_EXPECTATIONS).sort()).toEqual(
      ANNOTATION_TOOLS.map((t) => t.key).sort(),
    );
  });
});
