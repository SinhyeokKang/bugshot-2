/**
 * content script 왕복의 상한. **`chrome.tabs.sendMessage`에는 타임아웃이 없다** — 리스너는
 * 페이지 메인 스레드에서 디스패치되므로 대상 탭이 `alert()`·동기 무한루프에 걸려 있으면
 * 수신 컨텍스트가 파괴될 때까지 settle되지 않는다. 그 await를 물고 있는 전이는 `finally`에
 * 도달하지 못해 `busy`·시도 토큰이 영구 래치된다(회복 수단이 패널 재열기뿐이 된다).
 *
 * 거절은 통과시킨다 — "리시버 없음"(재주입 판단 근거)과 "페이지 정지"는 다른 사실이다.
 */
export const SEND_CAP_MS = 500;

export function withSendCap<T>(p: Promise<T>, capMs: number = SEND_CAP_MS): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const capped = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), capMs);
  });
  return Promise.race([p, capped]).finally(() => clearTimeout(timer));
}
