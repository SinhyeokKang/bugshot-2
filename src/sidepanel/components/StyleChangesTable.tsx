import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  DocTable,
  docTableCell,
  docTableHead,
  docTableRow,
} from "./DocTable";

export interface StyleDiffRow {
  prop: string;
  asIs: string;
  toBe: string;
}

export interface StyleDiffSelection {
  classList: string[];
  specifiedStyles: Record<string, string>;
  computedStyles: Record<string, string>;
  text: string | null;
}

export interface StyleDiffEdits {
  classList: string[];
  inlineStyle: Record<string, string>;
  text: string;
}

export function StyleChangesTable({
  beforeImage,
  afterImage,
  diffs,
}: {
  beforeImage: string | null;
  afterImage: string | null;
  diffs: StyleDiffRow[];
}) {
  return (
    <DocTable>
      <colgroup>
        <col className="w-[22%]" />
        <col />
        <col />
      </colgroup>
      <thead>
        <tr className={cn("bg-muted/40", docTableRow)}>
          <th className={docTableHead} />
          <th className={docTableHead}>As is</th>
          <th className={docTableHead}>To be</th>
        </tr>
      </thead>
      <tbody>
        <tr className={docTableRow}>
          <td className={cn(docTableCell, "text-muted-foreground")}>
            스냅샷
          </td>
          <td className={docTableCell}>
            <SnapshotCell image={beforeImage} />
          </td>
          <td className={docTableCell}>
            <SnapshotCell image={afterImage} />
          </td>
        </tr>
        {diffs.length === 0 ? (
          <tr>
            <td
              colSpan={3}
              className={cn(docTableCell, "text-center text-muted-foreground")}
            >
              변경 사항이 없습니다.
            </td>
          </tr>
        ) : (
          diffs.map((d) => (
            <tr key={d.prop} className={docTableRow}>
              <td className={cn(docTableCell, "font-medium")}>{d.prop}</td>
              <td className={docTableCell}>
                <DiffValue value={d.asIs} muted />
              </td>
              <td className={docTableCell}>
                <DiffValue value={d.toBe} />
              </td>
            </tr>
          ))
        )}
      </tbody>
    </DocTable>
  );
}

function SnapshotCell({ image }: { image: string | null }) {
  if (!image) return null;
  return (
    <Card className="flex items-center justify-center bg-muted/30 p-1">
      <img
        src={image}
        alt="snapshot"
        className="max-h-40 w-auto max-w-full object-contain"
      />
    </Card>
  );
}

function DiffValue({ value, muted }: { value: string; muted?: boolean }) {
  if (!value.trim()) {
    return <span className="text-muted-foreground/60">unset</span>;
  }
  return (
    <span
      className={cn(
        "whitespace-pre-wrap break-all",
        muted && "text-muted-foreground",
      )}
    >
      {value}
    </span>
  );
}

export function buildStyleDiff(
  selection: StyleDiffSelection,
  edits: StyleDiffEdits,
): StyleDiffRow[] {
  const rows: StyleDiffRow[] = [];

  if (selection.text !== null && edits.text !== selection.text) {
    rows.push({ prop: "text", asIs: selection.text, toBe: edits.text });
  }

  const beforeClass = selection.classList.join(" ");
  const afterClass = edits.classList.join(" ");
  if (beforeClass !== afterClass) {
    rows.push({ prop: "class", asIs: beforeClass, toBe: afterClass });
  }

  for (const [prop, after] of Object.entries(edits.inlineStyle)) {
    const before =
      selection.specifiedStyles[prop] ?? selection.computedStyles[prop] ?? "";
    rows.push({ prop, asIs: before, toBe: after });
  }

  const priority = (p: string) => (p === "text" ? 0 : p === "class" ? 1 : 2);
  rows.sort((a, b) => {
    const pa = priority(a.prop);
    const pb = priority(b.prop);
    if (pa !== pb) return pa - pb;
    return a.prop.localeCompare(b.prop);
  });
  return collapseShorthands(rows);
}

const SHORTHAND_GROUPS: Record<string, string[]> = {
  padding: [
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
  ],
  margin: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
  "border-radius": [
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-right-radius",
    "border-bottom-left-radius",
  ],
};

function collapseShorthands(rows: StyleDiffRow[]): StyleDiffRow[] {
  const result: StyleDiffRow[] = [];
  const consumed = new Set<string>();

  for (const [shorthand, longhands] of Object.entries(SHORTHAND_GROUPS)) {
    const matching = longhands
      .map((l) => rows.find((r) => r.prop === l))
      .filter((r): r is StyleDiffRow => r != null);
    if (matching.length !== longhands.length) continue;

    const allSameAsIs = matching.every((r) => r.asIs === matching[0].asIs);
    const allSameToBe = matching.every((r) => r.toBe === matching[0].toBe);
    if (allSameAsIs && allSameToBe) {
      result.push({
        prop: shorthand,
        asIs: matching[0].asIs,
        toBe: matching[0].toBe,
      });
      for (const l of longhands) consumed.add(l);
    }
  }

  for (const row of rows) {
    if (!consumed.has(row.prop)) result.push(row);
  }

  return result;
}
