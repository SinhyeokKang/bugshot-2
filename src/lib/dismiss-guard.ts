// Radix DismissableLayer는 modal Dialog 자신을 pointer-events 기준선으로 삼아
// (isPointerEventsEnabled = index >= highestIndex) 위에 쌓인 non-modal 레이어와
// Dialog 양쪽에 outside 이벤트를 보낸다. dim 클릭이 콤보박스만 닫고 끝나려면
// Dialog가 "내 위에 열린 레이어가 있나"를 스스로 물어야 한다. 소유 판정은 포커스
// 위치가 아니라 레이어가 심은 DOM 마커로 한다(docs/POSTMORTEM.md 2026-07-22).
const OPEN_DISMISS_LAYER_SELECTOR = '[data-dismiss-layer][data-state="open"]';

// Dialog 아래 깔린 레이어는 Radix가 인라인 pointer-events를 꺼둔다. 그 레이어는 자기
// outside 이벤트조차 못 받아 스스로 닫히지 못하므로, 세면 dim 클릭이 영영 막힌다.
export function hasOpenDismissLayer(root: ParentNode): boolean {
  const layers = root.querySelectorAll<HTMLElement>(OPEN_DISMISS_LAYER_SELECTOR);
  return [...layers].some((el) => el.style.pointerEvents !== "none");
}
