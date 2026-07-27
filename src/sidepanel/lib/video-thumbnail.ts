// video-recorder에서 분리 — apply-trim(로직 스코프·유닛 테스트 대상)이 트림 결과 블롭의 썸네일을
// 만들어야 하는데, video-recorder를 정적 import하면 picker-control·annotation-control까지
// 테스트 그래프에 딸려 온다.
// 극단적으로 짧은 구간(0.1초)까지 트림할 수 있어, seek이 영영 안 끝나면 확정 버튼이 스피너로
// 고착된다(인코딩 중 취소가 없다). 두 단계 모두 시한을 건다.
const LOAD_TIMEOUT_MS = 10_000;

function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} timed out`)), LOAD_TIMEOUT_MS);
    p.then(resolve, reject).finally(() => window.clearTimeout(timer));
  });
}

export async function generateThumbnail(blob: Blob): Promise<string> {
  const url = URL.createObjectURL(blob);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    await withTimeout(
      new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error("video load failed"));
        video.load();
      }),
      "thumbnail load",
    );

    await withTimeout(
      new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve();
        video.onerror = () => reject(new Error("video seek failed"));
        video.currentTime = 0.001;
      }),
      "thumbnail seek",
    );

    const MAX_W = 480;
    const scale = Math.min(1, MAX_W / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", 0.7);
  } finally {
    URL.revokeObjectURL(url);
  }
}
