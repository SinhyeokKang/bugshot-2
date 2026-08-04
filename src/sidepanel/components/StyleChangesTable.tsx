import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { ColorSwatch } from "./ColorSwatch";
import { ImageActions } from "./ImageActions";
import type { SnapshotSlot } from "@/sidepanel/lib/diffAnnotation";
import { isRenderableColorLiteral } from "@/sidepanel/tabs/styleEditor/colorLiteral";
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
  beforeAnnotated,
  afterAnnotated,
  onAnnotate,
  onReset,
}: {
  beforeImage: string | null;
  afterImage: string | null;
  diffs: StyleDiffRow[];
  // annotated만 주면 표시만 주석본(PreviewPanel — 미리보기와 제출물이 갈리지 않게).
  beforeAnnotated?: string | null;
  afterAnnotated?: string | null;
  // 핸들러가 있을 때만 액션 버튼을 렌더한다 — 읽기 전용 화면(PreviewPanel·DraftDetailDialog)
  // 보호. 기본값 `() => {}`를 넣으면 조용히 샌다.
  onAnnotate?: (slot: SnapshotSlot) => void;
  onReset?: (slot: SnapshotSlot) => void;
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
            <SnapshotCell
              slot="before"
              image={beforeImage}
              annotated={beforeAnnotated}
              testId="snapshot-before"
              onAnnotate={onAnnotate}
              onReset={onReset}
            />
          </td>
          <td className={docTableCell}>
            <SnapshotCell
              slot="after"
              image={afterImage}
              annotated={afterAnnotated}
              testId="snapshot-after"
              onAnnotate={onAnnotate}
              onReset={onReset}
            />
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

const SNAPSHOT_ALT = {
  before: { raw: "alt.beforeSnapshot", annotated: "alt.beforeSnapshotAnnotated" },
  after: { raw: "alt.afterSnapshot", annotated: "alt.afterSnapshotAnnotated" },
} as const;

function SnapshotCell({
  slot,
  image,
  annotated,
  testId,
  onAnnotate,
  onReset,
}: {
  slot: SnapshotSlot;
  image: string | null;
  annotated?: string | null;
  testId?: string;
  onAnnotate?: (slot: SnapshotSlot) => void;
  onReset?: (slot: SnapshotSlot) => void;
}) {
  const t = useT();
  // opacity-0으로 숨기면 투명해도 탭 순서에 남아 요소당 최대 4개의 유령 정지점이 생긴다 →
  // 노출 여부를 여기서 판정해 조건부 렌더한다. 카드 자체가 키보드 진입점(탭 정지점 1개)이다.
  // hover와 focus를 따로 세는 이유: 마우스를 올린 채 Tab으로 포커스를 카드 밖으로 옮기면
  // 한 플래그로는 포커스 이탈이 hover까지 꺼서 커서 밑 그룹이 사라진다.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const active = hovered || focused;
  const cardRef = useRef<HTMLDivElement>(null);
  // 캡처가 생략된 칸(좌표 불신·요소 소실·기준 강등)을 빈 셀로 두면 오류와 구별되지 않는다.
  if (!image && !annotated) {
    return (
      <span
        data-testid={testId ? `${testId}-empty` : undefined}
        className="text-muted-foreground/60"
      >
        {t("styleTable.noSnapshot")}
      </span>
    );
  }
  const src = annotated ?? image!;
  const editable = !!onAnnotate;
  return (
    <Card
      ref={cardRef}
      className={cn(
        "flex items-center justify-center bg-muted/30 p-1",
        editable &&
          "relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      // 액션 그룹의 유일한 키보드 진입점 — group role + 접근명이 있어야 스크린 리더가
      // "여기서 뭘 할 수 있는지"를 읽는다.
      role={editable ? "group" : undefined}
      aria-label={editable ? t(SNAPSHOT_ALT[slot].raw) : undefined}
      tabIndex={editable ? 0 : undefined}
      onPointerEnter={editable ? () => setHovered(true) : undefined}
      onPointerLeave={editable ? () => setHovered(false) : undefined}
      onFocus={editable ? () => setFocused(true) : undefined}
      // React onBlur는 focusout이라 버블한다 — 카드에서 자식 버튼으로 탭해 들어가는 순간에도
      // 발화하므로, 안쪽으로 이동한 경우는 걸러야 버튼이 눈앞에서 사라지지 않는다.
      onBlur={
        editable
          ? (e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                setFocused(false);
              }
            }
          : undefined
      }
    >
      <img
        data-testid={testId}
        src={src}
        alt={t(SNAPSHOT_ALT[slot][annotated ? "annotated" : "raw"])}
        className="max-h-40 w-auto max-w-full object-contain"
      />
      {editable && active ? (
        <ImageActions
          // 세로 중앙 고정 — 조상 컨테이너로 확장된 가로로 긴 캡처는 표시 높이가 30px대라
          // `top-2`(8) + `h-8`(32)이면 버튼이 카드 아래로 뚫고 나간다(design.md 위험 5).
          className="absolute right-1 top-1/2 -translate-y-1/2"
          onAnnotate={() => onAnnotate!(slot)}
          onReset={
            annotated && onReset
              ? () => {
                  onReset(slot);
                  // 제거 버튼이 언마운트되면 포커스가 body로 떨어진다 — 키보드 사용자를
                  // 진입점인 카드로 되돌려 그룹이 계속 열려 있게 한다.
                  cardRef.current?.focus();
                }
              : undefined
          }
        />
      ) : null}
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
  const showSwatch = !segments && isRenderableColorLiteral(value.trim());
  return (
    <span
      data-testid={testid}
      className={cn(
        "whitespace-pre-wrap break-all",
        muted && "text-muted-foreground",
      )}
    >
      {showSwatch ? (
        <ColorSwatch
          color={value.trim()}
          className="mr-1 inline-block align-[-1px]"
        />
      ) : null}
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
  "border-style": [
    "border-top-style",
    "border-right-style",
    "border-bottom-style",
    "border-left-style",
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

  return collapseBorderShorthand(result);
}

// 2차 패스: 1차 축약 결과에 border-width/style/color 세 행이 모두 있으면
// `border: W S C` 한 행으로 합친다. 하나라도 없으면(부분 변경) 통합하지 않는다.
function collapseBorderShorthand(rows: StyleDiffRow[]): StyleDiffRow[] {
  if (rows.some((r) => r.prop === "border")) return rows;
  const w = rows.find((r) => r.prop === "border-width");
  const s = rows.find((r) => r.prop === "border-style");
  const c = rows.find((r) => r.prop === "border-color");
  if (!w || !s || !c) return rows;

  const rawAsIs = `${w.asIs} ${s.asIs} ${c.asIs}`;
  const merged: StyleDiffRow = {
    prop: "border",
    asIs: rawAsIs.trim() === "" ? "" : rawAsIs,
    toBe: `${w.toBe} ${s.toBe} ${c.toBe}`,
  };

  const consumed = new Set([
    "border-width",
    "border-style",
    "border-color",
  ]);
  const out: StyleDiffRow[] = [];
  for (const row of rows) {
    if (consumed.has(row.prop)) {
      // 정렬상 가장 앞서는 border-color 자리에 끼워 순서 유지.
      if (row.prop === "border-color") out.push(merged);
      continue;
    }
    out.push(row);
  }
  return out;
}
