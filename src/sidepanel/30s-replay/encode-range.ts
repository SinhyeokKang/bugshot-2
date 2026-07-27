import {
  CODEC_CANDIDATES,
  KEYFRAME_INTERVAL,
  ceilEven,
  createMp4Sink,
  pickCodec,
} from "./mp4-encoder";

// 인코더 큐 상한 — rVFC 콜백에서 동기로 밀어넣는 구조라 하드웨어 인코더가 없으면
// 큐와 VideoFrame 메모리가 선형 증가한다. 이 선을 넘으면 dequeue까지 기다린다.
const MAX_ENCODE_QUEUE = 8;
const DEFAULT_PLAYBACK_RATE = 4;
const DEFAULT_STALL_TIMEOUT_MS = 3000;
const DEFAULT_METADATA_TIMEOUT_MS = 10_000;
const WATCHDOG_TICK_MS = 250;
// 마지막 프레임엔 다음 mediaTime이 없다 — 직전 duration을 재사용하고, 그것도 없으면 이 값.
const FALLBACK_LAST_FRAME_US = 100_000;

export interface EncodeRangeOptions {
  blob: Blob;
  // 미디어 타임(초). 호출자가 벽시계 → 미디어 환산(mediaScale)을 마친 값을 넘긴다.
  startSec: number;
  endSec: number;
  bitrate: number;
  playbackRate?: number;
  stallTimeoutMs?: number;
  metadataTimeoutMs?: number;
  onProgress?: (ratio: number) => void;
}

function onceEvent(
  el: HTMLVideoElement,
  event: string,
  timeoutMs: number,
  label: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`${label} timed out`));
    }, timeoutMs);
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error(`${label} failed`));
    };
    function cleanup() {
      window.clearTimeout(timer);
      el.removeEventListener(event, onOk);
      el.removeEventListener("error", onErr);
    }
    el.addEventListener(event, onOk, { once: true });
    el.addEventListener("error", onErr, { once: true });
  });
}

// MediaRecorder 블롭의 [startSec, endSec] 미디어 타임 구간을 재생 기반으로 재인코딩해 mp4로 반환.
// 해상도·프레임레이트는 원본 유지(다운스케일 없음). 실패 시 throw — 호출자가 원본을 유지한다.
export async function encodeVideoRange(opts: EncodeRangeOptions): Promise<Blob> {
  const {
    blob,
    startSec,
    endSec,
    bitrate,
    playbackRate = DEFAULT_PLAYBACK_RATE,
    stallTimeoutMs = DEFAULT_STALL_TIMEOUT_MS,
    metadataTimeoutMs = DEFAULT_METADATA_TIMEOUT_MS,
    onProgress,
  } = opts;

  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;

  let sink: ReturnType<typeof createMp4Sink> | null = null;
  // ref 컨테이너: rVFC 콜백에서 대입하므로 지역 let이면 TS가 클로저 대입을 못 보고 null로 좁힌다.
  // 1프레임 lookahead — 다음 콜백의 mediaTime을 알아야 이번 프레임의 duration이 정해진다.
  const held: { current: { frame: VideoFrame; mediaTime: number } | null } = { current: null };
  // 0-base 기준점은 startSec이 아니라 **실제로 인코딩한 첫 프레임**이다. seek이 표시한 프레임을
  // 놓치면 첫 mediaTime이 startSec보다 커지는데, 그때 startSec 기준으로 빼면 timestamp가 0이 아니라
  // mp4-muxer의 strict 모드가 throw한다(firstTimestampBehavior 기본값).
  const base: { current: number | null } = { current: null };

  try {
    await onceEvent(video, "loadedmetadata", metadataTimeoutMs, "loadedmetadata");

    const width = ceilEven(video.videoWidth);
    const height = ceilEven(video.videoHeight);
    if (width <= 0 || height <= 0) throw new Error("video has no dimensions");

    // 이미 그 지점이면 seek을 걸지 않는다 — currentTime을 같은 값으로 쓰면 seeked가 안 오는
    // 브라우저가 있어 타임아웃으로 죽는다(뒤쪽만 자르는 startSec===0이 가장 흔한 경우).
    if (Math.abs(video.currentTime - startSec) > 1e-3) {
      const seeked = onceEvent(video, "seeked", metadataTimeoutMs, "seek");
      video.currentTime = startSec;
      await seeked;
    }

    const codec = await pickCodec(CODEC_CANDIDATES, async (c) => {
      const support = await VideoEncoder.isConfigSupported({ codec: c, width, height, bitrate });
      return support.supported === true;
    });
    sink = createMp4Sink({ width, height, codec, bitrate });

    const span = Math.max(endSec - startSec, 1e-6);
    let encoded = 0;
    let lastDurationUs = 0;

    // 프레임 크기가 인코더 config와 다르면(녹화 중 창 리사이즈·모니터 전환) VideoEncoder가
    // config 크기로 스케일한다 — visibleRect를 손대면 오히려 소스의 크롭 정보를 덮어써
    // coded 패딩까지 인코딩에 말려든다. timestamp/duration만 갈아끼운 클론을 넘긴다.
    const emit = (frame: VideoFrame, mediaTime: number, durationUs: number) => {
      if (base.current === null) base.current = mediaTime;
      const timestampUs = Math.max(0, Math.round((mediaTime - base.current) * 1_000_000));
      const shaped = new VideoFrame(frame, { timestamp: timestampUs, duration: durationUs });
      try {
        sink!.encode(shaped, { keyFrame: encoded % KEYFRAME_INTERVAL === 0 });
      } finally {
        shaped.close();
      }
      encoded++;
      lastDurationUs = durationUs;
    };

    await new Promise<void>((resolve, reject) => {
      let finished = false;
      let handle = 0;
      let lastTime = -1;
      let lastAdvance = Date.now();

      // 프레임 도착이 아니라 **재생 진행**을 감시한다. MediaRecorder는 damage 기반 가변 fps라
      // 정지 화면 구간엔 프레임이 몇 초씩 안 오는데(4배속이면 벽시계로도 길다), 그건 정체가
      // 아니다. drain()이 큐를 기다리는 동안에도 currentTime은 계속 흐른다.
      const watchdog = window.setInterval(() => {
        if (finished) return;
        if (document.hidden || video.paused) {
          lastAdvance = Date.now();
          return;
        }
        if (video.currentTime !== lastTime) {
          lastTime = video.currentTime;
          lastAdvance = Date.now();
          return;
        }
        if (Date.now() - lastAdvance > stallTimeoutMs) fail(new Error("playback stalled"));
      }, WATCHDOG_TICK_MS);

      // hidden이면 rVFC가 멈추는데 <video>는 계속 재생된다 — 그대로 두면 구간을 통째로
      // 건너뛴 채 ended가 오거나(짧은 결과물이 성공으로 반환) 복귀 시 프레임 하나가 수십 초
      // duration을 뒤집어쓴다. 재생 자체를 묶어 복귀 시 이어가게 한다.
      const onVisibility = () => {
        if (finished) return;
        if (document.hidden) {
          video.pause();
        } else {
          lastAdvance = Date.now();
          void video.play().catch(() => {});
        }
      };

      const teardown = () => {
        finished = true;
        window.clearInterval(watchdog);
        document.removeEventListener("visibilitychange", onVisibility);
        if (handle) video.cancelVideoFrameCallback(handle);
        video.pause();
      };

      const done = () => {
        if (finished) return;
        teardown();
        resolve();
      };

      function fail(err: Error) {
        if (finished) return;
        teardown();
        reject(err);
      }

      const onFrame: VideoFrameRequestCallback = (_now, meta) => {
        if (finished) return;
        const mediaTime = meta.mediaTime;

        const prev = held.current;
        if (prev) {
          if (mediaTime > prev.mediaTime) {
            // 델타에 상한을 두지 않는다 — MediaRecorder는 damage 기반이라 정지 화면 구간의
            // 긴 프레임 간격이 정상이고, 그걸 자르면 결과 영상이 선택 구간보다 짧아진다.
            // hidden 중 폭주는 visibilitychange pause가 원인 단계에서 막는다.
            const durationUs = Math.max(1, Math.round((mediaTime - prev.mediaTime) * 1_000_000));
            try {
              emit(prev.frame, prev.mediaTime, durationUs);
            } catch (e) {
              prev.frame.close();
              held.current = null;
              fail(e instanceof Error ? e : new Error(String(e)));
              return;
            }
          }
          // 같은/역행 mediaTime이면 emit하지 않지만 프레임은 반드시 닫는다 — 안 닫고 아래에서
          // held.current를 덮으면 그 프레임을 close할 경로가 사라진다(1080p면 장당 수 MB).
          prev.frame.close();
          held.current = null;
        }

        if (mediaTime > endSec) {
          done();
          return;
        }

        onProgress?.(Math.min(1, Math.max(0, (mediaTime - startSec) / span)));

        try {
          held.current = { frame: new VideoFrame(video), mediaTime };
        } catch (e) {
          fail(e instanceof Error ? e : new Error(String(e)));
          return;
        }

        void sink!
          .drain(MAX_ENCODE_QUEUE)
          .then(() => {
            if (!finished) handle = video.requestVideoFrameCallback(onFrame);
          })
          .catch((e) => fail(e instanceof Error ? e : new Error(String(e))));
      };

      video.addEventListener("ended", done, { once: true });
      video.addEventListener("error", () => fail(new Error("video playback failed")), { once: true });
      document.addEventListener("visibilitychange", onVisibility);

      video.playbackRate = playbackRate;
      handle = video.requestVideoFrameCallback(onFrame);
      video.play().catch((e) => fail(e instanceof Error ? e : new Error(String(e))));
    });

    // 마지막 보류 프레임은 다음 mediaTime이 없으므로 직전 duration을 재사용한다.
    const tail = held.current;
    if (tail) {
      emit(tail.frame, tail.mediaTime, lastDurationUs || FALLBACK_LAST_FRAME_US);
      tail.frame.close();
      held.current = null;
    }

    if (encoded === 0) throw new Error("no frames in selected range");

    onProgress?.(1);
    return await sink.finish();
  } finally {
    // lookahead라 abort·throw 어느 경로로 나가도 보류 프레임 1개가 남을 수 있다.
    held.current?.frame.close();
    sink?.close();
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
