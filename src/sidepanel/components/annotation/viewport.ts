// 어노테이션 캔버스의 줌·팬 계산. DOM·React 의존 없는 순수 함수 단일 출처.

export const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const;
export const MAX_ZOOM = 4;

// 클릭과 팬 드래그를 가르는 이동량(px).
export const PAN_CLICK_THRESHOLD = 3;

// 배율 비교용 부동소수 허용치.
export const ZOOM_EPS = 1e-6;
const EPS = ZOOM_EPS;

// 사용자 배율. null = 맞춤(fit 추종), "all" = 전체 조망(fitAll 추종), number = 고정 배율.
// fit/fitAll은 뷰포트 크기에서 파생되므로 "그때의 숫자"가 아니라 의도를 저장한다.
export type ZoomLevel = number | "all" | null;

export function resolveScale(zoom: ZoomLevel, fit: number, fitAll: number): number {
  if (zoom === null) return fit;
  if (zoom === "all") return fitAll;
  return zoom;
}

// 스톱 배율(number)을 저장할 ZoomLevel로 바꾼다 — fit/fitAll과 같으면 추종 상태로 접는다.
export function normalizeZoom(next: number, fit: number, fitAll: number): ZoomLevel {
  if (Math.abs(next - fit) < EPS) return null;
  if (Math.abs(next - fitAll) < EPS) return "all";
  return next;
}

// 이미지 폭을 가용 폭에 맞추는 배율. 확대는 안 함(최대 1).
// 크기가 0 이하면 1 — 첫 렌더의 clientWidth=0에서 음수 배율이 나오는 걸 막는다.
export function fitWidthScale(natW: number, availW: number): number {
  if (natW <= 0 || availW <= 0) return 1;
  return Math.min(availW / natW, 1);
}

// 이미지 전체를 가용 영역에 담는 배율(조망용).
export function fitAllScale(
  natW: number,
  natH: number,
  availW: number,
  availH: number,
): number {
  if (natW <= 0 || natH <= 0 || availW <= 0 || availH <= 0) return 1;
  return Math.min(availW / natW, availH / natH, 1);
}

// [fitAll?, fit, ...fit보다 큰 프리셋] 오름차순.
// fit과 fitAll 사이 프리셋은 제외 — 축소 방향 선택지는 조망(fitAll) 하나로 족하다.
export function zoomStops(fit: number, fitAll: number): number[] {
  const above = ZOOM_PRESETS.filter((p) => p > fit + EPS);
  const stops = [fit, ...above];
  if (fitAll < fit - EPS) stops.unshift(fitAll);
  return stops;
}

// stops에서 current의 dir 방향 이웃. 경계면 current 유지.
// current가 stops에 없는 값(리사이즈 경합)이어도 가장 가까운 이웃으로 수렴한다.
export function stepZoom(current: number, stops: number[], dir: 1 | -1): number {
  if (dir === 1) return stops.find((s) => s > current + EPS) ?? current;
  return [...stops].reverse().find((s) => s < current - EPS) ?? current;
}

interface AnchorMetrics {
  scrollLeft: number;
  scrollTop: number;
  clientWidth: number;
  clientHeight: number;
  contentWidth: number; // natural px (스케일 전)
  contentHeight: number;
  oldScale: number;
  newScale: number;
}

// 배율 변경 시 뷰포트 중앙에 있던 이미지 지점이 그대로 중앙에 남도록 하는 새 스크롤 오프셋.
export function centerAnchoredScroll(m: AnchorMetrics): {
  scrollLeft: number;
  scrollTop: number;
} {
  if (m.oldScale <= 0) return { scrollLeft: 0, scrollTop: 0 };
  const cx = (m.scrollLeft + m.clientWidth / 2) / m.oldScale;
  const cy = (m.scrollTop + m.clientHeight / 2) / m.oldScale;
  const maxLeft = Math.max(0, m.contentWidth * m.newScale - m.clientWidth);
  const maxTop = Math.max(0, m.contentHeight * m.newScale - m.clientHeight);
  return {
    scrollLeft: clamp(cx * m.newScale - m.clientWidth / 2, 0, maxLeft),
    scrollTop: clamp(cy * m.newScale - m.clientHeight / 2, 0, maxTop),
  };
}

// 팬 드래그 — 포인터가 움직인 만큼 콘텐츠를 끌어오므로 스크롤은 반대 방향으로 간다.
// 범위 클램프는 브라우저의 scrollLeft/Top 대입이 알아서 한다.
export function panScroll(
  origin: { scrollLeft: number; scrollTop: number; clientX: number; clientY: number },
  now: { clientX: number; clientY: number },
): { scrollLeft: number; scrollTop: number } {
  return {
    scrollLeft: origin.scrollLeft - (now.clientX - origin.clientX),
    scrollTop: origin.scrollTop - (now.clientY - origin.clientY),
  };
}

export function formatZoomPercent(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}
