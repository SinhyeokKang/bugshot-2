import { sendBg } from "@/types/messages";
import { clampCropRect } from "@/sidepanel/lib/crop-rect";
import { resolveCaptureRect } from "@/sidepanel/lib/capture-basis";
import type {
  CaptureContext,
  PrepareCaptureResponse,
  ViewportRect,
} from "@/types/picker";
import {
  endCapture,
  maybeSurfacePermissionExpired,
  prepareCapture,
  prepareCaptureBySelector,
} from "./picker-control";

const DEFAULT_MARGIN = 24;

export interface CaptureResult {
  image: string;
  context: CaptureContext;
}

interface CaptureOptions {
  margin?: number;
  frameId?: number;
  // 확장 판정 opt-in. 기본 false — element mode before/after만 켠다.
  expandContext?: boolean;
  context?: CaptureContext;
}

export async function captureElementSnapshot(
  tabId: number,
  options: CaptureOptions = {},
): Promise<CaptureResult | null> {
  return captureWithPrep(
    tabId,
    await prepareCapture(tabId, options.frameId ?? 0, {
      expandContext: options.expandContext,
      contextSelector: options.context?.contextSelector ?? undefined,
    }),
    options,
  );
}

export async function captureElementSnapshotBySelector(
  tabId: number,
  selector: string,
  options: { margin?: number; frameId?: number } = {},
): Promise<CaptureResult | null> {
  return captureWithPrep(
    tabId,
    await prepareCaptureBySelector(tabId, options.frameId ?? 0, selector),
    options,
  );
}

async function captureWithPrep(
  tabId: number,
  prep: PrepareCaptureResponse | null,
  options: CaptureOptions,
): Promise<CaptureResult | null> {
  const margin = options.margin ?? DEFAULT_MARGIN;
  const frameId = options.frameId ?? 0;
  if (!prep?.rect) {
    await endCapture(tabId, frameId);
    return null;
  }
  const usable = resolveCaptureRect({
    rect: prep.rect,
    viewport: prep.viewport,
    scrollX: prep.scrollX,
    scrollY: prep.scrollY,
    context: options.context,
    frameId,
  });
  if (!usable) {
    await endCapture(tabId, frameId);
    return null;
  }
  try {
    const dataUrl = await sendBg<string>({ type: "captureVisibleTab", tabId });
    // 배율은 지금 찍은 캡처 기준이라 viewport는 항상 현재 prep.viewport를 쓴다.
    const image = await cropImage(dataUrl, usable, prep.viewport, margin);
    return {
      image,
      context: {
        contextSelector: prep.contextSelector ?? null,
        rect: usable,
        viewport: prep.viewport,
        scrollX: prep.scrollX,
        scrollY: prep.scrollY,
      },
    };
  } catch (err) {
    if (!maybeSurfacePermissionExpired(err)) {
      console.error("[bugshot] snapshot failed", err);
    }
    return null;
  } finally {
    await endCapture(tabId, frameId);
  }
}

// 스케일은 캡처 이미지 폭 / 페이지 뷰포트 폭에서 유도한다 — 사이드패널의 devicePixelRatio는
// 페이지 줌을 모른다. 크롭은 영역·인라인·요소 스냅샷 공용(단일 구현).
export async function cropImage(
  dataUrl: string,
  rect: ViewportRect,
  viewport: { width: number; height: number },
  margin = 0,
): Promise<string> {
  const img = await loadImage(dataUrl);
  if (viewport.width <= 0 || viewport.height <= 0) return dataUrl;
  const scale = img.naturalWidth / viewport.width;
  const r = clampCropRect(
    {
      x: (rect.x - margin) * scale,
      y: (rect.y - margin) * scale,
      width: (rect.width + margin * 2) * scale,
      height: (rect.height + margin * 2) * scale,
    },
    img.naturalWidth,
    img.naturalHeight,
  );

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(r.width);
  canvas.height = Math.round(r.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.drawImage(img, r.x, r.y, r.width, r.height, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/webp", 0.92);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}
