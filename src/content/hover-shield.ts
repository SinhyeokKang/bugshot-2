// picker overlay가 페이지 hover를 막는 두 번째 축. blocker는 picking 중에만 서 있고
// 그것이 사라지는 두 순간 — 선택 커밋(blocker display:none)과 캡처 준비(host
// visibility:hidden) — 커서 밑 페이지 요소가 다시 hit target이 돼 :hover가 붙는다.
// 그 hover가 before/after 스냅샷에 그대로 굳는 게 이 방패가 막는 회귀다.
// 이유가 겹치므로 스타일을 직접 쓰지 않고 이유 집합에서 파생시킨다(blocker-state와 같은 규율).
export type HoverShieldReason = "selection-commit" | "capture-prep";

export interface HoverShield {
  setReason(reason: HoverShieldReason, on: boolean): void;
  clearReasons(): void;
  // 방패 아래를 hit-test하는 동안만 비켜세운다. 끝나면 남은 이유 상태로 되돌아간다 —
  // 무조건 세우면 진행 중인 캡처를, 무조건 내리면 커밋 방패를 무단 취소한다. 중첩 호출
  // 금지(플래그가 카운터가 아니다). fn은 동기여야 한다.
  withHitTest<T>(fn: () => T): T;
}

// selection-commit은 사이드패널의 캡처 왕복을 기다리는 이유라 자기 끝을 모른다 — 캡처를
// 건너뛰는 경로(이미 beforeImage 보유)에선 endCapture가 영영 안 와 방패가 page를 붙잡고
// 남는다. 그래서 만료 타이머를 이유와 함께 소유한다(타이머만 남으면 나중에 켠 이유를 무단 취소).
// `apply`는 상태가 바뀔 때마다 호출되므로 호출부는 멱등해야 한다 — 리스너를 붙였다 떼는
// 구현이면 **참조가 안정적인 함수**를 써야 add/remove가 짝을 맞춘다.
export function createHoverShield(
  apply: (on: boolean) => void,
  expireMs: number,
): HoverShield {
  const reasons = new Set<HoverShieldReason>();
  let expireTimer: ReturnType<typeof setTimeout> | null = null;
  let hitTest = false;
  const sync = (): void => {
    apply(!hitTest && reasons.size > 0);
  };
  const clearExpiry = (): void => {
    if (expireTimer === null) return;
    clearTimeout(expireTimer);
    expireTimer = null;
  };
  const shield: HoverShield = {
    setReason(reason, on) {
      if (reason === "selection-commit") {
        clearExpiry();
        if (on) {
          expireTimer = setTimeout(() => {
            expireTimer = null;
            shield.setReason("selection-commit", false);
          }, expireMs);
        }
      }
      if (on) reasons.add(reason);
      else reasons.delete(reason);
      sync();
    },
    clearReasons() {
      clearExpiry();
      reasons.clear();
      sync();
    },
    withHitTest(fn) {
      hitTest = true;
      sync();
      try {
        return fn();
      } finally {
        hitTest = false;
        sync();
      }
    },
  };
  return shield;
}
