// Trailing throttle: schedule()이 호출되면 최대 intervalMs마다 flush를 1회 보장한다.
// 디바운스와 달리 연속 입력(로그 폭주) 중에도 flush가 무한정 밀리지 않는다.
// 타이머는 주입 가능(테스트용 fake timer) — chrome API 미사용이라 MAIN world 제약과 무관.

// 레코더 3종 공통 자동 flush 주기. 셋이 동일해야 단일 타임라인 병합 지연이 일관된다.
export const FLUSH_INTERVAL_MS = 200;

export interface TrailingThrottle {
  schedule(): void;
  flushNow(): void;
  cancel(): void;
}

export function createTrailingThrottle(
  flush: () => void,
  intervalMs: number,
  scheduleTimer: (cb: () => void, ms: number) => number = (cb, ms) =>
    setTimeout(cb, ms) as unknown as number,
  clearTimer: (id: number) => void = (id) => clearTimeout(id),
): TrailingThrottle {
  let timerId: number | null = null;

  // 레코더 dispatch 오류가 타이머 콜백·호출자(pagehide 등)로 전파되지 않도록 격리.
  function runFlush(): void {
    try {
      flush();
    } catch {
      /* 레코더 오류 무시 */
    }
  }

  function schedule(): void {
    if (timerId !== null) return; // 이미 예약됨 — interval당 1회만
    timerId = scheduleTimer(() => {
      timerId = null;
      runFlush();
    }, intervalMs);
  }

  function flushNow(): void {
    if (timerId !== null) {
      clearTimer(timerId);
      timerId = null;
    }
    runFlush();
  }

  function cancel(): void {
    if (timerId !== null) {
      clearTimer(timerId);
      timerId = null;
    }
  }

  return { schedule, flushNow, cancel };
}
