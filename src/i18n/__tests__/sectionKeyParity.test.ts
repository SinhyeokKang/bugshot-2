import { describe, expect, it } from "vitest";
import { locales } from "../index";
import { LOCALES } from "../locales";
import {
  sectionLabelKey,
  sectionMdLabelKey,
  type IssueSectionId,
} from "@/store/settings-ui-store";

// logs.html Report 탭의 섹션 라벨은 미리보기 키셋(section.*), 제출 본문은 md 키셋(md.section.*)을
//쓴다. 본문 언어가 화면 언어와 갈릴 수 있게 된 뒤로는 두 키셋 값이 같아야 "제출물과 logs.html의
// 문자열이 일치한다"는 계약이 성립한다.
//
// 대상은 하드코딩하지 않고 IssueSectionId에서 파생시킨다 — Record로 받아 컴파일러가 누락을 잡게
// 하면 섹션이 늘 때 검사 대상이 자동으로 따라온다. env·attachments·styleChanges는 섹션 id가
// 아니라 각 표면의 리터럴 키라 이 교차의 대상이 아니다(그중 attachments는 ko 값이 이미 다르다).
const ALL_SECTION_IDS: Record<IssueSectionId, true> = {
  description: true,
  stepsToReproduce: true,
  media: true,
  expectedResult: true,
  notes: true,
};

const SECTION_IDS = Object.keys(ALL_SECTION_IDS) as IssueSectionId[];

describe("섹션 라벨 두 키셋 값 일치 (section.* ↔ md.section.*)", () => {
  it("검사 대상이 IssueSectionId 전수다 (자기검증 앵커)", () => {
    expect(SECTION_IDS).toHaveLength(5);
    expect(SECTION_IDS).toContain("description");
    expect(SECTION_IDS).toContain("media");
  });

  it("등록된 모든 로케일에서 두 키가 사전에 존재한다", () => {
    for (const locale of LOCALES) {
      for (const id of SECTION_IDS) {
        expect(locales[locale][sectionLabelKey(id)]).toBeTypeOf("string");
        expect(locales[locale][sectionMdLabelKey(id)]).toBeTypeOf("string");
      }
    }
  });

  it("등록된 모든 로케일에서 두 키셋의 값이 일치한다", () => {
    for (const locale of LOCALES) {
      for (const id of SECTION_IDS) {
        expect(locales[locale][sectionMdLabelKey(id)]).toBe(
          locales[locale][sectionLabelKey(id)],
        );
      }
    }
  });

  // 위 단언이 "두 사전 조회가 실제로 다를 수 있는" 비교인지 실증한다. attachments는 섹션 id가
  // 아니라 각 표면의 리터럴 키이고 ko 값이 이미 갈려 있어, 비교 자체는 공허하지 않다.
  it("비교가 공허하지 않다 — 사정권 밖 attachments 키는 ko에서 값이 다르다", () => {
    expect(locales.ko["section.attachments"]).not.toBe(
      locales.ko["md.section.attachments"],
    );
  });
});
