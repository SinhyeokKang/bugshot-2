import { sendBg } from "@/types/messages";
import type { ViewportRect } from "@/types/picker";
import { endCapture, prepareCapture } from "./picker-control";

const DEFAULT_MARGIN = 24;

export async function captureElementSnapshot(
  tabId: number,
  options: { margin?: number } = {},
): Promise<string | null> {
  const margin = options.margin ?? DEFAULT_MARGIN;
  const prep = await prepareCapture(tabId);
  if (!prep?.rect) {
    await endCapture(tabId);
    return null;
  }
  try {
    const dataUrl = await sendBg<string>({ type: "captureVisibleTab", tabId });
    return await cropImage(dataUrl, prep.rect, prep.viewport, margin);
  } catch (err) {
    console.error("[bugshot] snapshot failed", err);
    return null;
  } finally {
    await endCapture(tabId);
  }
}

async function cropImage(
  dataUrl: string,
  rect: ViewportRect,
  viewport: { width: number; height: number },
  margin: number,
): Promise<string> {
  const img = await loadImage(dataUrl);
  const scaleX = img.naturalWidth / viewport.width;
  const scaleY = img.naturalHeight / viewport.height;

  const x = Math.max(0, rect.x - margin);
  const y = Math.max(0, rect.y - margin);
  const right = Math.min(viewport.width, rect.x + rect.width + margin);
  const bottom = Math.min(viewport.height, rect.y + rect.height + margin);
  const w = Math.max(1, right - x);
  const h = Math.max(1, bottom - y);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scaleX);
  canvas.height = Math.round(h * scaleY);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.drawImage(
    img,
    x * scaleX,
    y * scaleY,
    w * scaleX,
    h * scaleY,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas.toDataURL("image/png");
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}
