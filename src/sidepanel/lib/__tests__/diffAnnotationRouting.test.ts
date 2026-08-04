import { describe, it, expect } from "vitest";
import {
  annotationSource,
  routeDiffAnnotation,
} from "../diffAnnotationRouting";

// diff table 카드는 mergeStyleElements의 파생 배열이라 쓰기 대상이 아니다. 어느 카드가
// "현재 선택"이고 어느 카드가 버퍼인지를 sameElementKey로 갈라야 A 요소 주석이 B 카드에 안 붙는다.
describe("routeDiffAnnotation — 쓰기 라우팅(현재 vs 버퍼)", () => {
  const sel = { selector: "button.cta", frameId: 0 };

  it("현재 선택과 같은 키면 current로 라우팅한다", () => {
    expect(routeDiffAnnotation(sel, sel, "before", "data:ann")).toEqual({
      target: "current",
      selector: "button.cta",
      frameId: 0,
      slot: "before",
      dataUrl: "data:ann",
    });
  });

  it("다른 selector면 buffered로 라우팅하고 키를 그대로 싣는다", () => {
    expect(
      routeDiffAnnotation({ selector: ".card", frameId: 0 }, sel, "after", "data:ann"),
    ).toEqual({
      target: "buffered",
      selector: ".card",
      frameId: 0,
      slot: "after",
      dataUrl: "data:ann",
    });
  });

  // 같은 selector라도 프레임이 다르면 별개 요소다 — current로 새면 top 카드 주석이 iframe 카드에 붙는다.
  it("동일 selector·다른 frameId는 buffered로 라우팅한다", () => {
    const out = routeDiffAnnotation({ selector: "button.cta", frameId: 3 }, sel, "before", "x");
    expect(out.target).toBe("buffered");
    expect(out.frameId).toBe(3);
  });

  it("frameId 미지정(구버전)은 0으로 정규화해 top 선택과 일치시킨다", () => {
    expect(
      routeDiffAnnotation({ selector: "button.cta" }, { selector: "button.cta" }, "before", "x")
        .target,
    ).toBe("current");
    expect(
      routeDiffAnnotation({ selector: "button.cta" }, { selector: "button.cta", frameId: 3 }, "before", "x")
        .target,
    ).toBe("buffered");
  });

  it("selection이 없으면 buffered로 라우팅한다", () => {
    expect(routeDiffAnnotation({ selector: ".card" }, null, "before", "x").target).toBe(
      "buffered",
    );
  });

  // 제거는 같은 라우팅에 dataUrl=null로 태운다 — 경로가 갈리면 버퍼 카드의 제거가 현재 요소를 지운다.
  it("dataUrl=null(주석 제거)도 같은 라우팅을 탄다", () => {
    expect(routeDiffAnnotation({ selector: ".card" }, sel, "after", null)).toEqual({
      target: "buffered",
      selector: ".card",
      frameId: 0,
      slot: "after",
      dataUrl: null,
    });
  });
});

describe("annotationSource — 오버레이 배경 이미지(annotated ?? raw)", () => {
  const el = {
    beforeImage: "data:before",
    afterImage: "data:after",
    beforeAnnotated: "data:before-ann",
    afterAnnotated: "data:after-ann",
  };

  // 재주석은 주석본 위에서 이어 그린다 — 원본을 열면 직전 도형이 사라진 것처럼 보인다.
  it("주석이 있으면 주석본을 배경으로 준다", () => {
    expect(annotationSource(el, "before")).toBe("data:before-ann");
    expect(annotationSource(el, "after")).toBe("data:after-ann");
  });

  it("주석이 없으면 원본을 준다", () => {
    expect(annotationSource({ beforeImage: "data:before" }, "before")).toBe("data:before");
  });

  it("슬롯이 서로 섞이지 않는다", () => {
    expect(annotationSource({ beforeAnnotated: "data:before-ann" }, "after")).toBeNull();
  });

  it("둘 다 없으면 null이다", () => {
    expect(annotationSource({}, "before")).toBeNull();
  });
});
