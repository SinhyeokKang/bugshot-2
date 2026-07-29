import type { CaptureContext, ViewportRect } from "@/types/picker";

// 이번 캡처가 실제로 크롭할 rect를 정한다. 요소가 사라지면 rect의 한 변 이상이 0이 되는데,
// 그대로 크롭하면 마진(24px)만 남은 조각이 stale한 좌표에 앵커된 채 유효 이미지처럼 저장된다.
export function resolveCaptureRect(args: {
  rect: ViewportRect;
  viewport: { width: number; height: number };
  scrollX: number;
  scrollY: number;
  context?: CaptureContext;
  frameId: number;
}): ViewportRect | null {
  const { rect, viewport, scrollX, scrollY, context, frameId } = args;
  if (rect.width > 0 && rect.height > 0) return rect;
  // context를 넘기지 않는 경로(요소 단일 캡처·by-selector 재캡처)는 이 기능의 스코프 밖이라
  // 현행 동작(변이 0인 rect도 그대로 크롭 → 마진 조각)을 유지한다.
  if (!context) return rect;
  // iframe 응답은 viewport가 top 기준이고 scroll이 자기 프레임 기준이라 기준계가 섞인다.
  if (frameId !== 0) return null;
  const trustable =
    context.viewport.width === viewport.width &&
    context.viewport.height === viewport.height &&
    context.scrollX === scrollX &&
    context.scrollY === scrollY;
  // 좌표를 신뢰할 수 없으면 잘못된 영역을 찍는 대신 이미지 없음으로 간다.
  return trustable ? context.rect : null;
}

// after 캡처가 확장 판정을 다시 돌릴지. before가 확장에 성공했을 때만 같은 조상을 재측정한다 —
// before가 게이트에서 떨어졌는데 after만 확장하면(리플로우로 면적이 줄어드는 경우 등)
// 두 이미지가 서로 다른 기준을 쓴다.
export function shouldExpandAfter(context: CaptureContext | null): boolean {
  return context?.contextSelector != null;
}
