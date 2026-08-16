// window.setTimeout이 아니라 전역 setTimeout을 쓴다 — 브라우저에선 같은 함수이고,
// 이러면 이 모듈이 실행 환경에 안 묶여 node 트랙 유닛으로 시한을 고정할 수 있다.
// **그렇다고 src/content/ 레코더에서 import하지 말 것** — recorders-entry가 공유 청크를
// 갖는 순간 동기 IIFE가 깨져 pre-arm 버퍼링이 무력화된다(log-throttle.ts가 겪은 형태).
// 레코더에 시한이 필요하면 복제본을 둔다.
export function withTimeout<T>(
  p: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    p.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
