import { createTrailingThrottle } from "./trailing-throttle";

// 수신부 IndexedDB write 가드: 레코더 자동 flush(~200ms)로 수신 빈도가 올라도
// save(IndexedDB)는 trailing throttle(~1s)로 묶는다. 항상 "마지막으로 push된 payload"만 저장한다.
// (store set은 호출부에서 매번 — 메모리라 저렴.) createTrailingThrottle를 재사용한다.

export interface LogPersistGuard<T> {
  push(key: string, value: T): void; // 최신 payload 갱신 + throttled save 예약
  flushNow(): void; // 대기 중 payload 즉시 저장 (phase frozen 전이)
  discard(): void; // 예약 취소 + 대기 payload 폐기 (30s replay trim 직전)
}

export function createLogPersistGuard<T>(
  save: (key: string, value: T) => boolean | void | Promise<boolean | void>,
  intervalMs: number,
  scheduleTimer?: (cb: () => void, ms: number) => number,
  clearTimer?: (id: number) => void,
): LogPersistGuard<T> {
  let pending: { key: string; value: T } | null = null;

  const throttle = createTrailingThrottle(
    () => {
      if (!pending) return;
      const current = pending;
      // 실패(sync throw / reject / false resolve — blob-db save는 실패를 false로 resolve)
      // 시 pending 보존 → 다음 push/flush에서 재시도. 성공 시에만 비우되, save 진행 중
      // 새 push로 pending이 갱신됐으면 최신 payload를 지우지 않는다.
      let result: boolean | void | Promise<boolean | void>;
      try {
        result = save(current.key, current.value);
      } catch {
        return;
      }
      if (result instanceof Promise) {
        void result.then(
          (ok) => {
            if (ok !== false && pending === current) pending = null;
          },
          () => {},
        );
      } else if (result !== false) {
        pending = null;
      }
    },
    intervalMs,
    scheduleTimer,
    clearTimer,
  );

  return {
    push(key, value) {
      pending = { key, value };
      throttle.schedule();
    },
    flushNow() {
      throttle.flushNow();
    },
    discard() {
      throttle.cancel();
      pending = null;
    },
  };
}
