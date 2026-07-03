// selector + frameId(0=top) 복합키 동등성. frameId 미지정(구버전 영속 스냅샷)은 0으로
// 정규화 — dedup·라우팅 술어가 이 규칙에서 한 곳이라도 갈라지면 조용한 오적용이 되므로 단일 출처.
export interface ElementKeyLike {
  selector: string;
  frameId?: number;
}

export function sameElementKey(a: ElementKeyLike, b: ElementKeyLike): boolean {
  return a.selector === b.selector && (a.frameId ?? 0) === (b.frameId ?? 0);
}
