// 영상-로그 동기화용 순수 헬퍼. 컴포넌트는 부수효과/DOM이라 단위 테스트 부적합 — 여기만 분리.

// 정렬돼 있지 않을 수 있는 timestamps 중, currentMs 이하인 가장 늦은 항목의 원본 인덱스. 없으면 -1.
// 동일 timestamp 다발이면 마지막 인덱스(>= 비교로 후순위 우선).
export function findActiveIndex(timestamps: number[], currentMs: number): number {
  let bestIdx = -1;
  let bestVal = -Infinity;
  for (let i = 0; i < timestamps.length; i++) {
    const v = timestamps[i];
    if (v <= currentMs && v >= bestVal) {
      bestVal = v;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// (absTs - baseMs)를 초 단위(음수 clamp 0)로. seek 타깃 계산용.
export function toVideoSeconds(absTs: number, baseMs: number): number {
  return Math.max(0, (absTs - baseMs) / 1000);
}

export function formatPlayerTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// centerX(툴팁 중앙)에서 폭 tooltipWidth 박스의 left(top-left x)를 구하되,
// [margin, viewportWidth - margin] 안에 박스가 들어오도록 clamp. 뷰포트보다
// 넓으면 좌측 margin 고정.
export function clampTooltipLeft(
  centerX: number,
  tooltipWidth: number,
  viewportWidth: number,
  margin = 8,
): number {
  const left = centerX - tooltipWidth / 2;
  const max = viewportWidth - margin - tooltipWidth;
  if (left > max) return Math.max(margin, max);
  if (left < margin) return margin;
  return left;
}
