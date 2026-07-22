export type PreviewLayoutEntry =
  | { kind: "section"; id: string }
  | { kind: "media" }
  | { kind: "logCards" };

// 이슈 프리뷰의 섹션 사이에 media/logCards 슬롯을 끼우는 순서 규칙.
// sectionIds의 "media" 자리에 media→logCards를 넣는다(그 id 자체는 섹션으로 렌더하지 않는다).
// media가 목록에 없으면 말미 — 레거시 순서 배열 방어.
export function composePreviewLayout(args: {
  sectionIds: string[];
  hasMedia: boolean;
  hasLogCards: boolean;
}): PreviewLayoutEntry[] {
  const { sectionIds, hasMedia, hasLogCards } = args;
  const out: PreviewLayoutEntry[] = [];
  let inserted = false;
  const insertSlots = () => {
    if (inserted) return;
    inserted = true;
    if (hasMedia) out.push({ kind: "media" });
    if (hasLogCards) out.push({ kind: "logCards" });
  };

  for (const id of sectionIds) {
    if (id === "media") {
      insertSlots();
      continue;
    }
    out.push({ kind: "section", id });
  }
  insertSlots();

  return out;
}
