import { describe, it, expect, vi, beforeEach } from "vitest";
import { REPLAY_LOG_GUARD_MS } from "@/sidepanel/lib/log-merge";
import type { CapturedFrame } from "../frame-buffer";
import type { NetworkLog, NetworkRequest } from "@/types/network";
import type { ConsoleLog } from "@/types/console";
import type { ActionLog } from "@/types/action";

// WebCodecs는 jsdom 미지원 → encodeToMp4만 mock(나머지 순수 함수는 실제).
const encodeToMp4 = vi.fn(async () => ({ blob: new Blob(["v"], { type: "video/mp4" }), thumbnail: "thumb" }));
vi.mock("../mp4-encoder", async (importActual) => {
  const actual = await importActual<typeof import("../mp4-encoder")>();
  return { ...actual, encodeToMp4 };
});

// 구간 재인코딩은 <video>+rVFC+WebCodecs라 jsdom 대상이 아니다 → 경계에서 mock.
const encodeVideoRange = vi.fn(async () => new Blob(["trimmed"], { type: "video/mp4" }));
vi.mock("../encode-range", () => ({ encodeVideoRange }));

const generateThumbnail = vi.fn(async () => "trimmed-thumb");
vi.mock("@/sidepanel/lib/video-thumbnail", () => ({ generateThumbnail }));

const saveNetworkLog = vi.fn(async (_key: string, _log: NetworkLog) => true);
const saveConsoleLog = vi.fn(async (_key: string, _log: unknown) => true);
const saveActionLog = vi.fn(async (_key: string, _log: unknown) => true);
vi.mock("@/store/blob-db", () => ({ saveNetworkLog, saveConsoleLog, saveActionLog }));

vi.mock("@/sidepanel/hooks/usePickerMessages", () => ({
  networkLogPersist: { discard: vi.fn() },
  consoleLogPersist: { discard: vi.fn() },
  actionLogPersist: { discard: vi.fn() },
}));

let storeState: ReturnType<typeof makeState>;
vi.mock("@/store/editor-store", () => ({ useEditorStore: { getState: () => storeState } }));

function makeState(
  networkLog: NetworkLog | null,
  consoleLog: ConsoleLog | null = null,
  actionLog: ActionLog | null = null,
) {
  return {
    networkLog,
    consoleLog,
    actionLog,
    setNetworkLog: vi.fn(),
    setConsoleLog: vi.fn(),
    setActionLog: vi.fn(),
    setLogsAttach: vi.fn(),
    replaceVideo: vi.fn(),
  };
}

function makeRequest(o: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: "1", url: "https://x/a", method: "GET", status: 200, statusText: "OK",
    startTime: 0, durationMs: 0, requestHeaders: {}, responseHeaders: {},
    pageUrl: "", requestBodySize: 0, responseBodySize: 0, contentType: "",
    phase: "complete", ...o,
  };
}

function makeConsoleLog(...ts: number[]): ConsoleLog {
  return {
    id: "c", startedAt: 0, endedAt: 0, totalSeen: ts.length, captured: ts.length,
    entries: ts.map((timestamp, i) => ({ id: `c${i}`, level: "error", timestamp, args: "x", pageUrl: "" })),
  };
}

function makeActionLog(...ts: number[]): ActionLog {
  return {
    id: "a", startedAt: 0, endedAt: 0, totalSeen: ts.length, captured: ts.length,
    entries: ts.map((timestamp, i) => ({ id: `a${i}`, kind: "click", timestamp, pageUrl: "" })),
  };
}

function frames(...ts: number[]): CapturedFrame[] {
  return ts.map((timestamp) => ({ blob: new Blob(), timestamp }));
}

// 5프레임 등간격 600ms.
const FRAMES = frames(10000, 10600, 11200, 11800, 12400);

let applyReplayTrim: typeof import("../apply-trim").applyReplayTrim;
let applyRecordingTrim: typeof import("../apply-trim").applyRecordingTrim;

// 마이크로태스크 수를 세지 않고 "지금까지 진행된 만큼"을 관찰하기 위한 매크로태스크 한 틱.
function tick(ms = 20): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

beforeEach(async () => {
  vi.clearAllMocks();
  storeState = makeState(null);
  ({ applyReplayTrim, applyRecordingTrim } = await import("../apply-trim"));
});

describe("applyReplayTrim — no-op", () => {
  it("전체 구간이면 encodeToMp4·replaceVideo 호출 0회", async () => {
    await applyReplayTrim({ frames: FRAMES, tabId: 1, startSec: 0, endSec: 99 });
    expect(encodeToMp4).toHaveBeenCalledTimes(0);
    expect(storeState.replaceVideo).toHaveBeenCalledTimes(0);
  });

  it("부분 구간이면 encodeToMp4 1회", async () => {
    await applyReplayTrim({ frames: FRAMES, tabId: 1, startSec: 0.6, endSec: 1.2 });
    expect(encodeToMp4).toHaveBeenCalledTimes(1);
  });
});

describe("applyReplayTrim — 타임베이스 분리", () => {
  it("replaceVideo startedAt은 raw sliced[0].ts (guard 미적용)", async () => {
    await applyReplayTrim({ frames: FRAMES, tabId: 1, startSec: 0.6, endSec: 1.2 });
    // sliced = [10600, 11200] → startedAt=10600 (raw, guard 미적용)
    const [, , startedAt] = storeState.replaceVideo.mock.calls[0];
    expect(startedAt).toBe(10600);
  });

  it("앞을 자르면 lower에 guard 미적용 — 경계 직전 로그가 말려들지 않는다", async () => {
    // inIndex=1>0(앞 trim) → lower=sliced[0].ts(10600) 정확히. guard로 10599가 끌려오면 안 됨.
    const reqs = [
      makeRequest({ id: "justBefore", startTime: 10599 }), // 새 시작 직전 — 제외돼야
      makeRequest({ id: "atStart", startTime: 10600 }),
      makeRequest({ id: "inWindow", startTime: 11000 }),
      makeRequest({ id: "atEnd", startTime: 11200 }),
      makeRequest({ id: "afterEnd", startTime: 11201 }), // 마지막 프레임 직후 — 제외돼야
    ];
    storeState = makeState({
      id: "n", startedAt: 0, endedAt: 0, totalSeen: reqs.length, captured: reqs.length,
      warnings: [], requests: reqs,
    });

    await applyReplayTrim({ frames: FRAMES, tabId: 7, startSec: 0.6, endSec: 1.2 });

    const [key, saved] = saveNetworkLog.mock.calls[0];
    expect(key).toBe("pending:7");
    expect(saved.requests.map((r: NetworkRequest) => r.id)).toEqual(["atStart", "inWindow", "atEnd"]);
    expect(saved.captured).toBe(3);
  });

  it("끝만 자르면(inIndex===0) 앞은 guard 유지 + 상한은 정확한 마지막 프레임", async () => {
    // sliced=[10000,10600,11200], inIndex=0 → lower=10000-guard, outIndex=2 → upper=11200(정확).
    const reqs = [
      makeRequest({ id: "tooEarly", startTime: 10000 - REPLAY_LOG_GUARD_MS - 1 }),
      makeRequest({ id: "guardedFront", startTime: 10000 - REPLAY_LOG_GUARD_MS + 1 }),
      makeRequest({ id: "inWindow", startTime: 10600 }),
      makeRequest({ id: "atEnd", startTime: 11200 }),
      makeRequest({ id: "afterEnd", startTime: 11201 }),
    ];
    storeState = makeState({
      id: "n", startedAt: 0, endedAt: 0, totalSeen: reqs.length, captured: reqs.length,
      warnings: [], requests: reqs,
    });

    await applyReplayTrim({ frames: FRAMES, tabId: 1, startSec: 0, endSec: 1.2 });

    const [, saved] = saveNetworkLog.mock.calls[0];
    expect(saved.requests.map((r: NetworkRequest) => r.id)).toEqual(["guardedFront", "inWindow", "atEnd"]);
  });

  it("앞만 자르면(outIndex===last) 상한 없음 — 끝쪽 로그 보존", async () => {
    // inIndex=1>0, outIndex=4(last) → lower=10600, upper=undefined(capture가 captureTime로 이미 제한).
    const reqs = [
      makeRequest({ id: "before", startTime: 10599 }),
      makeRequest({ id: "atStart", startTime: 10600 }),
      makeRequest({ id: "wayAfter", startTime: 999999 }),
    ];
    storeState = makeState({
      id: "n", startedAt: 0, endedAt: 0, totalSeen: reqs.length, captured: reqs.length,
      warnings: [], requests: reqs,
    });

    await applyReplayTrim({ frames: FRAMES, tabId: 1, startSec: 0.6, endSec: 99 });

    const [, saved] = saveNetworkLog.mock.calls[0];
    expect(saved.requests.map((r: NetworkRequest) => r.id)).toEqual(["atStart", "wayAfter"]);
  });

  it("attach 토글 setter는 호출하지 않음", async () => {
    storeState = makeState({
      id: "n", startedAt: 0, endedAt: 0, totalSeen: 0, captured: 0, warnings: [], requests: [],
    });
    await applyReplayTrim({ frames: FRAMES, tabId: 1, startSec: 0.6, endSec: 1.2 });
    expect(storeState.setLogsAttach).not.toHaveBeenCalled();
  });
});

describe("applyReplayTrim — console/action accessor + 빈 결과", () => {
  it("console/action도 timestamp accessor로 동일 경계 trim", async () => {
    // 앞만 자름(inIndex=1>0, outIndex=4=last) → lower=10600, upper=undefined.
    storeState = makeState(
      null,
      makeConsoleLog(10599, 10600, 999999), // 10599 제외, 나머지 보존
      makeActionLog(10599, 10600, 999999),
    );

    await applyReplayTrim({ frames: FRAMES, tabId: 3, startSec: 0.6, endSec: 99 });

    const [ckey, csaved] = saveConsoleLog.mock.calls[0] as [string, ConsoleLog];
    expect(ckey).toBe("pending:3");
    expect(csaved.entries.map((e) => e.id)).toEqual(["c1", "c2"]);
    expect(csaved.captured).toBe(2);

    const [, asaved] = saveActionLog.mock.calls[0] as [string, ActionLog];
    expect(asaved.entries.map((e) => e.id)).toEqual(["a1", "a2"]);
    expect(asaved.captured).toBe(2);
  });

  it("경계 밖이라 전부 제외되면 captured=0 빈 결과로 저장", async () => {
    // lower=10600인데 전부 그 이전 → 0건.
    storeState = makeState(null, makeConsoleLog(10000, 10500));

    await applyReplayTrim({ frames: FRAMES, tabId: 1, startSec: 0.6, endSec: 99 });

    const [, csaved] = saveConsoleLog.mock.calls[0] as [string, ConsoleLog];
    expect(csaved.entries).toEqual([]);
    expect(csaved.captured).toBe(0);
  });
});

// 순서 회귀 가드. 현재 코드는 set*Log ×3 → replaceVideo → await allSettled(saves) 순이고,
// 주석이 "로그 set과 함께 인메모리 상태를 원자적으로 맞춘다"고 못박고 있다.
// trimStoredLogs 추출이 allSettled까지 삼키면 replaceVideo가 IDB 왕복 뒤로 밀려
// "로그는 잘렸는데 영상은 원본"인 상태가 렌더에 노출된다.
describe("applyReplayTrim — 로그 set ↔ replaceVideo 원자성", () => {
  it("replaceVideo가 IDB save resolve 전에 호출된다", async () => {
    let releaseSave!: () => void;
    const gate = new Promise<boolean>((resolve) => {
      releaseSave = () => resolve(true);
    });
    saveNetworkLog.mockReturnValueOnce(gate);

    storeState = makeState({
      id: "n", startedAt: 0, endedAt: 0, totalSeen: 1, captured: 1,
      warnings: [], requests: [makeRequest({ id: "keep", startTime: 11000 })],
    });

    const pending = applyReplayTrim({ frames: FRAMES, tabId: 1, startSec: 0.6, endSec: 1.2 });

    // gate가 아직 열리지 않았으므로 pending은 allSettled에서 멈춰 있다.
    // 그 시점에 replaceVideo는 이미 불렸어야 한다.
    await Promise.race([pending, tick()]);
    expect(saveNetworkLog).toHaveBeenCalledTimes(1);
    expect(storeState.replaceVideo).toHaveBeenCalledTimes(1);

    releaseSave();
    await pending;
  });
});

describe("applyRecordingTrim — 전체 구간 skip", () => {
  const BASE = 10000;

  it("전체 구간이면 encodeVideoRange·replaceVideo 호출 0회", async () => {
    await applyRecordingTrim({
      videoBlob: new Blob(["orig"], { type: "video/mp4" }),
      tabId: 1, startedAt: BASE, startSec: 0, endSec: 10, durationSec: 10, mediaScale: 1,
    });

    expect(encodeVideoRange).toHaveBeenCalledTimes(0);
    expect(generateThumbnail).toHaveBeenCalledTimes(0);
    expect(storeState.replaceVideo).toHaveBeenCalledTimes(0);
    expect(saveNetworkLog).toHaveBeenCalledTimes(0);
  });
});

describe("applyRecordingTrim — 실패 시 원본 유지", () => {
  const BASE = 10000;

  it("encodeVideoRange가 reject하면 replaceVideo 미호출 + reject 전파", async () => {
    encodeVideoRange.mockRejectedValueOnce(new Error("no codec"));

    await expect(
      applyRecordingTrim({
        videoBlob: new Blob(["orig"], { type: "video/mp4" }),
        tabId: 1, startedAt: BASE, startSec: 2, endSec: 8, durationSec: 10, mediaScale: 1,
      }),
    ).rejects.toThrow("no codec");

    expect(storeState.replaceVideo).toHaveBeenCalledTimes(0);
    expect(saveNetworkLog).toHaveBeenCalledTimes(0);
  });
});

describe("applyRecordingTrim — 정상 경로", () => {
  const BASE = 10000;

  it("로그 3종이 벽시계 경계로 좁혀진다", async () => {
    storeState = makeState(
      {
        id: "n", startedAt: 0, endedAt: 0, totalSeen: 4, captured: 4, warnings: [],
        requests: [
          makeRequest({ id: "tooEarly", startTime: 11999 }),
          makeRequest({ id: "atLower", startTime: 12000 }),
          makeRequest({ id: "atUpper", startTime: 18000 }),
          makeRequest({ id: "tooLate", startTime: 18001 }),
        ],
      },
      makeConsoleLog(11999, 12000, 18000, 18001),
      makeActionLog(11999, 12000, 18000, 18001),
    );

    await applyRecordingTrim({
      videoBlob: new Blob(["orig"], { type: "video/mp4" }),
      tabId: 5, startedAt: BASE, startSec: 2, endSec: 8, durationSec: 10, mediaScale: 1,
    });

    const [nkey, nsaved] = saveNetworkLog.mock.calls[0];
    expect(nkey).toBe("pending:5");
    expect(nsaved.requests.map((r: NetworkRequest) => r.id)).toEqual(["atLower", "atUpper"]);
    expect(nsaved.captured).toBe(2);

    const [, csaved] = saveConsoleLog.mock.calls[0] as [string, ConsoleLog];
    expect(csaved.entries.map((e) => e.id)).toEqual(["c1", "c2"]);

    const [, asaved] = saveActionLog.mock.calls[0] as [string, ActionLog];
    expect(asaved.entries.map((e) => e.id)).toEqual(["a1", "a2"]);
  });

  it("replaceVideo가 벽시계 startedAt/endedAt으로 호출된다", async () => {
    await applyRecordingTrim({
      videoBlob: new Blob(["orig"], { type: "video/mp4" }),
      tabId: 1, startedAt: BASE, startSec: 2, endSec: 8, durationSec: 10, mediaScale: 1,
    });

    expect(storeState.replaceVideo).toHaveBeenCalledTimes(1);
    const [blob, thumb, startedAt, endedAt] = storeState.replaceVideo.mock.calls[0];
    expect(await (blob as Blob).text()).toBe("trimmed");
    expect(thumb).toBe("trimmed-thumb");
    expect(startedAt).toBe(BASE + 2000);
    expect(endedAt).toBe(BASE + 8000);
  });

  it("mediaScale이 encodeVideoRange의 미디어 타임 인자에 반영된다", async () => {
    // 미디어 길이가 벽시계의 절반(가변 fps 드리프트) → 벽시계 2~8s는 미디어 1~4s.
    await applyRecordingTrim({
      videoBlob: new Blob(["orig"], { type: "video/mp4" }),
      tabId: 1, startedAt: BASE, startSec: 2, endSec: 8, durationSec: 10, mediaScale: 0.5,
    });

    expect(encodeVideoRange).toHaveBeenCalledTimes(1);
    const [opts] = encodeVideoRange.mock.calls[0] as unknown as [
      { startSec: number; endSec: number },
    ];
    expect(opts.startSec).toBeCloseTo(1);
    expect(opts.endSec).toBeCloseTo(4);
  });

  it("로그 set과 replaceVideo 사이에 IDB 왕복이 끼지 않는다", async () => {
    let releaseSave!: () => void;
    const gate = new Promise<boolean>((resolve) => {
      releaseSave = () => resolve(true);
    });
    saveNetworkLog.mockReturnValueOnce(gate);

    storeState = makeState({
      id: "n", startedAt: 0, endedAt: 0, totalSeen: 1, captured: 1,
      warnings: [], requests: [makeRequest({ id: "keep", startTime: 13000 })],
    });

    const pending = applyRecordingTrim({
      videoBlob: new Blob(["orig"], { type: "video/mp4" }),
      tabId: 1, startedAt: BASE, startSec: 2, endSec: 8, durationSec: 10, mediaScale: 1,
    });

    await Promise.race([pending, tick()]);
    expect(saveNetworkLog).toHaveBeenCalledTimes(1);
    expect(storeState.replaceVideo).toHaveBeenCalledTimes(1);

    releaseSave();
    await pending;
  });
});
