// 업로드 MIME 공용 헬퍼 — 플랫폼별 submit 헬퍼가 공유한다.
// 확장자 → MIME. 플랫폼별 업로드 입력 타입의 합집합 (각 확장자는 단일 MIME이라 충돌 없음).
// 로그는 logs.html 단일 패키징으로 첨부되고 har/json은 그 안에서 다운로드 제공하므로 여기 대상 아님.
export function guessUploadMime(filename: string): string {
  if (filename.endsWith(".webp")) return "image/webp";
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) return "image/jpeg";
  if (filename.endsWith(".webm")) return "video/webm";
  if (filename.endsWith(".mp4")) return "video/mp4";
  if (filename.endsWith(".html")) return "text/html";
  if (filename.endsWith(".md")) return "text/markdown";
  return "application/octet-stream";
}
