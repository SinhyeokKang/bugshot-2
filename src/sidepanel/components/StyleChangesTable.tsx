import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import {
  DocTable,
  docTableCell,
  docTableHead,
  docTableRow,
} from "./DocTable";
import { diffClassTokens, type StyleDiffSegment } from "@/sidepanel/lib/classDiff";

export interface StyleDiffRow {
  prop: string;
  asIs: string;
  toBe: string;
  // class 행만 채움 — 변경/추가/제거된 토큰을 볼드 강조하기 위한 토큰 단위 세그먼트.
  asIsSegments?: StyleDiffSegment[];
  toBeSegments?: StyleDiffSegment[];
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
  const t = useT();
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
          <th className={docTableHead}>{t("styleTable.asIs")}</th>
          <th className={docTableHead}>{t("styleTable.toBe")}</th>
        </tr>
      </thead>
      <tbody>
        <tr className={docTableRow}>
          <td className={cn(docTableCell, "text-muted-foreground")}>
            {t("styleTable.snapshot")}
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
              {t("styleTable.noChanges")}
            </td>
          </tr>
        ) : (
          diffs.map((d) => (
            <tr key={d.prop} className={docTableRow}>
              <td className={cn(docTableCell, "font-medium")}>{d.prop}</td>
              <td className={docTableCell}>
                <DiffValue value={d.asIs} segments={d.asIsSegments} muted />
              </td>
              <td className={docTableCell}>
                <DiffValue value={d.toBe} segments={d.toBeSegments} />
              </td>
            </tr>
          ))
        )}
      </tbody>
    </DocTable>
  );
}

function SnapshotCell({ image }: { image: string | null }) {
  const t = useT();
  if (!image) return null;
  return (
    <Card className="flex items-center justify-center bg-muted/30 p-1">
      <img
        src={image}
        alt={t("alt.capturedImage")}
        className="max-h-40 w-auto max-w-full object-contain"
      />
    </Card>
  );
}

export function DiffValue({
  value,
  segments,
  muted,
  "data-testid": testid,
}: {
  value: string;
  segments?: StyleDiffSegment[];
  muted?: boolean;
  "data-testid"?: string;
}) {
  const t = useT();
  if (!value.trim()) {
    return (
      <span data-testid={testid} className="text-muted-foreground/60">
        {t("styleTable.unset")}
      </span>
    );
  }
  return (
    <span
      data-testid={testid}
      className={cn(
        "whitespace-pre-wrap break-all",
        muted && "text-muted-foreground",
      )}
    >
      {segments
        ? segments.map((s, i) => (
            <span key={i}>
              {i > 0 ? " " : ""}
              {s.changed ? (
                <strong className="font-semibold">{s.text}</strong>
              ) : (
                s.text
              )}
            </span>
          ))
        : value}
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
    const seg = diffClassTokens(selection.classList, edits.classList);
    rows.push({
      prop: "class",
      asIs: beforeClass,
      toBe: afterClass,
      asIsSegments: seg.asIs,
      toBeSegments: seg.toBe,
    });
  }

  for (const [prop, after] of Object.entries(edits.inlineStyle)) {
    const before =
      selection.specifiedStyles[prop] ?? selection.computedStyles[prop] ?? "";
    // baseline과 동일한 값은 변경이 아니다 — phantom diff/가짜 버퍼 카드 방지.
    if (before === after) continue;
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

export const SHORTHAND_GROUPS: Record<string, string[]> = {
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
  "border-width": [
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
  ],
  "border-color": [
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
  ],
};

function collapseShorthands(rows: StyleDiffRow[]): StyleDiffRow[] {
  const consumed = new Set<string>();
  // 첫 longhand의 자리에 collapsed 행을 끼워 넣어 text→class→prop 정렬을 유지한다.
  const collapsedAt = new Map<string, StyleDiffRow>();

  for (const [shorthand, longhands] of Object.entries(SHORTHAND_GROUPS)) {
    // 명시 shorthand 행이 이미 있으면(AI 머지 등) 같은 prop 행을 중복 생성하지 않는다.
    if (rows.some((r) => r.prop === shorthand)) continue;
    const matching = longhands
      .map((l) => rows.find((r) => r.prop === l))
      .filter((r): r is StyleDiffRow => r != null);
    if (matching.length !== longhands.length) continue;

    const allSameAsIs = matching.every((r) => r.asIs === matching[0].asIs);
    const allSameToBe = matching.every((r) => r.toBe === matching[0].toBe);
    if (allSameAsIs && allSameToBe) {
      const first = rows.find((r) => longhands.includes(r.prop))!;
      collapsedAt.set(first.prop, {
        prop: shorthand,
        asIs: first.asIs,
        toBe: first.toBe,
      });
      for (const l of longhands) consumed.add(l);
    }
  }

  const result: StyleDiffRow[] = [];
  for (const row of rows) {
    const collapsed = collapsedAt.get(row.prop);
    if (collapsed) result.push(collapsed);
    if (!consumed.has(row.prop)) result.push(row);
  }

  return result;
}
