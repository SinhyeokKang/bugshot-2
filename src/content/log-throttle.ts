// Trailing throttle: schedule()이 호출되면 최대 intervalMs마다 flush를 1회 보장한다.
// 디바운스와 달리 연속 입력(로그 폭주) 중에도 flush가 무한정 밀리지 않는다.
// 타이머는 주입 가능(테스트용 fake timer) — chrome API 미사용이라 MAIN world 제약과 무관.
//
// ⚠️ content(레코더) 전용으로 유지할 것. recorders-entry 의존 트리가 self-contained여야
// crxjs가 동기 IIFE로 emit하고 document_start에 후크가 페이지 스크립트보다 먼저 깔린다
// (동기 IIFE 조건: 청크의 static import/dynamic import/export 0 — crxjs shouldUseLoader).
// sidepanel 등 다른 entry가 이 모듈을 import하면 공유 청크로 hoist돼 recorders-entry가
// async-import loader로 되돌아가 pre-arm 후크가 늦어진다(sidepanel은 ./trailing-throttle 사용).

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
