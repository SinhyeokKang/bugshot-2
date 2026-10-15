// 오버레이를 숨긴 직후의 스타일 변경이 합성에 커밋될 때까지 기다린다 — 같은 태스크에서
// 캡처 준비 응답을 보내면 captureVisibleTab이 오버레이가 아직 살아있는 직전 프레임을 찍는다.
//
// 화면에 없는 문서는 프레임을 커밋하지 않아 rAF가 영영 발화하지 않는다 — 기다릴 대상이
// 없으므로 즉시 진행하고, 대기 중 숨겨져도 그 자리에서 진행한다(캡처 거부는 관문이 판정).
// 화면에 있는 문서는 프레임이 늦어도 기다린다 — 숨김 뒤 첫 프레임이 +228ms에 온 실측에서
// 150ms 폴백이 먼저 끝나 오버레이가 before에 찍혔다(#263). 1s는 그 숨김 이후 꼬리(228ms)를
// 덮는 상한이고 같은 실측의 rAF 정지 총량(~1.45s)은 덮지 않는다 — 그 이상은 런타임 재검증으로
// 판정한다. 상한은 프레임이 끝내 안 오는 경우에만 캡처를 놓아주는 안전판이다.
export const PAINT_WAIT_CAP_MS = 1000;

export function afterPaint(timeoutMs = PAINT_WAIT_CAP_MS): Promise<void> {
  if (typeof requestAnimationFrame !== "function") return Promise.resolve();
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") done();
    };
    const done = (): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      resolve();
    };
    timer = setTimeout(done, timeoutMs);
    document.addEventListener("visibilitychange", onVisibility);
    requestAnimationFrame(() => requestAnimationFrame(done));
  });
}
