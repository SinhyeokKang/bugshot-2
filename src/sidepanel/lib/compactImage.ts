const COMPACT_MAX_WIDTH = 1280;
const COMPACT_MIN_WIDTH = 200;

export function calcCompactDimensions(
  w: number,
  h: number,
  maxWidth = COMPACT_MAX_WIDTH,
): { width: number; height: number } {
  if (w <= maxWidth) return { width: w, height: h };
  const ratio = maxWidth / w;
  return { width: maxWidth, height: Math.round(h * ratio) };
}

export function shouldCompact(w: number, mimeType: string): boolean {
  if (mimeType === "image/webp" && w <= COMPACT_MAX_WIDTH) return false;
  if (w <= COMPACT_MIN_WIDTH && (mimeType === "image/webp" || mimeType === "image/jpeg")) return false;
  return true;
}

export async function compactImage(bitmap: ImageBitmap): Promise<Blob> {
  const { width, height } = calcCompactDimensions(bitmap.width, bitmap.height);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
}
