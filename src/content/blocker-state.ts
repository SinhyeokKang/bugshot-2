// picker blocker의 pointer-events 소유권. 투과 이유가 여러 개 겹칠 수 있고(스크롤 양보 중
// iframe 위로 진입 등) 각자 자기 이유만 해제해야 하는데, 스타일을 직접 쓰면 마지막 쓰기가
// 남의 투과를 무단 취소한다. 상태와 적용을 함께 쥐어 apply 누락도 구조적으로 막는다.
type PassthroughReason = "scroll-yield" | "handoff";

// 스크롤 직후의 마우스 이동은 스크롤의 일부다 — 브라우저가 hover 재계산용으로 쏘는 것이든
// 매직마우스·트랙패드처럼 스크롤과 이동이 한 제스처든, 그걸 포인팅 의도로 읽으면 매 틱
// 양보가 닫혀 커서 밑 스크롤 컨테이너가 안 밀린다.
export function isScrollIntent(
  now: number,
  lastWheelAt: number,
  windowMs: number,
): boolean {
  return now - lastWheelAt < windowMs;
}

export interface BlockerPassthrough {
  setReason(reason: PassthroughReason, on: boolean): void;
  clearReasons(): void;
  // blocker를 잠깐 투과시켜 그 아래를 hit-test한다. 끝나면 남은 이유 상태로 되돌아간다 —
  // 무조건 "auto"로 복원하면 진행 중인 양보·핸드오프를 무단 취소한다. 중첩 호출 금지
  // (플래그가 카운터가 아니라 안쪽 종료가 바깥 프로브를 끈다). fn은 동기여야 한다.
  withHitTest<T>(fn: () => T): T;
}

export function createBlockerPassthrough(
  apply: (value: "auto" | "none") => void,
): BlockerPassthrough {
  const reasons = new Set<PassthroughReason>();
  let hitTest = false;
  const sync = (): void => {
    apply(hitTest || reasons.size > 0 ? "none" : "auto");
  };
  return {
    setReason(reason, on) {
      if (on) reasons.add(reason);
      else reasons.delete(reason);
      sync();
    },
    clearReasons() {
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
}
