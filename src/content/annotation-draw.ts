// annotation.ts가 DOM·이벤트를 다루고 순수 계산은 여기 분리(단위 테스트 대상).

// 좌표 배열 → SVG path `d`. 첫 점은 M, 이후 L. 단일 포인트는 자기 자신으로의
// zero-length line(M x y L x y)이라 round linecap으로 점이 렌더된다. 빈 배열은 빈 문자열.
export function pointsToPath(points: Array<[number, number]>): string {
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
