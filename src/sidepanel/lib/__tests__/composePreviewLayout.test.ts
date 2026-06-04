import { describe, it, expect } from "vitest";

// PreviewPanel:309-327의 슬롯 삽입 로직을 IssuePreviewView로 추출할 때
// 회귀 위험의 핵심 = "media/logCards를 첫 POST_MEDIA 섹션 앞에 끼우고, 없으면 말미"
// 이 순서 규칙을 순수 함수로 고정한다(컴포넌트 렌더 자체는 브라우저 검증 영역).
//
// 모듈은 아직 없음 — import 실패가 첫 red.
import { composePreviewLayout } from "../composePreviewLayout";

const POST_MEDIA = new Set(["expectedResult", "notes"]);

describe("composePreviewLayout", () => {
  it("media+logCards를 첫 POST_MEDIA 섹션(expectedResult) 바로 앞에 삽입한다", () => {
    const out = composePreviewLayout({
      sectionIds: ["description", "stepsToReproduce", "expectedResult"],
      postMediaSectionIds: POST_MEDIA,
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

  it("media가 logCards보다 먼저 온다", () => {
    const out = composePreviewLayout({
      sectionIds: ["expectedResult"],
      postMediaSectionIds: POST_MEDIA,
      hasMedia: true,
      hasLogCards: true,
    });

    const mediaIdx = out.findIndex((e) => e.kind === "media");
    const logIdx = out.findIndex((e) => e.kind === "logCards");
    expect(mediaIdx).toBeGreaterThanOrEqual(0);
    expect(logIdx).toBeGreaterThan(mediaIdx);
  });

  it("POST_MEDIA 섹션이 없으면 media+logCards를 말미에 붙인다", () => {
    const out = composePreviewLayout({
      sectionIds: ["description", "stepsToReproduce"],
      postMediaSectionIds: POST_MEDIA,
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
      sectionIds: ["description", "expectedResult"],
      postMediaSectionIds: POST_MEDIA,
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
      postMediaSectionIds: POST_MEDIA,
      hasMedia: false,
      hasLogCards: false,
    });

    expect(out).toEqual([
      { kind: "section", id: "description" },
      { kind: "section", id: "expectedResult" },
      { kind: "section", id: "notes" },
    ]);
  });

  it("첫 POST_MEDIA에만 삽입하고 두 번째(notes)에는 중복 삽입하지 않는다", () => {
    const out = composePreviewLayout({
      sectionIds: ["description", "expectedResult", "notes"],
      postMediaSectionIds: POST_MEDIA,
      hasMedia: true,
      hasLogCards: false,
    });

    expect(out.filter((e) => e.kind === "media")).toHaveLength(1);
    expect(out).toEqual([
      { kind: "section", id: "description" },
      { kind: "media" },
      { kind: "section", id: "expectedResult" },
      { kind: "section", id: "notes" },
    ]);
  });
});
