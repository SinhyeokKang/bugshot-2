// picker 오버레이의 배치 판정. overlay.ts는 DOM 측정·스타일 쓰기만 하고 좌표는 여기서 낸다
// — 레이아웃은 jsdom으로 못 잡아서, 순수 함수로 떼어야 유닛이 닿는다.

export const LABEL_GAP = 2;
export const LABEL_MARGIN = 8;

/** 배너는 "지금 보고 있는 페이지 크기" 안내라 top 프레임만 그린다. */
export function isTopFrame(win: { top?: unknown } | Window): boolean {
  return win === (win as { top?: unknown }).top;
}

// 뷰포트가 마진 두 배보다 좁으면(중첩 미니 iframe) 마진을 접어 최소 1px은 남긴다.
function effectiveMargin(vpW: number, margin: number): number {
  return Math.min(margin, Math.max(0, (vpW - 1) / 2));
}

function availableWidth(vpW: number, margin: number): number {
  return Math.max(1, vpW - effectiveMargin(vpW, margin) * 2);
}

/**
 * 라벨이 프레임보다 넓을 때 적용할 폭. 넉넉하면 null(제약 없음).
 * 좌표만 클램프하면 넘친 쪽이 잘려 값을 못 읽으므로(`#303038` → `03038`) 폭부터 줄인다.
 */
export function constrainLabelWidth(
  labelW: number,
  vpW: number,
  margin: number = LABEL_MARGIN,
): number | null {
  const avail = availableWidth(vpW, margin);
  return labelW > avail ? avail : null;
}

export interface LabelPlacementInput {
  rect: { top: number; bottom: number; left: number; right: number };
  labelW: number;
  labelH: number;
  vpW: number;
  vpH: number;
  gap?: number;
  margin?: number;
}

export function computeLabelPlacement({
  rect,
  labelW,
  labelH,
  vpW,
  vpH,
  gap = LABEL_GAP,
  margin = LABEL_MARGIN,
}: LabelPlacementInput): { top: number; left: number } {
  let top = rect.top - labelH - gap;
  if (top < margin) {
    const below = rect.bottom + gap;
    top = below + labelH > vpH - margin ? margin : below;
  }

  const m = effectiveMargin(vpW, margin);
  const w = Math.min(labelW, availableWidth(vpW, margin));
  let left = rect.left;
  if (left + w > vpW - m) left = rect.right - w;
  if (left < m) left = m;
  if (left + w > vpW - m) left = vpW - m - w;

  return { top, left: Math.max(0, left) };
}
