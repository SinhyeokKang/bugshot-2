import { describe, it, expect } from "vitest";
import { resolveDraftStyleElements } from "../resolveDraftStyleElements";
import type { IssueBufferedElement, IssueRecord } from "@/store/issues-store";

function snap(over: Partial<IssueBufferedElement["selectionSnapshot"]> = {}) {
  return {
    classList: [],
    specifiedStyles: {},
    computedStyles: {},
    text: null,
    viewport: { width: 100, height: 100 },
    capturedAt: 0,
    ...over,
  };
}

function buffered(
  selector: string,
  inlineStyle: Record<string, string>,
): IssueBufferedElement {
  return {
    selector,
    tagName: "div",
    styleEdits: { classList: [], inlineStyle, text: "" },
    selectionSnapshot: snap(),
    hasBefore: true,
    hasAfter: true,
  };
}

const issueBase: Pick<
  IssueRecord,
  "selector" | "tagName" | "styleEdits" | "selectionSnapshot" | "bufferedElements"
> = {
  selector: ".current",
  tagName: "div",
  styleEdits: { classList: [], inlineStyle: { color: "red" }, text: "" },
  selectionSnapshot: snap(),
};

const noImages = { before: null, after: null, buffered: [] };

describe("resolveDraftStyleElements", () => {
  it("버퍼 먼저 → 현재 마지막 순서로 병합하고 인덱스 파일명을 부여", () => {
    const els = resolveDraftStyleElements(
      {
        ...issueBase,
        bufferedElements: [
          buffered(".a", { margin: "8px" }),
          buffered(".b", { padding: "4px" }),
        ],
      },
      noImages,
    );
    expect(els.map((e) => e.selector)).toEqual([".a", ".b", ".current"]);
    expect(els.map((e) => e.beforeFilename)).toEqual([
      "before-0.webp",
      "before-1.webp",
      "before-2.webp",
    ]);
  });

  it("이미지를 element별로 매핑", () => {
    const els = resolveDraftStyleElements(
      { ...issueBase, bufferedElements: [buffered(".a", { margin: "8px" })] },
      {
        before: "cur-before",
        after: "cur-after",
        buffered: [{ before: "a-before", after: "a-after" }],
      },
    );
    expect(els[0]).toMatchObject({ beforeImage: "a-before", afterImage: "a-after" });
    expect(els[1]).toMatchObject({ beforeImage: "cur-before", afterImage: "cur-after" });
  });

  it("bufferedElements 없으면 현재 element 1개만(구 draft 하위호환)", () => {
    const els = resolveDraftStyleElements(issueBase, noImages);
    expect(els).toHaveLength(1);
    expect(els[0].selector).toBe(".current");
  });

  it("diff 0인 버퍼 element는 제외", () => {
    const els = resolveDraftStyleElements(
      { ...issueBase, bufferedElements: [buffered(".empty", {})] },
      noImages,
    );
    expect(els.map((e) => e.selector)).toEqual([".current"]);
  });

  it("현재와 같은 selector의 버퍼는 현재가 이김(dedup)", () => {
    const els = resolveDraftStyleElements(
      {
        ...issueBase,
        selector: ".dup",
        bufferedElements: [buffered(".dup", { margin: "8px" })],
      },
      noImages,
    );
    expect(els).toHaveLength(1);
    expect(els[0].selector).toBe(".dup");
    // 현재 element의 diff(color)가 반영, 버퍼의 margin이 아님
    expect(els[0].diffs.map((d) => d.prop)).toContain("color");
  });

  it("선택 스냅샷 없으면(구 freeform 등) 빈 배열", () => {
    const els = resolveDraftStyleElements(
      { selector: "", tagName: "", styleEdits: undefined, selectionSnapshot: undefined },
      noImages,
    );
    expect(els).toEqual([]);
  });
});
