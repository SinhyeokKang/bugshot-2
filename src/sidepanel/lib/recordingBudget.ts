// Chromium이 확장 메시지에 거는 상한. 넘으면 sendMessage가
// "Message exceeded maximum allowed size of 64MiB."로 거부한다
// (extensions/renderer/api/messaging/messaging_util.cc의 mojom::kMaxMessageBytes).
export const MESSAGE_BYTES_LIMIT = 64 * 1024 * 1024;

const BASE64_EXPANSION = 4 / 3;

/**
 * 녹화 한 건이 제출 시 한 sendBg 요청에 싣게 되는 최악 바이트 수.
 *
 * 영상은 두 번 실린다 — `recording.mp4` 첨부로 한 번(base64), 그리고 그 영상을 통째로
 * 임베드한 `logs.html`이 다시 base64로 한 번(`buildCaptureFiles.ts`가 같은 dataUrl을
 * 양쪽에 쓴다). 그래서 전송량은 영상 바이트의 약 2.33배다.
 */
export function worstCaseSubmitBytes(videoBytes: number): number {
  const videoDataUrl = videoBytes * BASE64_EXPANSION;
  const logsHtmlDataUrl = videoDataUrl * BASE64_EXPANSION;
  return videoDataUrl + logsHtmlDataUrl;
}
