import { describe, expect, it } from "vitest";
import {
  DEFAULT_ISSUE_SECTIONS,
  POST_MEDIA_SECTION_IDS,
  sectionHelpKey,
  sectionLabelKey,
  sectionMdLabelKey,
  sectionPlaceholderKey,
  useSettingsUiStore,
  type IssueSectionId,
} from "../settings-ui-store";

describe("settings-ui-store", () => {
  describe("DEFAULT_ISSUE_SECTIONS", () => {
    it("4종 빌트인 섹션이 올바른 순서로 정의됨", () => {
      const ids = DEFAULT_ISSUE_SECTIONS.map((s) => s.id);
      expect(ids).toEqual(["description", "stepsToReproduce", "expectedResult", "notes"]);
    });

    it("description/stepsToReproduce/expectedResult는 enabled, notes는 disabled", () => {
      const map = Object.fromEntries(DEFAULT_ISSUE_SECTIONS.map((s) => [s.id, s.enabled]));
      expect(map).toEqual({
        description: true,
        stepsToReproduce: true,
        expectedResult: true,
        notes: false,
      });
    });

    it("stepsToReproduce만 orderedList, 나머지는 paragraph", () => {
      const map = Object.fromEntries(DEFAULT_ISSUE_SECTIONS.map((s) => [s.id, s.renderAs]));
      expect(map).toEqual({
        description: "paragraph",
        stepsToReproduce: "orderedList",
        expectedResult: "paragraph",
        notes: "paragraph",
      });
    });
  });

  describe("POST_MEDIA_SECTION_IDS", () => {
    it("expectedResult와 notes만 포함", () => {
      expect(POST_MEDIA_SECTION_IDS.has("expectedResult")).toBe(true);
      expect(POST_MEDIA_SECTION_IDS.has("notes")).toBe(true);
      expect(POST_MEDIA_SECTION_IDS.has("description")).toBe(false);
      expect(POST_MEDIA_SECTION_IDS.has("stepsToReproduce")).toBe(false);
    });
  });

  describe("section key 헬퍼", () => {
    const ids: IssueSectionId[] = ["description", "stepsToReproduce", "expectedResult", "notes"];

    it("sectionLabelKey는 section.{id} 형식", () => {
      ids.forEach((id) => expect(sectionLabelKey(id)).toBe(`section.${id}`));
    });

    it("sectionMdLabelKey는 md.section.{id} 형식", () => {
      ids.forEach((id) => expect(sectionMdLabelKey(id)).toBe(`md.section.${id}`));
    });

    it("sectionPlaceholderKey는 draft.{id}Placeholder 형식", () => {
      ids.forEach((id) => expect(sectionPlaceholderKey(id)).toBe(`draft.${id}Placeholder`));
    });

    it("sectionHelpKey는 section.{id}.help 형식", () => {
      ids.forEach((id) => expect(sectionHelpKey(id)).toBe(`section.${id}.help`));
    });
  });

  describe("store actions", () => {
    it("setTheme으로 테마 변경", () => {
      useSettingsUiStore.getState().setTheme("dark");
      expect(useSettingsUiStore.getState().theme).toBe("dark");
      useSettingsUiStore.getState().setTheme("light");
      expect(useSettingsUiStore.getState().theme).toBe("light");
    });

    it("setLocale로 로케일 변경", () => {
      useSettingsUiStore.getState().setLocale("en");
      expect(useSettingsUiStore.getState().locale).toBe("en");
      useSettingsUiStore.getState().setLocale("ko");
      expect(useSettingsUiStore.getState().locale).toBe("ko");
    });

    it("setIssueEnabled로 개별 섹션 토글", () => {
      useSettingsUiStore.getState().resetIssueSections();
      useSettingsUiStore.getState().setIssueEnabled("notes", true);
      const notes = useSettingsUiStore.getState().issueSections.find((s) => s.id === "notes");
      expect(notes?.enabled).toBe(true);

      useSettingsUiStore.getState().setIssueEnabled("description", false);
      const desc = useSettingsUiStore.getState().issueSections.find((s) => s.id === "description");
      expect(desc?.enabled).toBe(false);
    });

    it("resetIssueSections로 기본값 복원", () => {
      useSettingsUiStore.getState().setIssueEnabled("notes", true);
      useSettingsUiStore.getState().setIssueEnabled("description", false);
      useSettingsUiStore.getState().resetIssueSections();
      expect(useSettingsUiStore.getState().issueSections).toEqual(DEFAULT_ISSUE_SECTIONS);
    });
  });
});
