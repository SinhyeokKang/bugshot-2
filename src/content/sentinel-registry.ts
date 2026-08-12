// sentinel 부트스트랩 채널은 고정 이름 CustomEvent라 페이지가 위조할 수 있다(원리적 한계 —
// MAIN 레코더는 자기 sentinel을 모르는 채 뜬다). 단일 슬롯이면 위조 한 방에 진짜 세션이
// 밀려나 수집이 무음으로 죽으므로, 다중 등록해 위조를 "무해한 추가 구독자"로 격하시킨다.

export interface SentinelRegistry {
  add(sentinel: string): boolean; // 새로 등록됐으면 true, 이미 있으면 false(멱등 재발행)
  list(): string[]; // dispatch 순회용 스냅샷
  has(sentinel: string): boolean;
  evicted(): string[]; // 캡 초과로 밀려난 항목 — 돌려준 뒤 비운다(리스너 해제 정확히 1회)
}

export function createSentinelRegistry(cap = 8): SentinelRegistry {
  const items: string[] = [];
  let dropped: string[] = [];

  return {
    add(sentinel: string): boolean {
      if (items.includes(sentinel)) return false;
      items.push(sentinel);
      while (items.length > cap) {
        const gone = items.shift();
        if (gone === undefined) break;
        dropped.push(gone);
      }
      return true;
    },
    list: () => items.slice(),
    has: (sentinel: string) => items.includes(sentinel),
    evicted(): string[] {
      const out = dropped;
      dropped = [];
      return out;
    },
  };
}
