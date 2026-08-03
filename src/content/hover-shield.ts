// picker overlay가 페이지 hover를 막는 두 번째 축. blocker는 picking 중에만 서 있고
// 그것이 사라지는 두 순간 — 선택 커밋(blocker display:none)과 캡처 준비(host
// visibility:hidden) — 커서 밑 페이지 요소가 다시 hit target이 돼 :hover가 붙는다.
// 그 hover가 before/after 스냅샷에 그대로 굳는 게 이 방패가 막는 회귀다.
// 이유가 겹치므로 스타일을 직접 쓰지 않고 이유 집합에서 파생시킨다(blocker-state와 같은 규율).
export type HoverShieldReason = "selection-commit" | "capture-prep";

export interface HoverShield {
  setReason(reason: HoverShieldReason, on: boolean): void;
  clearReasons(): void;
}

// selection-commit은 사이드패널의 캡처 왕복을 기다리는 이유라 자기 끝을 모른다 — 캡처를
// 건너뛰는 경로(이미 beforeImage 보유)에선 endCapture가 영영 안 와 방패가 page를 붙잡고
// 남는다. 그래서 만료 타이머를 이유와 함께 소유한다(타이머만 남으면 나중에 켠 이유를 무단 취소).
export function createHoverShield(
  apply: (on: boolean) => void,
  expireMs: number,
): HoverShield {
  const reasons = new Set<HoverShieldReason>();
  let expireTimer: ReturnType<typeof setTimeout> | null = null;
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
      apply(reasons.size > 0);
    },
    clearReasons() {
      clearExpiry();
      reasons.clear();
      apply(false);
    },
  };
  return shield;
}
