import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeFrameDurationsUs,
  createMp4Sink,
  encodeToMp4,
  injectColorSpace,
  pickCodec,
  pickEvenDimensions,
  prepareChunkMeta,
} from "../mp4-encoder";

// mp4-muxer는 ArrayBuffer를 직접 만지는 네이티브 배선이라 스텁으로 갈음한다. 생성된 인스턴스를
// 배열에 모아 두면 각 테스트가 addVideoChunk·finalize 호출을 그대로 들여다볼 수 있다.
const muxerCalls: {
  addVideoChunk: ReturnType<typeof vi.fn>;
  finalize: ReturnType<typeof vi.fn>;
}[] = [];

vi.mock("mp4-muxer", () => ({
  ArrayBufferTarget: class {
    buffer = new ArrayBuffer(8);
  },
  Muxer: class {
    addVideoChunk = vi.fn();
    finalize = vi.fn();
    target = { buffer: new ArrayBuffer(8) };
    constructor() {
      muxerCalls.push({
        addVideoChunk: this.addVideoChunk,
        finalize: this.finalize,
      });
    }
  },
}));

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

describe("prepareChunkMeta", () => {
  const decoderConfig = { codec: "avc1.42003D", description: new Uint8Array([1, 2, 3]) };

  it("첫 decoderConfig는 colorSpace 주입 후 전달하고 configSent=true", () => {
    const { meta, configSent } = prepareChunkMeta({ decoderConfig }, false);
    expect(configSent).toBe(true);
    expect(meta?.decoderConfig?.description).toBe(decoderConfig.description);
    expect(meta?.decoderConfig?.colorSpace).toEqual({
      primaries: "bt709",
      transfer: "bt709",
      matrix: "bt709",
      fullRange: false,
    });
  });

  it("이미 전달된 뒤 오는 키프레임 decoderConfig는 제거 (description 고정)", () => {
    const { meta, configSent } = prepareChunkMeta({ decoderConfig }, true);
    expect(configSent).toBe(true);
    expect(meta).not.toHaveProperty("decoderConfig");
  });

  it("decoderConfig 없는 delta 청크는 그대로 통과, configSent 보존", () => {
    expect(prepareChunkMeta({}, true)).toEqual({ meta: {}, configSent: true });
    expect(prepareChunkMeta({}, false)).toEqual({ meta: {}, configSent: false });
  });

  it("meta 자체가 undefined여도 안전", () => {
    expect(prepareChunkMeta(undefined, false)).toEqual({ meta: undefined, configSent: false });
    expect(prepareChunkMeta(undefined, true)).toEqual({ meta: undefined, configSent: true });
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


// createMp4Sink는 VideoEncoder·Muxer 배선이라 그동안 유닛 밖에 있었는데, 그 안에 실제 판정이
// 셋 있다: 비동기로 도착하는 encoder error를 래치했다가 던지는 시점, close된 인코더에서
// drain이 영영 안 풀리는 걸 막는 state 가드, 그리고 첫 청크에만 decoderConfig를 싣는 배선.
// 셋 다 깨지면 조용히 잘못된 mp4가 이슈에 첨부되는 자리라 스텁으로 고정한다.
describe("createMp4Sink", () => {
  type EncoderInit = {
    output: (chunk: unknown, meta: unknown) => void;
    error: (e: unknown) => void;
  };

  function setup() {
    const init: { current?: EncoderInit } = {};
    const encoder = {
      state: "configured" as string,
      encodeQueueSize: 0,
      configure: vi.fn(),
      encode: vi.fn(),
      flush: vi.fn(async () => {}),
      close: vi.fn(() => {
        encoder.state = "closed";
      }),
      addEventListener: vi.fn(),
    };
    (globalThis as { VideoEncoder?: unknown }).VideoEncoder = vi.fn(
      (arg: EncoderInit) => {
        init.current = arg;
        return encoder;
      },
    );
    muxerCalls.length = 0;
    return { init, encoder };
  }

  afterEach(() => {
    delete (globalThis as { VideoEncoder?: unknown }).VideoEncoder;
  });

  const makeSink = () =>
    createMp4Sink({
      width: 640,
      height: 480,
      codec: "avc1.42003D",
      bitrate: 1_000_000,
    });

  it("encode는 래치된 encoder error를 다음 호출에서 던진다", () => {
    const { init, encoder } = setup();
    const sink = makeSink();
    const boom = new Error("encoder died");
    init.current!.error(boom);
    expect(() => sink.encode({} as VideoFrame, { keyFrame: true })).toThrow(boom);
    expect(encoder.encode).not.toHaveBeenCalled();
  });

  it("finish는 flush 도중 도착한 에러를 던지고 finalize하지 않는다", async () => {
    const { init, encoder } = setup();
    const sink = makeSink();
    encoder.flush.mockImplementation(async () => {
      // 에러는 flush가 도는 동안 비동기 콜백으로 도착한다.
      init.current!.error(new Error("late failure"));
    });
    await expect(sink.finish()).rejects.toThrow("late failure");
    // finalize까지 갔으면 잘린 Blob이 그대로 이슈에 첨부된다.
    expect(muxerCalls[0].finalize).not.toHaveBeenCalled();
  });

  it("정상 경로의 finish는 finalize 후 video/mp4 Blob을 돌려준다", async () => {
    setup();
    const sink = makeSink();
    const blob = await sink.finish();
    expect(blob.type).toBe("video/mp4");
    expect(muxerCalls[0].finalize).toHaveBeenCalled();
  });

  it("output 콜백은 첫 청크에만 decoderConfig를 싣는다", () => {
    const { init } = setup();
    makeSink();
    const meta = { decoderConfig: { codec: "avc1.42003D" } };
    init.current!.output({ n: 1 }, meta);
    init.current!.output({ n: 2 }, meta);
    const addVideoChunk = muxerCalls[0].addVideoChunk;
    expect(addVideoChunk.mock.calls[0][1].decoderConfig).toBeTruthy();
    expect(addVideoChunk.mock.calls[1][1].decoderConfig).toBeUndefined();
  });

  it("drain은 인코더가 close된 뒤에는 대기하지 않는다", async () => {
    const { encoder } = setup();
    const sink = makeSink();
    // 큐가 한도를 넘긴 채 close된 상황 — state 가드가 없으면 dequeue가 안 와서 영영 멈춘다.
    encoder.encodeQueueSize = 99;
    encoder.state = "closed";
    await expect(sink.drain(2)).resolves.toBeUndefined();
    expect(encoder.addEventListener).not.toHaveBeenCalled();
  });

  it("close는 이미 닫힌 인코더를 다시 닫지 않는다", () => {
    const { encoder } = setup();
    const sink = makeSink();
    sink.close();
    sink.close();
    expect(encoder.close).toHaveBeenCalledTimes(1);
  });
});
