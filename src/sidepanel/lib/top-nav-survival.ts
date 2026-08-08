/**
 * top 문서가 갈렸을 때 편집 세션이 살아남는가.
 *
 * **주소 비교만으로는 부족하다.** `tabs.onUpdated(info.url)`은 top에서만 오므로 이 이벤트는
 * "top 문서가 교체됐다"와 동치이고, 그 순간 하위 프레임은 전부 사라진다. 그런데 하위 프레임에서
 * 고른 요소는 `target.url`에 **그 프레임의 주소**가 들어가 있어(디바이스 뷰포트 래퍼가 대표
 * 사례다), 사용자가 top을 바로 그 주소로 옮기면 두 키가 같아져 세션이 통과한다 — 프레임은
 * 사라졌는데 `selection.frameId`만 죽은 채로 남는다.
 */
export function survivesTopNavigation(input: {
  prevKey: string | null | undefined;
  newKey: string | null | undefined;
  selectionFrameId: number | undefined;
}): boolean {
  if (!input.prevKey) return true;
  if (input.prevKey !== input.newKey) return false;
  return (input.selectionFrameId ?? 0) === 0;
}
