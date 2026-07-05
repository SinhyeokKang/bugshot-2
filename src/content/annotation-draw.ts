// annotation.ts가 DOM·이벤트를 다루고 순수 계산은 여기 분리(단위 테스트 대상).

// 획을 이루는 점: [x, y, drawnAtMs]. 세 번째 원소로 그린 시각을 실어 순서대로 페이드한다.
export type StrokePoint = readonly [number, number, number];

// 좌표 배열 → SVG path `d`. 첫 점은 M, 이후 L. 단일 포인트는 자기 자신으로의
// zero-length line(M x y L x y)이라 round linecap으로 점이 렌더된다. 빈 배열은 빈 문자열.
// 타임스탬프가 붙은 3-튜플도 받되 x,y(0,1번)만 읽는다.
export function pointsToPath(points: ReadonlyArray<readonly number[]>): string {
  if (points.length === 0) return "";
  const [head, ...rest] = points;
  let d = `M${head[0]} ${head[1]}`;
  if (rest.length === 0) {
    return `${d} L${head[0]} ${head[1]}`;
  }
  for (const [x, y] of rest) {
    d += ` L${x} ${y}`;
  }
  return d;
}

// pen/highlight 입력 스무딩 계수(EMA). shapes.ts PEN_SMOOTHING_ALPHA와 동일 값 유지
// (annotation-draw.test.ts 드리프트 가드가 강제). content↔sidepanel 레이어 분리로 복제.
export const PEN_SMOOTHING_ALPHA = 0.35;

// EMA 한 스텝: s = prev + alpha*(raw - prev). shapes.ts updateShapeDraft(pen/highlight)와 동일 공식.
// alpha=0 → prev 고정(최대 보정), alpha=1 → raw 그대로(보정 없음). 축별 독립.
export function smoothPoint(
  prev: readonly [number, number],
  raw: readonly [number, number],
  alpha: number,
): [number, number] {
  return [
    prev[0] + alpha * (raw[0] - prev[0]),
    prev[1] + alpha * (raw[1] - prev[1]),
  ];
}

// 먼저 그린(앞쪽) 만료 점들을 잘라 반환 — 그린 순서대로 꼬리부터 사라지는 트레일 효과.
// now - t > lifetimeMs인 선두 연속 구간만 제거하고 나머지는 순서대로 유지. 전부 만료면 [].
// 만료 점이 없으면 원본 참조를 그대로 반환(프레임마다 불필요한 복사 회피).
export function dropExpired(
  points: ReadonlyArray<StrokePoint>,
  now: number,
  lifetimeMs: number,
): ReadonlyArray<StrokePoint> {
  let i = 0;
  while (i < points.length && now - points[i][2] > lifetimeMs) i++;
  return i === 0 ? points : points.slice(i);
}
