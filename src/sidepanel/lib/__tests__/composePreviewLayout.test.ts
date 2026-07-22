import { describe, it, expect } from "vitest";

// 프리뷰 슬롯 삽입 순서 규칙을 순수 함수로 고정한다(컴포넌트 렌더 자체는 브라우저 검증 영역).
// 순서는 issueSections 배열이 단일 출처 — "media" id의 자리가 곧 슬롯 위치다.
import { composePreviewLayout } from "../composePreviewLayout";

describe("composePreviewLayout", () => {
  it("media id 자리에 media+logCards를 넣고 그 id는 섹션으로 렌더하지 않는다", () => {
    const out = composePreviewLayout({
      sectionIds: ["description", "stepsToReproduce", "media", "expectedResult"],
      hasMedia: true,
      hasLogCards: true,
    });

    expect(out).toEqual([
      { kind: "section", id: "description" },
      { kind: "section", id: "stepsToReproduce" },
      { kind: "media" },
      { kind: "logCards" },
      { kind: "section", id: "expectedResult" },
    ]);
  });

  it("media를 맨 앞으로 재정렬하면 슬롯도 맨 앞", () => {
    const out = composePreviewLayout({
      sectionIds: ["media", "description", "expectedResult"],
      hasMedia: true,
      hasLogCards: true,
    });

    expect(out).toEqual([
      { kind: "media" },
      { kind: "logCards" },
      { kind: "section", id: "description" },
      { kind: "section", id: "expectedResult" },
    ]);
  });

  it("media가 logCards보다 먼저 온다", () => {
    const out = composePreviewLayout({
      sectionIds: ["media", "expectedResult"],
      hasMedia: true,
      hasLogCards: true,
    });

    const mediaIdx = out.findIndex((e) => e.kind === "media");
    const logIdx = out.findIndex((e) => e.kind === "logCards");
    expect(mediaIdx).toBeGreaterThanOrEqual(0);
    expect(logIdx).toBeGreaterThan(mediaIdx);
  });

  it("media id가 없으면 말미에 붙인다 (레거시 순서 배열 방어)", () => {
    const out = composePreviewLayout({
      sectionIds: ["description", "stepsToReproduce"],
      hasMedia: true,
      hasLogCards: true,
    });

    expect(out).toEqual([
      { kind: "section", id: "description" },
      { kind: "section", id: "stepsToReproduce" },
      { kind: "media" },
      { kind: "logCards" },
    ]);
  });

  it("logCards가 없으면 media만 삽입한다", () => {
    const out = composePreviewLayout({
      sectionIds: ["description", "media", "expectedResult"],
      hasMedia: true,
      hasLogCards: false,
    });

    expect(out).toEqual([
      { kind: "section", id: "description" },
      { kind: "media" },
      { kind: "section", id: "expectedResult" },
    ]);
  });

  it("media/logCards 둘 다 없으면 섹션만 (Report 탭: 슬롯 미전달)", () => {
    const out = composePreviewLayout({
      sectionIds: ["description", "expectedResult", "notes"],
      hasMedia: false,
      hasLogCards: false,
    });

    expect(out).toEqual([
      { kind: "section", id: "description" },
      { kind: "section", id: "expectedResult" },
      { kind: "section", id: "notes" },
    ]);
  });

  it("media id가 중복돼도 슬롯은 한 번만 삽입한다 (정규화 실패 방어)", () => {
    const out = composePreviewLayout({
      sectionIds: ["description", "media", "expectedResult", "media"],
      hasMedia: true,
      hasLogCards: false,
    });

    expect(out.filter((e) => e.kind === "media")).toHaveLength(1);
    expect(out).toEqual([
      { kind: "section", id: "description" },
      { kind: "media" },
      { kind: "section", id: "expectedResult" },
    ]);
  });
});
