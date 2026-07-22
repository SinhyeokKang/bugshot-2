import { describe, it, expect } from "vitest";
import { bodyBlocks, type BodyBlock } from "../bodyBlocks";
import {
  DEFAULT_ISSUE_SECTIONS,
  type IssueSection,
  type IssueSectionId,
} from "@/store/settings-ui-store";

const section = (
  id: IssueSectionId,
  enabled = true,
  renderAs: IssueSection["renderAs"] = "paragraph",
): IssueSection => ({ id, enabled, renderAs, builtIn: true });

const media = (enabled = true): IssueSection => section("media", enabled, "meta");

const kinds = (blocks: BodyBlock[]) =>
  blocks.map((b) => (b.kind === "meta" ? "meta" : b.section.id));

describe("bodyBlocks", () => {
  it("기본 배열 → 설명·재현과정·meta·기대결과 (notes는 비활성이라 제외)", () => {
    expect(kinds(bodyBlocks(DEFAULT_ISSUE_SECTIONS))).toEqual([
      "description",
      "stepsToReproduce",
      "meta",
      "expectedResult",
    ]);
  });

  it("media를 맨 앞으로 옮기면 meta가 선두", () => {
    const reordered = [
      media(),
      section("description"),
      section("stepsToReproduce", true, "orderedList"),
      section("expectedResult"),
    ];
    expect(kinds(bodyBlocks(reordered))).toEqual([
      "meta",
      "description",
      "stepsToReproduce",
      "expectedResult",
    ]);
  });

  it("media를 맨 뒤로 옮기면 meta가 말미", () => {
    const reordered = [
      section("description"),
      section("expectedResult"),
      media(),
    ];
    expect(kinds(bodyBlocks(reordered))).toEqual([
      "description",
      "expectedResult",
      "meta",
    ]);
  });

  it("비활성 텍스트 섹션은 제외된다", () => {
    const sections = [
      section("description", false),
      media(),
      section("notes", true),
    ];
    expect(kinds(bodyBlocks(sections))).toEqual(["meta", "notes"]);
  });

  it("enabled:false로 오염된 media도 포함된다 (미디어 소실 방어)", () => {
    const sections = [section("description"), media(false), section("expectedResult")];
    expect(kinds(bodyBlocks(sections))).toEqual([
      "description",
      "meta",
      "expectedResult",
    ]);
  });

  it("section 블록은 원본 섹션 객체를 그대로 실어 보낸다 (라벨/renderAs 소비처용)", () => {
    const steps = section("stepsToReproduce", true, "orderedList");
    const blocks = bodyBlocks([steps]);
    expect(blocks).toEqual([{ kind: "section", section: steps }]);
  });

  it("media 엔트리가 없으면 meta 블록도 없다 (정규화 이전 상태)", () => {
    const legacy = [section("description"), section("expectedResult")];
    expect(kinds(bodyBlocks(legacy))).toEqual(["description", "expectedResult"]);
  });

  it("빈 배열 → 빈 결과", () => {
    expect(bodyBlocks([])).toEqual([]);
  });

  it("입력 배열을 변형하지 않는다 (순수 함수)", () => {
    const input = [section("description"), media(), section("notes", false)];
    const snapshot = JSON.parse(JSON.stringify(input));
    bodyBlocks(input);
    expect(input).toEqual(snapshot);
  });
});
