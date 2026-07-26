// 사이드패널은 윈도우당 1개지만 chrome.runtime.sendMessage는 모든 extension context로
// broadcast된다 — 다른 탭에 붙은 인스턴스의 메시지를 걸러내지 못하면 내 store/IDB가 덮인다.
//
// fail-closed: 내 tabId가 아직 안 정해졌거나(마운트 직후 chrome.tabs.query 왕복) 영영 못
// 정해진 경우에도 드롭한다. 예전엔 그 구간에서 필터가 전면 해제돼 다른 탭의 logClear 한 번에
// 누적 로그가 통째로 사라졌다. 영구 null이면 App이 UnsupportedPage를 그리므로 어차피 이
// 패널로는 캡처가 불가능하다.
export function isForeignTabMessage(
  myTabId: number | null,
  msgTabId: number | null | undefined,
): boolean {
  // 탭 정보가 없는 메시지는 content script가 아니라 사이드패널·background 내부 통신이다.
  if (msgTabId == null) return false;
  return msgTabId !== myTabId;
}
