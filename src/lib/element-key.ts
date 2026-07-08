// selector + frameId(0=top) 복합키 동등성. frameId 미지정(구버전 영속 스냅샷)은 0으로
// 정규화 — dedup·라우팅 술어가 이 규칙에서 한 곳이라도 갈라지면 조용한 오적용이 되므로 단일 출처.
export interface ElementKeyLike {
  selector: string;
  frameId?: number;
}

export function sameElementKey(a: ElementKeyLike, b: ElementKeyLike): boolean {
  return a.selector === b.selector && (a.frameId ?? 0) === (b.frameId ?? 0);
}

// React key·라벨용 문자열 복합키. sameElementKey와 동일 규칙(frameId 미지정=0) —
// 두 요소가 sameElementKey면 elementKey도 일치한다. frameId(숫자)를 앞에 둬 첫 ":"가
// 항상 frameId·selector 경계 — selector가 공백(descendant combinator)·콜론(pseudo)을
// 포함해도 충돌하지 않는다.
export function elementKey(x: ElementKeyLike): string {
  return `${x.frameId ?? 0}:${x.selector}`;
}
