import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import type { CapturedFrame } from "./frame-buffer";

export const CODEC_CANDIDATES = [
  "avc1.42003D",
  "avc1.64003D",
  "avc1.420033",
  "avc1.640033",
  "avc1.42E01F",
];
export const MAX_FRAME_DURATION_MS = 1000;
const DEFAULT_LAST_FRAME_MS = 500;
export const KEYFRAME_INTERVAL = 30;
const YIELD_EVERY = 10;

const BT709 = {
  primaries: "bt709",
  transfer: "bt709",
  matrix: "bt709",
  fullRange: false,
} as const;

export interface EncodeOptions {
  frames: CapturedFrame[];
  maxWidth?: number;
  bitrate?: number;
}

export interface EncodeResult {
  blob: Blob;
  thumbnail: string;
}

export function ceilEven(n: number): number {
  const r = Math.ceil(n);
  return r % 2 === 0 ? r : r + 1;
}

export function pickEvenDimensions(
  w: number,
  h: number,
  maxWidth: number,
): { width: number; height: number } {
  let width = w;
  let height = h;
  if (w > maxWidth) {
    width = maxWidth;
    height = (h * maxWidth) / w;
  }
  return { width: ceilEven(width), height: ceilEven(height) };
}

export function computeFrameDurationsUs(
  frames: CapturedFrame[],
  { maxFrameDurationMs }: { maxFrameDurationMs: number },
): number[] {
  if (frames.length === 0) throw new Error("no frames to encode");
  const capUs = maxFrameDurationMs * 1000;
  const out: number[] = [];
  for (let i = 0; i < frames.length; i++) {
    if (i < frames.length - 1) {
      const deltaMs = frames[i + 1].timestamp - frames[i].timestamp;
      out.push(Math.min(deltaMs * 1000, capUs));
    } else {
      out.push(out.length > 0 ? out[out.length - 1] : DEFAULT_LAST_FRAME_MS * 1000);
    }
  }
  return out;
}

export async function pickCodec(
  candidates: string[],
  isSupported: (codec: string) => Promise<boolean>,
): Promise<string> {
  for (const codec of candidates) {
    if (await isSupported(codec)) return codec;
  }
  throw new Error("no supported H.264 codec found");
}

export function injectColorSpace(
  decoderConfig: VideoDecoderConfig,
): VideoDecoderConfig {
  if (decoderConfig.colorSpace) return decoderConfig;
  return { ...decoderConfig, colorSpace: { ...BT709 } };
}

// avc1은 codec description(SPS/PPS)이 녹화 내내 불변이어야 한다. mp4-muxer는 키프레임마다
// 오는 decoderConfig를 덮어써(Object.assign) 마지막 값을 avcC에 박는데, 인코더가 미세하게
// 다른 description을 내면 앞 샘플이 깨진다("codec description changed"). 첫 decoderConfig만
// 전달하고 이후 키프레임 청크에선 제거해 description을 고정한다.
export function prepareChunkMeta(
  meta: EncodedVideoChunkMetadata | undefined,
  configAlreadySent: boolean,
): { meta: EncodedVideoChunkMetadata | undefined; configSent: boolean } {
  if (!meta?.decoderConfig) return { meta, configSent: configAlreadySent };
  if (configAlreadySent) {
    const { decoderConfig: _omit, ...rest } = meta;
    return { meta: rest, configSent: true };
  }
  return {
    meta: { ...meta, decoderConfig: injectColorSpace(meta.decoderConfig) },
    configSent: true,
  };
}

export interface Mp4Sink {
  encode(frame: VideoFrame, opts: { keyFrame: boolean }): void;
  // 인코더 큐가 밀리면 dequeue까지 기다린다(호출자가 프레임을 동기로 밀어넣는 경로용).
  drain(maxQueued: number): Promise<void>;
  finish(): Promise<Blob>;
  close(): void;
}

// Muxer 생성 + encoderError 래치 + configure + flush/finalize/Blob 배선. encodeToMp4(프레임 배열)와
// encodeVideoRange(재생 기반)가 공유한다. timestamp는 호출자 책임 — mp4-muxer의 firstTimestampBehavior
// 기본값이 'strict'라 첫 청크가 0이 아니면 throw한다.
export function createMp4Sink(opts: {
  width: number;
  height: number;
  codec: string;
  bitrate: number;
}): Mp4Sink {
  const { width, height, codec, bitrate } = opts;
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width, height },
    fastStart: "in-memory",
  });

  // VideoEncoder error는 비동기 콜백으로 와 직접 throw 안 됨 — 변수로 받아 flush 후 throw.
  let encoderError: DOMException | null = null;
  let configSent = false;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const prepared = prepareChunkMeta(meta, configSent);
      configSent = prepared.configSent;
      muxer.addVideoChunk(chunk, prepared.meta);
    },
    error: (e) => {
      encoderError = e;
    },
  });
  encoder.configure({ codec, width, height, bitrate });

  return {
    encode(frame, { keyFrame }) {
      if (encoderError) throw encoderError;
      encoder.encode(frame, { keyFrame });
    },
    async drain(maxQueued) {
      // state 체크가 없으면 close된 인코더는 dequeue를 내지 않아 대기가 영영 안 풀린다.
      while (encoder.state === "configured" && encoder.encodeQueueSize > maxQueued) {
        if (encoderError) throw encoderError;
        await new Promise<void>((resolve) => {
          encoder.addEventListener("dequeue", () => resolve(), { once: true });
        });
      }
    },
    async finish() {
      await encoder.flush();
      if (encoderError) throw encoderError;
      muxer.finalize();
      return new Blob([(muxer.target as ArrayBufferTarget).buffer], { type: "video/mp4" });
    },
    close() {
      if (encoder.state !== "closed") encoder.close();
    },
  };
}

async function makeThumbnail(blob: Blob, width: number, height: number): Promise<string> {
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return "";
  }
}

export async function encodeToMp4(options: EncodeOptions): Promise<EncodeResult> {
  const { frames } = options;
  if (frames.length === 0) throw new Error("no frames to encode");
  const maxWidth = options.maxWidth ?? 1280;
  const bitrate = options.bitrate ?? 2_000_000;

  const firstBitmap = await createImageBitmap(frames[0].blob);
  const { width, height } = pickEvenDimensions(
    firstBitmap.width,
    firstBitmap.height,
    maxWidth,
  );
  firstBitmap.close();

  const codec = await pickCodec(CODEC_CANDIDATES, async (c) => {
    const support = await VideoEncoder.isConfigSupported({
      codec: c,
      width,
      height,
      bitrate,
    });
    return support.supported === true;
  });

  const sink = createMp4Sink({ width, height, codec, bitrate });

  const durationsUs = computeFrameDurationsUs(frames, {
    maxFrameDurationMs: MAX_FRAME_DURATION_MS,
  });

  let blob: Blob;
  try {
    let timestampUs = 0;
    for (let i = 0; i < frames.length; i++) {
      const bitmap = await createImageBitmap(frames[i].blob, {
        resizeWidth: width,
        resizeHeight: height,
      });
      try {
        const videoFrame = new VideoFrame(bitmap, {
          timestamp: timestampUs,
          duration: durationsUs[i],
        });
        try {
          sink.encode(videoFrame, { keyFrame: i % KEYFRAME_INTERVAL === 0 });
        } finally {
          videoFrame.close();
        }
      } finally {
        bitmap.close();
      }
      timestampUs += durationsUs[i];
      if (i % YIELD_EVERY === YIELD_EVERY - 1) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    blob = await sink.finish();
  } finally {
    sink.close();
  }

  const thumbnail = await makeThumbnail(frames[0].blob, width, height);
  return { blob, thumbnail };
}
