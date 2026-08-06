// Radix DismissableLayer는 modal Dialog 자신을 pointer-events 기준선으로 삼아
// (isPointerEventsEnabled = index >= highestIndex) 위에 쌓인 non-modal 레이어와
// Dialog 양쪽에 outside 이벤트를 보낸다. dim 클릭이 콤보박스만 닫고 끝나려면
// Dialog가 "내 위에 열린 레이어가 있나"를 스스로 물어야 한다. 소유 판정은 포커스
// 위치가 아니라 레이어가 심은 DOM 마커로 한다(docs/POSTMORTEM.md 2026-07-22).
//
// 전제: 열린 레이어는 항상 Dialog 위에 쌓인 것이다. Dialog 밖에서 이미 열려 있던
// Popover는 Dialog를 여는 클릭 자체가 닫으므로 성립하는데, 사용자 클릭 없이 열리는
// Dialog가 생기면 그 Popover가 아래 깔린 채 남아 dim 클릭이 영영 막힌다(Esc·X는 유효).
const OPEN_DISMISS_LAYER_SELECTOR = '[data-dismiss-layer][data-state="open"]';

export function hasOpenDismissLayer(root: ParentNode): boolean {
  return root.querySelector(OPEN_DISMISS_LAYER_SELECTOR) !== null;
}
