// 오버레이를 숨긴 직후의 스타일 변경이 합성에 커밋될 때까지 기다린다 — 같은 태스크에서
// 캡처 준비 응답을 보내면 captureVisibleTab이 오버레이가 아직 살아있는 직전 프레임을 찍는다.
//
// 화면에 없는 문서는 프레임을 커밋하지 않아 rAF가 영영 발화하지 않는다 — 기다릴 대상이
// 없으므로 즉시 진행한다. 남은 타임아웃도 실패가 아니라 진행 신호다(느린 프레임에 캡처를
// 묶지 않는다). 대기가 길수록 그 사이 탭이 비활성으로 바뀌어 캡처 자체가 거부될 창도
// 넓어지므로, 폴백은 프레임 두 장보다 넉넉한 선에서 짧게 잡는다.
export function afterPaint(timeoutMs = 150): Promise<void> {
  if (typeof requestAnimationFrame !== "function") return Promise.resolve();
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return Promise.resolve();
  }
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
    requestAnimationFrame(() => requestAnimationFrame(done));
  });
}
