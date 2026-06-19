// 로그 행 렌더 공용 헬퍼 (Console/Network/Action LogContent 공유).

// 카드형 행 외양: 둥근 모서리 + hover/배경 클리핑.
export const ROW_CARD_CLASS = "rounded-md overflow-hidden";
// 행 리스트 컨테이너: 카드 간 간격 + 가장자리 패딩.
export const ROW_LIST_CLASS = "flex flex-col gap-1 overflow-hidden p-1";

// baseTs 기준 상대시간을 MM:SS로. 음수는 0으로 clamp.
export function formatRelativeTime(ts: number, baseTs: number): string {
  const diff = Math.max(0, Math.round((ts - baseTs) / 1000));
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// 동기화 모드(syncOn)에서만 active 보더 슬롯을 적용한다 — 라이브 서브탭은 보더 없는 기존
// 레이아웃 유지(2px 시프트 방지). 비동기 모드면 baseBg만 반환.
export function syncRowClass(syncOn: boolean, isActive: boolean, baseBg: string): string {
  if (!syncOn) return baseBg;
  return isActive
    ? "border-l-2 border-l-primary bg-accent/40"
    : `border-l-2 border-l-transparent ${baseBg}`;
}
