import type { PageMetrics } from "@/types/picker";

export const MAX_SCROLL_TILES = 20;
// 브라우저 canvas 높이 한계(≈32767px) 아래 여유.
export const MAX_CANVAS_HEIGHT_PX = 32000;

export interface TilePlan {
  index: number;
  scrollY: number;
}

export interface ScrollPlan {
  tiles: TilePlan[];
  tileHeight: number;
  totalHeight: number;
  truncated: boolean;
}

export interface TileDraw {
  srcY: number;
  srcHeight: number;
  destY: number;
}

export function planScrollCapture(
  metrics: PageMetrics,
  maxTiles: number = MAX_SCROLL_TILES,
): ScrollPlan {
  const vh = Math.floor(metrics.viewport.height);
  const docHeight = Math.floor(metrics.scrollHeight);
  if (vh <= 0 || docHeight <= 0) {
    const fallback = Math.max(1, vh);
    return {
      tiles: [{ index: 0, scrollY: 0 }],
      tileHeight: fallback,
      totalHeight: fallback,
      truncated: false,
    };
  }

  const dpr = metrics.devicePixelRatio > 0 ? metrics.devicePixelRatio : 1;
  const canvasLimit = Math.max(1, Math.floor(MAX_CANVAS_HEIGHT_PX / (vh * dpr)));
  const limit = Math.max(1, Math.min(maxTiles, canvasLimit));
  const needed = Math.ceil(docHeight / vh);
  const count = Math.min(needed, limit);
  const truncated = needed > count;

  return {
    tiles: Array.from({ length: count }, (_, index) => ({ index, scrollY: index * vh })),
    tileHeight: vh,
    totalHeight: truncated ? count * vh : docHeight,
    truncated,
  };
}

// 마지막 타일은 문서 끝에서 스크롤이 클램프돼 직전 타일과 겹친다 — 실제 도달한 scrollY로
// 겹친 만큼 srcY를 밀어 잘라내지 않으면 마지막 화면이 중복 출력된다.
export function tileDrawRect(plan: ScrollPlan, index: number, actualY: number): TileDraw {
  const destY = index * plan.tileHeight;
  const srcY = Math.max(0, destY - actualY);
  const srcHeight = Math.max(
    1,
    Math.min(plan.tileHeight - srcY, plan.totalHeight - destY),
  );
  return { srcY, srcHeight, destY };
}

export interface TilePixelRect {
  srcY: number;
  srcHeight: number;
  destY: number;
  destHeight: number;
}

// CSS px 좌표를 픽셀로 변환. 시작·끝 경계를 각각 반올림해 절대 좌표로 잡는다 — 높이를 따로
// 반올림하면 분수 배율(DPR 1.25/1.5, 출력 다운스케일)에서 타일 경계마다 ±1px 틈이 벌어진다.
// src는 캡처 이미지 배율, dest는 출력 캔버스 배율 — 다운스케일이 걸리면 둘이 갈린다.
export function tilePixelRect(
  plan: ScrollPlan,
  index: number,
  actualY: number,
  srcScale: number,
  destScale: number = srcScale,
): TilePixelRect {
  const draw = tileDrawRect(plan, index, actualY);
  const srcTop = Math.round(draw.srcY * srcScale);
  const srcBottom = Math.round((draw.srcY + draw.srcHeight) * srcScale);
  const destTop = Math.round(draw.destY * destScale);
  const destBottom = Math.round((draw.destY + draw.srcHeight) * destScale);
  return {
    srcY: srcTop,
    srcHeight: Math.max(1, srcBottom - srcTop),
    destY: destTop,
    destHeight: Math.max(1, destBottom - destTop),
  };
}
