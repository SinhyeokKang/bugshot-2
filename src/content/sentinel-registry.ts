// sentinel 부트스트랩 채널은 고정 이름 CustomEvent라 페이지가 위조할 수 있고, 브리지가
// sentinel을 평문 detail로 실어 보내므로 진짜 UUID도 페이지가 그냥 읽는다(둘 다 원리적 한계 —
// MAIN 레코더는 자기 sentinel을 모르는 채 document_start에 뜬다).
//
// 이 레지스트리가 없애는 건 **파괴적 교체 한 가지**다: 단일 슬롯이던 시절엔 위조 setSentinel
// 한 방이 진짜 세션의 stop/sync/clear 리스너를 떼어내 수집이 무음으로 죽었다. 다중 등록으로
// 그 경로는 사라졌지만 위조 sentinel은 여전히 자기 stop/clear 핸들러로 world 전역을 끌 수 있고,
// 캡을 넘겨 위조하면 FIFO가 진짜 sentinel을 evict한다 — 수용된 잔여 위험이다
// (docs/ARCHITECTURE.md "백그라운드 로그 캡처" 참조).

export interface SentinelRegistry {
  add(sentinel: string): boolean; // 새로 등록됐으면 true, 이미 있으면 false(멱등 재발행)
  list(): string[]; // dispatch 순회용 스냅샷
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
    evicted(): string[] {
      const out = dropped;
      dropped = [];
      return out;
    },
  };
}
