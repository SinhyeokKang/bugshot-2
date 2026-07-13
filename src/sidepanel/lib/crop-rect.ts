export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// 브라우저 줌 ≠ 100%면 viewport CSS px × DPR이 실제 캡처 이미지 크기와 어긋나 크롭이
// 경계를 넘고 가장자리에 투명 픽셀이 생긴다. 이미지 경계 안으로 가둔다.
export function clampCropRect(
  rect: CropRect,
  imgWidth: number,
  imgHeight: number,
): CropRect {
  if (imgWidth <= 0 || imgHeight <= 0) return rect;
  const x = Math.min(Math.max(0, rect.x), imgWidth - 1);
  const y = Math.min(Math.max(0, rect.y), imgHeight - 1);
  const right = Math.min(imgWidth, rect.x + rect.width);
  const bottom = Math.min(imgHeight, rect.y + rect.height);
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}
