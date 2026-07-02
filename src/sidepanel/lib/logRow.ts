// 로그 행 렌더 공용 헬퍼 (Console/Network/Action LogContent 공유).

// 초를 M:SS로. 음수·소수는 0 clamp + floor.
export function formatMmSs(totalSec: number): string {
  const whole = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// baseTs 기준 상대시간을 MM:SS로. 초 단위로 반올림 후 음수는 0으로 clamp.
export function formatRelativeTime(ts: number, baseTs: number): string {
  return formatMmSs(Math.round((ts - baseTs) / 1000));
}

// 동기화 모드(syncOn)에서만 active 보더 슬롯을 적용한다 — 라이브 서브탭은 보더 없는 기존
// 레이아웃 유지(2px 시프트 방지). 비동기 모드면 baseBg만 반환.
export function syncRowClass(syncOn: boolean, isActive: boolean, baseBg: string): string {
  if (!syncOn) return baseBg;
  return isActive
    ? "border-l-2 border-l-primary bg-accent/40"
    : `border-l-2 border-l-transparent ${baseBg}`;
}
