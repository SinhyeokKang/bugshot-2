import { createTrailingThrottle } from "@/content/log-throttle";

// 수신부 IndexedDB write 가드: 레코더 자동 flush(~200ms)로 수신 빈도가 올라도
// save(IndexedDB)는 trailing throttle(~1s)로 묶는다. 항상 "마지막으로 push된 payload"만 저장한다.
// (store set은 호출부에서 매번 — 메모리라 저렴.) createTrailingThrottle를 재사용한다.

export interface LogPersistGuard<T> {
  push(key: string, value: T): void; // 최신 payload 갱신 + throttled save 예약
  flushNow(): void; // 대기 중 payload 즉시 저장 (phase frozen 전이)
  discard(): void; // 예약 취소 + 대기 payload 폐기 (30s replay trim 직전)
}

export function createLogPersistGuard<T>(
  save: (key: string, value: T) => void,
  intervalMs: number,
  scheduleTimer?: (cb: () => void, ms: number) => number,
  clearTimer?: (id: number) => void,
): LogPersistGuard<T> {
  let pending: { key: string; value: T } | null = null;

  const throttle = createTrailingThrottle(
    () => {
      if (!pending) return;
      const { key, value } = pending;
      pending = null;
      save(key, value);
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
