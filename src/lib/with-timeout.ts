// window.setTimeout이 아니라 전역 setTimeout을 쓴다 — 브라우저에선 같은 함수이고,
// 이러면 이 모듈이 실행 환경에 안 묶여 node 트랙 유닛으로 시한을 고정할 수 있다.
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
