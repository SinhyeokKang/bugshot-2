// getDisplayMedia 스트림의 video track settings에서 해상도를 뽑는다. 화면 녹화 viewport
// 메타용 — settings가 width/height를 안 주면 undefined(호출부에서 현재 탭 폴백 대신 {0,0} 유지).
export function trackViewport(
  stream: MediaStream,
): { width: number; height: number } | undefined {
  const track = stream.getVideoTracks()[0];
  if (!track) return undefined;
  const { width, height } = track.getSettings();
  if (width == null || height == null) return undefined;
  return { width, height };
}
