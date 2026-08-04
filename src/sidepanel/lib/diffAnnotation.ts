import { sameElementKey, type ElementKeyLike } from "@/lib/element-key";

export type SnapshotSlot = "before" | "after";

export interface DiffAnnotationTarget {
  target: "current" | "buffered";
  selector: string;
  frameId: number;
}

// diff table 카드는 mergeStyleElements의 파생 배열이라 쓰기 대상이 아니다. 같은 요소가 selection과
// bufferedElements에 동시에 존재하는 창(버퍼 승격 전 비동기 구간)이 있지만, mergeStyleElements가
// 그때 현재 쪽을 남기고 버퍼 쪽을 밀어내므로 `sameElementKey(el, selection)`가 참이면 그 카드는
// 반드시 현재 요소다. 주석 추가·제거가 같은 판정을 타야 버퍼 카드의 제거가 현재 요소를 안 지운다.
export function routeDiffAnnotation(
  el: ElementKeyLike,
  selection: ElementKeyLike | null | undefined,
): DiffAnnotationTarget {
  return {
    target: selection && sameElementKey(el, selection) ? "current" : "buffered",
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
