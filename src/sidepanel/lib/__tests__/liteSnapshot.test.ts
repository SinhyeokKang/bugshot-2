import { describe, it, expect } from "vitest";
import type { EditorSnapshot } from "@/store/editor-store";
import { toLiteSnapshot } from "../liteSnapshot";

// 쿼터 초과 2차 시도용 경량 스냅샷. 이미지 계열을 한 곳이라도 빠뜨리면 lite가 목적을 잃는다
// (주석본만 남아 여전히 초과) — top-level과 bufferedElements 양쪽을 함께 고정한다.
function snap(overrides: Partial<EditorSnapshot> = {}): EditorSnapshot {
  return {
    captureMode: "element",
    phase: "drafting",
    beforeImage: "data:before",
    afterImage: "data:after",
    beforeAnnotated: "data:before-ann",
    afterAnnotated: "data:after-ann",
    captureContext: { kind: "element", rect: { x: 0, y: 0, width: 10, height: 10 } },
    bufferedElements: [
      {
        selector: ".card",
        tagName: "div",
        frameId: 0,
        selectionSnapshot: {
          classList: [],
          specifiedStyles: {},
          computedStyles: {},
          text: null,
          viewport: { width: 800, height: 600 },
          capturedAt: 0,
        },
        styleEdits: { classList: [], inlineStyle: {}, text: "" },
        beforeImage: "data:b-before",
        afterImage: "data:b-after",
        beforeAnnotated: "data:b-before-ann",
        afterAnnotated: "data:b-after-ann",
      },
    ],
    screenshotRaw: "data:shot",
    screenshotAnnotated: "data:shot-ann",
    videoThumbnail: "data:thumb",
    ...overrides,
  } as unknown as EditorSnapshot;
}

describe("toLiteSnapshot", () => {
  it("top-level 이미지 4종(raw 2 + annotated 2)을 모두 null로 만든다", () => {
    const lite = toLiteSnapshot(snap());

    expect(lite.beforeImage).toBeNull();
    expect(lite.afterImage).toBeNull();
    expect(lite.beforeAnnotated).toBeNull();
    expect(lite.afterAnnotated).toBeNull();
  });

  it("bufferedElements의 annotated 2필드도 null로 만든다", () => {
    const lite = toLiteSnapshot(snap());

    const b = lite.bufferedElements[0];
    expect(b.beforeImage).toBeNull();
    expect(b.afterImage).toBeNull();
    expect(b.beforeAnnotated).toBeNull();
    expect(b.afterAnnotated).toBeNull();
  });

  it("결과 어디에도 data URL이 남지 않는다", () => {
    const lite = toLiteSnapshot(snap());

    expect(JSON.stringify(lite)).not.toContain("data:");
  });

  it("스크린샷·영상 썸네일도 기존대로 비운다", () => {
    const lite = toLiteSnapshot(snap());

    expect(lite.screenshotRaw).toBeNull();
    expect(lite.screenshotAnnotated).toBeNull();
    expect(lite.videoThumbnail).toBeNull();
  });

  // 기준이 사라지면 resolveCaptureRect의 0×0 가드가 함께 풀린다 — 짝 없는 기준보다 그 가드가 값이 크다.
  it("captureContext는 남긴다", () => {
    expect(toLiteSnapshot(snap()).captureContext).not.toBeNull();
  });

  it("원본 스냅샷을 mutate하지 않는다", () => {
    const original = snap();

    toLiteSnapshot(original);

    expect(original.beforeAnnotated).toBe("data:before-ann");
    expect(original.bufferedElements[0].afterAnnotated).toBe("data:b-after-ann");
  });

  it("bufferedElements가 비어도 예외 없이 통과한다", () => {
    expect(toLiteSnapshot(snap({ bufferedElements: [] })).bufferedElements).toEqual([]);
  });

  // 구버전 영속 스냅샷엔 annotated 필드가 없다 — optional 폴백이라 예외 없이 null로 수렴한다.
  it("구버전 버퍼 항목(annotated 필드 없음)도 예외 없이 통과한다", () => {
    const s = snap();
    delete (s.bufferedElements[0] as unknown as Record<string, unknown>).beforeAnnotated;
    delete (s.bufferedElements[0] as unknown as Record<string, unknown>).afterAnnotated;

    const b = toLiteSnapshot(s).bufferedElements[0];
    expect(b.beforeAnnotated).toBeNull();
    expect(b.afterAnnotated).toBeNull();
  });
});
