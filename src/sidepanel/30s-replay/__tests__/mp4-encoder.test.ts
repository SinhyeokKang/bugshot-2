import { describe, expect, it, vi } from "vitest";
import {
  computeFrameDurationsUs,
  encodeToMp4,
  injectColorSpace,
  pickCodec,
  pickEvenDimensions,
} from "../mp4-encoder";

const dummyBlob = () => new Blob(["x"], { type: "image/jpeg" });
const frame = (timestamp: number) => ({ blob: dummyBlob(), timestamp });

describe("pickEvenDimensions", () => {
  it("maxWidth 이하 + 이미 짝수면 그대로", () => {
    expect(pickEvenDimensions(1280, 720, 1280)).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it("홀수 width를 짝수로 올림 (1281 → 1282)", () => {
    expect(pickEvenDimensions(1281, 720, 2000)).toEqual({
      width: 1282,
      height: 720,
    });
  });

  it("홀수 height를 짝수로 올림 (721 → 722)", () => {
    expect(pickEvenDimensions(1280, 721, 2000)).toEqual({
      width: 1280,
      height: 722,
    });
  });

  it("maxWidth 초과 시 비율 유지 축소 후 짝수 (1920x1080 → 1280x720)", () => {
    expect(pickEvenDimensions(1920, 1080, 1280)).toEqual({
      width: 1280,
      height: 720,
    });
  });
});

describe("computeFrameDurationsUs", () => {
  it("타임스탬프 차이를 μs로 변환 (500ms → 500000μs)", () => {
    const durations = computeFrameDurationsUs(
      [frame(0), frame(500), frame(1000)],
      { maxFrameDurationMs: 1000 },
    );
    expect(durations).toEqual([500000, 500000, 500000]);
  });

  it("간격이 maxFrameDurationMs 초과 시 cap 값으로 clamp", () => {
    const durations = computeFrameDurationsUs([frame(0), frame(3000)], {
      maxFrameDurationMs: 1000,
    });
    expect(durations).toEqual([1000000, 1000000]);
  });

  it("단일 프레임은 기본값(500ms) duration", () => {
    expect(computeFrameDurationsUs([frame(0)], { maxFrameDurationMs: 1000 })).toEqual([
      500000,
    ]);
  });

  it("빈 배열이면 throw", () => {
    expect(() =>
      computeFrameDurationsUs([], { maxFrameDurationMs: 1000 }),
    ).toThrow();
  });
});

describe("pickCodec", () => {
  it("첫 후보가 지원되면 그것을 반환", async () => {
    const isSupported = vi.fn().mockResolvedValue(true);
    await expect(
      pickCodec(["avc1.42003D", "avc1.640033"], isSupported),
    ).resolves.toBe("avc1.42003D");
    expect(isSupported).toHaveBeenCalledTimes(1);
  });

  it("앞 후보 미지원 시 순차 탐색하여 지원되는 후보 반환", async () => {
    const isSupported = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    await expect(
      pickCodec(["a", "b", "c"], isSupported),
    ).resolves.toBe("c");
    expect(isSupported).toHaveBeenNthCalledWith(1, "a");
    expect(isSupported).toHaveBeenNthCalledWith(2, "b");
    expect(isSupported).toHaveBeenNthCalledWith(3, "c");
  });

  it("전체 후보 미지원이면 throw", async () => {
    const isSupported = vi.fn().mockResolvedValue(false);
    await expect(pickCodec(["a", "b"], isSupported)).rejects.toThrow();
  });
});

describe("encodeToMp4", () => {
  it("빈 프레임 배열이면 throw", async () => {
    await expect(encodeToMp4({ frames: [] })).rejects.toThrow();
  });
});

describe("injectColorSpace", () => {
  const bt709 = {
    primaries: "bt709",
    transfer: "bt709",
    matrix: "bt709",
    fullRange: false,
  };

  it("colorSpace가 null이면 bt709 기본값 주입", () => {
    const result = injectColorSpace({
      codec: "avc",
      colorSpace: null,
    } as unknown as VideoDecoderConfig);
    expect(result.colorSpace).toEqual(bt709);
  });

  it("colorSpace가 undefined여도 bt709 주입", () => {
    const result = injectColorSpace({ codec: "avc" });
    expect(result.colorSpace).toEqual(bt709);
  });

  it("colorSpace가 이미 있으면 보존", () => {
    const existing = {
      primaries: "bt470bg",
      transfer: "smpte170m",
      matrix: "smpte170m",
      fullRange: true,
    } as const;
    const result = injectColorSpace({ codec: "avc", colorSpace: existing });
    expect(result.colorSpace).toEqual(existing);
  });
});
