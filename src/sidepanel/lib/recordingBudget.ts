// Chromium이 확장 메시지에 거는 상한. 넘으면 sendMessage가
// "Message exceeded maximum allowed size of 64MiB."로 거부한다
// (extensions/renderer/api/messaging/messaging_util.cc의 mojom::kMaxMessageBytes).
export const MESSAGE_BYTES_LIMIT = 64 * 1024 * 1024;

const BASE64_EXPANSION = 4 / 3;

/**
 * 녹화 한 건이 제출 시 한 sendBg 요청에 싣게 되는 최악 바이트 수.
 *
 * 영상은 두 번 실린다 — `recording.mp4` 첨부로 한 번(base64, 4/3배), 그리고 그 영상을
 * 통째로 임베드한 `logs.html`이 다시 base64로 한 번(4/3의 제곱 = 16/9배). 합쳐서 **영상
 * 바이트의 28/9 ≈ 3.11배**다(`buildCaptureFiles.ts`가 같은 dataUrl을 양쪽에 쓴다).
 *
 * **영상 축만 센다.** 사용자 첨부(최대 50MB, `attachmentLimits.ts`)와 인라인 이미지는 같은
 * 요청에 더 실리므로 실제 총량은 이보다 크다. 그건 이 함수가 아니라 첨부 한도 쪽에서 봐야 할
 * 기존 축이고, 여기 마진(한도의 80%)은 그 여유를 남겨두려는 것이지 총량을 보장하지 않는다.
 *
 * 비트레이트는 MediaRecorder에 주는 **목표값**이라 실제 출력이 이를 넘을 수도 있다 —
 * "최악"은 보장이 아니라 설계 기준이다(https://www.w3.org/TR/mediastream-recording/).
 */
export function worstCaseSubmitBytes(videoBytes: number): number {
  const videoDataUrl = videoBytes * BASE64_EXPANSION;
  const logsHtmlDataUrl = videoDataUrl * BASE64_EXPANSION;
  return videoDataUrl + logsHtmlDataUrl;
}
