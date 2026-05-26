import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import type { CapturedFrame } from "./frame-buffer";

const CODEC_CANDIDATES = [
  "avc1.42003D",
  "avc1.64003D",
  "avc1.420033",
  "avc1.640033",
  "avc1.42E01F",
];
const MAX_FRAME_DURATION_MS = 1000;
const DEFAULT_LAST_FRAME_MS = 500;
const KEYFRAME_INTERVAL = 30;
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

function ceilEven(n: number): number {
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

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width, height },
    fastStart: "in-memory",
  });

  // VideoEncoder error는 비동기 콜백으로 와 직접 throw 안 됨 — 변수로 받아 flush 후 throw.
  let encoderError: DOMException | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (meta?.decoderConfig) {
        muxer.addVideoChunk(chunk, {
          ...meta,
          decoderConfig: injectColorSpace(meta.decoderConfig),
        });
      } else {
        muxer.addVideoChunk(chunk, meta);
      }
    },
    error: (e) => {
      encoderError = e;
    },
  });
  encoder.configure({ codec, width, height, bitrate });

  const durationsUs = computeFrameDurationsUs(frames, {
    maxFrameDurationMs: MAX_FRAME_DURATION_MS,
  });

  try {
    let timestampUs = 0;
    for (let i = 0; i < frames.length; i++) {
      if (encoderError) throw encoderError;
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
          encoder.encode(videoFrame, { keyFrame: i % KEYFRAME_INTERVAL === 0 });
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
    await encoder.flush();
    if (encoderError) throw encoderError;
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }

  muxer.finalize();

  const buffer = (muxer.target as ArrayBufferTarget).buffer;
  const blob = new Blob([buffer], { type: "video/mp4" });
  const thumbnail = await makeThumbnail(frames[0].blob, width, height);
  return { blob, thumbnail };
}
