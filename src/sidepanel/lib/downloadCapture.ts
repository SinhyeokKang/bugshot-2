import { dataUrlToBlob } from "@/store/blob-db";
import { recordingFilename } from "./video-mime";

// data URL의 image/<subtype>에서 다운로드 확장자를 뽑는다. image가 아니거나 파싱 실패 시
// 캡처 기본 포맷인 webp로 폴백(buildCaptureFiles의 screenshot.webp와 동일 가정).
export function imageExtFromDataUrl(dataUrl: string): string {
  const m = /^data:image\/([a-z0-9.+-]+)/i.exec(dataUrl);
  if (!m) return "webp";
  const sub = m[1].toLowerCase();
  return sub === "jpeg" ? "jpg" : sub === "svg+xml" ? "svg" : sub;
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadImageDataUrl(dataUrl: string, base = "screenshot"): void {
  triggerDownload(dataUrlToBlob(dataUrl), `${base}.${imageExtFromDataUrl(dataUrl)}`);
}

export function downloadVideoBlob(blob: Blob): void {
  triggerDownload(blob, recordingFilename(blob.type));
}
