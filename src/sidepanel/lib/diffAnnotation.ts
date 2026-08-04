import { sameElementKey, type ElementKeyLike } from "@/lib/element-key";

export type SnapshotSlot = "before" | "after";

export interface DiffAnnotationTarget {
  target: "current" | "buffered";
  selector: string;
  frameId: number;
}

// diff table 카드는 mergeStyleElements의 파생 배열이라 쓰기 대상이 아니다. 술어는 그 함수의
// 조건을 그대로 비춰야 한다: 현재 요소는 **diff가 1건 이상일 때만** curResolved가 되어 같은 키의
// 버퍼 항목을 밀어낸다. 키 일치만 보면, 현재 diff가 0건이라 버퍼 카드가 렌더되는 상황에서도
// current로 보내 주석이 top-level에 써지고 카드·제출물은 그대로인 무음 no-op이 된다.
// 주석 추가·제거가 같은 판정을 타야 버퍼 카드의 제거가 현재 요소를 안 지운다.
export function routeDiffAnnotation(
  el: ElementKeyLike,
  selection: ElementKeyLike | null | undefined,
  currentHasDiffs: boolean,
): DiffAnnotationTarget {
  return {
    target:
      selection && currentHasDiffs && sameElementKey(el, selection)
        ? "current"
        : "buffered",
    selector: el.selector,
    frameId: el.frameId ?? 0,
  };
}

// 재주석은 주석본 위에서 이어 그린다 — 원본을 배경으로 열면 직전 도형이 사라진 것처럼 보인다.
export function annotationSource(
  el: {
    beforeImage?: string | null;
    afterImage?: string | null;
    beforeAnnotated?: string | null;
    afterAnnotated?: string | null;
  },
  slot: SnapshotSlot,
): string | null {
  return slot === "before"
    ? el.beforeAnnotated ?? el.beforeImage ?? null
    : el.afterAnnotated ?? el.afterImage ?? null;
}
