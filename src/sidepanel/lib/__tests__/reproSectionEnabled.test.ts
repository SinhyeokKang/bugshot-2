import { describe, it, expect } from "vitest";
import { isReproSectionEnabled } from "../reproSectionEnabled";
import { DEFAULT_ISSUE_SECTIONS } from "@/store/settings-ui-store";
import type { IssueSection } from "@/store/settings-ui-store";

const sections = (over: Partial<Record<string, boolean>> = {}): IssueSection[] =>
  DEFAULT_ISSUE_SECTIONS.map((s) => ({ ...s, enabled: over[s.id] ?? s.enabled }));

describe("isReproSectionEnabled", () => {
  it("기본 설정에선 켜져 있다", () => {
    expect(isReproSectionEnabled(DEFAULT_ISSUE_SECTIONS)).toBe(true);
  });

  it("재현 과정 섹션을 끄면 false", () => {
    expect(isReproSectionEnabled(sections({ stepsToReproduce: false }))).toBe(false);
  });

  it("다른 섹션을 전부 꺼도 재현 과정만 켜져 있으면 true", () => {
    expect(
      isReproSectionEnabled(
        sections({ description: false, expectedResult: false, notes: false }),
      ),
    ).toBe(true);
  });

  it("섹션 목록에 재현 과정이 아예 없으면 false", () => {
    expect(
      isReproSectionEnabled(
        DEFAULT_ISSUE_SECTIONS.filter((s) => s.id !== "stepsToReproduce"),
      ),
    ).toBe(false);
  });
});
