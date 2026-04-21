import { cn } from "@/lib/utils";

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
    <div className="overflow-hidden rounded-lg border border-border/60">
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-[22%]" />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr className="border-b border-border/60 bg-muted/40 text-left">
            <th className="px-2 py-1.5 font-semibold" />
            <th className="px-2 py-1.5 font-semibold">As is</th>
            <th className="px-2 py-1.5 font-semibold">To be</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-border/60">
            <td className="px-2 py-2 align-middle text-muted-foreground">
              스냅샷
            </td>
            <td className="px-2 py-2">
              <SnapshotCell image={beforeImage} />
            </td>
            <td className="px-2 py-2">
              <SnapshotCell image={afterImage} />
            </td>
          </tr>
          {diffs.length === 0 ? (
            <tr>
              <td
                colSpan={3}
                className="px-2 py-3 text-center text-muted-foreground"
              >
                변경 사항이 없습니다.
              </td>
            </tr>
          ) : (
            diffs.map((d) => (
              <tr
                key={d.prop}
                className="border-b border-border/60 last:border-b-0"
              >
                <td className="px-2 py-1.5 align-top font-medium">{d.prop}</td>
                <td className="px-2 py-1.5 align-top">
                  <DiffValue value={d.asIs} muted />
                </td>
                <td className="px-2 py-1.5 align-top">
                  <DiffValue value={d.toBe} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function SnapshotCell({ image }: { image: string | null }) {
  if (!image) return null;
  return (
    <div className="flex items-center justify-center rounded border border-border/60 bg-muted/30 p-1">
      <img
        src={image}
        alt="snapshot"
        className="max-h-40 w-auto max-w-full object-contain"
      />
    </div>
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
  return rows;
}
