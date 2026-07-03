import {
  buildStyleDiff,
  SHORTHAND_GROUPS,
  type StyleDiffEdits,
  type StyleDiffRow,
  type StyleDiffSelection,
} from "@/sidepanel/components/StyleChangesTable";
import type {
  BufferedElement,
  EditorSelection,
  EditorStyleEdits,
} from "@/store/editor-store";
import { sameElementKey } from "@/lib/element-key";

export interface ChangeGroup {
  source: "current" | "buffered";
  selector: string;
  // 요소가 속한 프레임(0=top)·origin — 행 초기화 라우팅과 출처 배지에 사용.
  frameId: number;
  origin: string;
  tagName: string;
  classList: string[];
  snapshot: StyleDiffSelection;
  edits: StyleDiffEdits;
  rows: StyleDiffRow[];
}

export function buildChangeGroups(
  selection: EditorSelection | null,
  styleEdits: EditorStyleEdits,
  bufferedElements: BufferedElement[],
): ChangeGroup[] {
  // 현재 그룹을 먼저 확정한다 — diff가 있어야 포함되고, 있으면 동일 키 버퍼를 밀어낸다
  // (mergeStyleElements와 동일: 승격 전 비동기 창에서 selection==buffer 공존 시 이중 카운트 방지).
  let currentGroup: ChangeGroup | null = null;
  if (selection) {
    const snapshot: StyleDiffSelection = {
      classList: selection.classList,
      specifiedStyles: selection.specifiedStyles,
      computedStyles: selection.computedStyles,
      text: selection.text,
    };
    const rows = buildStyleDiff(snapshot, styleEdits);
    if (rows.length > 0) {
      currentGroup = {
        source: "current",
        selector: selection.selector,
        frameId: selection.frameId ?? 0,
        origin: selection.origin ?? "",
        tagName: selection.tagName,
        classList: selection.classList,
        snapshot,
        edits: styleEdits,
        rows,
      };
    }
  }

  const groups: ChangeGroup[] = bufferedElements
    .filter(
      (b) =>
        !currentGroup ||
        !sameElementKey(
          { selector: b.selector, frameId: b.frameId },
          { selector: currentGroup.selector, frameId: currentGroup.frameId },
        ),
    )
    .map((b) => ({
      source: "buffered" as const,
      selector: b.selector,
      frameId: b.frameId ?? 0,
      origin: b.origin ?? "",
      tagName: b.tagName,
      classList: b.selectionSnapshot.classList,
      snapshot: b.selectionSnapshot,
      edits: b.styleEdits,
      rows: buildStyleDiff(b.selectionSnapshot, b.styleEdits),
    }))
    .filter((g) => g.rows.length > 0);

  if (currentGroup) {
    groups.push(currentGroup);
  }

  return groups;
}

export function countChangeRows(groups: ChangeGroup[]): number {
  return groups.reduce((n, g) => n + g.rows.length, 0);
}

export function removeDiffRow(
  snapshot: StyleDiffSelection,
  edits: StyleDiffEdits,
  prop: string,
): EditorStyleEdits {
  if (prop === "text") {
    return {
      classList: [...edits.classList],
      inlineStyle: { ...edits.inlineStyle },
      text: snapshot.text ?? "",
    };
  }
  if (prop === "class") {
    return {
      classList: [...snapshot.classList],
      inlineStyle: { ...edits.inlineStyle },
      text: edits.text,
    };
  }
  const inlineStyle = { ...edits.inlineStyle };
  delete inlineStyle[prop];
  // border 2차 통합 행은 width/style/color 세 그룹의 longhand 12개를 모두 소비한다.
  const groups =
    prop === "border"
      ? ["border-width", "border-style", "border-color"]
      : [prop];
  for (const g of groups) {
    delete inlineStyle[g];
    for (const longhand of SHORTHAND_GROUPS[g] ?? []) {
      delete inlineStyle[longhand];
    }
  }
  return { classList: [...edits.classList], inlineStyle, text: edits.text };
}
