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

export interface ChangeGroup {
  source: "current" | "buffered";
  selector: string;
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
  const groups: ChangeGroup[] = bufferedElements.map((b) => ({
    source: "buffered" as const,
    selector: b.selector,
    tagName: b.tagName,
    classList: b.selectionSnapshot.classList,
    snapshot: b.selectionSnapshot,
    edits: b.styleEdits,
    rows: buildStyleDiff(b.selectionSnapshot, b.styleEdits),
  }));

  if (selection) {
    const snapshot: StyleDiffSelection = {
      classList: selection.classList,
      specifiedStyles: selection.specifiedStyles,
      computedStyles: selection.computedStyles,
      text: selection.text,
    };
    const rows = buildStyleDiff(snapshot, styleEdits);
    if (rows.length > 0) {
      groups.push({
        source: "current",
        selector: selection.selector,
        tagName: selection.tagName,
        classList: selection.classList,
        snapshot,
        edits: styleEdits,
        rows,
      });
    }
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
  for (const longhand of SHORTHAND_GROUPS[prop] ?? []) {
    delete inlineStyle[longhand];
  }
  return { classList: [...edits.classList], inlineStyle, text: edits.text };
}
