export type PreviewLayoutEntry =
  | { kind: "section"; id: string }
  | { kind: "media" }
  | { kind: "logCards" };

// 이슈 프리뷰의 섹션 사이에 media/logCards 슬롯을 끼우는 순서 규칙.
// 첫 POST_MEDIA 섹션 바로 앞에 media→logCards를 넣고, 그런 섹션이 없으면 말미에 붙인다.
export function composePreviewLayout(args: {
  sectionIds: string[];
  postMediaSectionIds: Set<string>;
  hasMedia: boolean;
  hasLogCards: boolean;
}): PreviewLayoutEntry[] {
  const { sectionIds, postMediaSectionIds, hasMedia, hasLogCards } = args;
  const out: PreviewLayoutEntry[] = [];
  let inserted = false;
  const insertSlots = () => {
    if (inserted) return;
    inserted = true;
    if (hasMedia) out.push({ kind: "media" });
    if (hasLogCards) out.push({ kind: "logCards" });
  };

  for (const id of sectionIds) {
    if (postMediaSectionIds.has(id)) insertSlots();
    out.push({ kind: "section", id });
  }
  insertSlots();

  return out;
}
