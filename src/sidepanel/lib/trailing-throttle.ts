// sidepanel 전용 trailing throttle. content의 log-throttle.ts와 같은 구현이지만 의도적으로 분리한다 —
// log-persist-guard가 @/content/log-throttle을 import하면 그 모듈이 content(레코더)와 sidepanel의
// 공유 청크가 되어, recorders-entry 청크가 그 청크를 static import하게 된다. 그러면 crxjs가
// recorders-entry를 동기 IIFE가 아닌 async-import loader로 emit해 document_start 후크가 페이지
// 스크립트보다 늦어진다(pre-arm 무력화). content/log-throttle을 content 전용으로 유지하기 위한 분리.

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

  function runFlush(): void {
    try {
      flush();
    } catch {
      /* 호출자(persist 등) 오류 무시 */
    }
  }

  function schedule(): void {
    if (timerId !== null) return;
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
