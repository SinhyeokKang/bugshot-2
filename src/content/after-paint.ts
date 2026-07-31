// 오버레이를 숨긴 직후의 스타일 변경이 합성에 커밋될 때까지 기다린다 — 같은 태스크에서
// 캡처 준비 응답을 보내면 captureVisibleTab이 오버레이가 아직 살아있는 직전 프레임을 찍는다.
// hidden 탭에서는 rAF가 영영 발화하지 않으므로 타임아웃은 실패가 아니라 진행 신호다.
export function afterPaint(timeoutMs = 500): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const done = (): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      resolve();
    };
    timer = setTimeout(done, timeoutMs);
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => requestAnimationFrame(done));
    }
  });
}
