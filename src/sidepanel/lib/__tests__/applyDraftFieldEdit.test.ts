import { describe, expect, it } from "vitest";

import {
  applyDraftFieldEdit,
  type DraftEditTarget,
} from "@/sidepanel/lib/applyDraftFieldEdit";
import type { IssueRecord } from "@/store/issues-store";
import type { TextIssueSection } from "../bodyBlocks";

const NOW = 1_700_000_000_000;

const section = (
  id: TextIssueSection["id"],
  renderAs: TextIssueSection["renderAs"] = "paragraph",
): TextIssueSection => ({ id, enabled: true, renderAs, builtIn: true });

function makeIssue(overrides: Partial<IssueRecord> = {}): IssueRecord {
  return {
    id: "issue-1",
    status: "draft",
    title: "원래 제목",
    createdAt: 1_699_000_000_000,
    updatedAt: 1_699_000_000_000,
    pageUrl: "https://example.com",
    platform: "jira",
    snapshot: { before: false, after: false },
    draft: {
      title: "원래 제목",
      sections: {
        description: "원래 발생현상",
        stepsToReproduce: "1. 원래 절차",
      },
      environment: [{ label: "OS", value: "macOS" }],
    },
    ...overrides,
  };
}

describe("applyDraftFieldEdit", () => {
  describe("제목 편집 (kind: title)", () => {
    const target: DraftEditTarget = { kind: "title", value: "원래 제목" };

    it("최상위 title과 draft.title을 모두 새 값으로 갱신", () => {
      const patch = applyDraftFieldEdit(makeIssue(), target, "새 제목", NOW);
      expect(patch.title).toBe("새 제목");
      expect(patch.draft?.title).toBe("새 제목");
    });

    it("draft.sections와 draft.environment를 보존", () => {
      const issue = makeIssue();
      const patch = applyDraftFieldEdit(issue, target, "새 제목", NOW);
      expect(patch.draft?.sections).toEqual(issue.draft.sections);
      expect(patch.draft?.environment).toEqual(issue.draft.environment);
    });

    it("updatedAt을 주입한 now로 설정", () => {
      const patch = applyDraftFieldEdit(makeIssue(), target, "새 제목", NOW);
      expect(patch.updatedAt).toBe(NOW);
    });
  });

  describe("섹션 편집 (kind: section)", () => {
    const target: DraftEditTarget = {
      kind: "section",
      section: section("description"),
      value: "원래 발생현상",
    };

    it("대상 섹션 값만 새 값으로 갱신", () => {
      const patch = applyDraftFieldEdit(makeIssue(), target, "새 발생현상", NOW);
      expect(patch.draft?.sections.description).toBe("새 발생현상");
    });

    it("다른 섹션·draft.title·최상위 title·environment를 보존", () => {
      const issue = makeIssue();
      const patch = applyDraftFieldEdit(issue, target, "새 발생현상", NOW);
      expect(patch.draft?.sections.stepsToReproduce).toBe("1. 원래 절차");
      expect(patch.draft?.title).toBe("원래 제목");
      expect(patch.title).toBeUndefined();
      expect(patch.draft?.environment).toEqual(issue.draft.environment);
    });

    it("updatedAt을 주입한 now로 설정", () => {
      const patch = applyDraftFieldEdit(makeIssue(), target, "새 발생현상", NOW);
      expect(patch.updatedAt).toBe(NOW);
    });

    it("존재하지 않던 신규 sectionId 편집 시 키를 추가하고 기존 키를 보존", () => {
      const newTarget: DraftEditTarget = {
        kind: "section",
        section: section("expectedResult"),
        value: "",
      };
      const patch = applyDraftFieldEdit(makeIssue(), newTarget, "기대 결과", NOW);
      expect(patch.draft?.sections.expectedResult).toBe("기대 결과");
      expect(patch.draft?.sections.description).toBe("원래 발생현상");
      expect(patch.draft?.sections.stepsToReproduce).toBe("1. 원래 절차");
    });

    it("빈 문자열로 편집 시 해당 키를 빈 값으로 설정(clear 허용)", () => {
      const patch = applyDraftFieldEdit(makeIssue(), target, "", NOW);
      expect(patch.draft?.sections.description).toBe("");
    });
  });

  describe("불변식 (id·원본 보존)", () => {
    it("patch에 id 키가 없다 (id 불변 — prefill effect deps 트랩 회귀 방지)", () => {
      const titlePatch = applyDraftFieldEdit(
        makeIssue(),
        { kind: "title", value: "x" },
        "새 제목",
        NOW,
      );
      const sectionPatch = applyDraftFieldEdit(
        makeIssue(),
        { kind: "section", section: section("description"), value: "x" },
        "새 값",
        NOW,
      );
      expect("id" in titlePatch).toBe(false);
      expect("id" in sectionPatch).toBe(false);
    });

    it("원본 issue를 변형하지 않는다 (불변)", () => {
      const issue = makeIssue();
      const snapshot = structuredClone(issue);
      applyDraftFieldEdit(
        issue,
        { kind: "section", section: section("description"), value: "x" },
        "새 값",
        NOW,
      );
      expect(issue).toEqual(snapshot);
    });

    it("반환 draft는 원본 draft와 다른 참조다 (얕은 병합 유실 방지)", () => {
      const issue = makeIssue();
      const patch = applyDraftFieldEdit(
        issue,
        { kind: "title", value: "x" },
        "새 제목",
        NOW,
      );
      expect(patch.draft).not.toBe(issue.draft);
    });
  });
});
