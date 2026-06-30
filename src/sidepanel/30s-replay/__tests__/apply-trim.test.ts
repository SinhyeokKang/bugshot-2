import { describe, it, expect, vi, beforeEach } from "vitest";
import { REPLAY_LOG_GUARD_MS } from "@/sidepanel/lib/log-merge";
import type { CapturedFrame } from "../frame-buffer";
import type { NetworkLog, NetworkRequest } from "@/types/network";

// WebCodecs는 jsdom 미지원 → encodeToMp4만 mock(나머지 순수 함수는 실제).
const encodeToMp4 = vi.fn(async () => ({ blob: new Blob(["v"], { type: "video/mp4" }), thumbnail: "thumb" }));
vi.mock("../mp4-encoder", async (importActual) => {
  const actual = await importActual<typeof import("../mp4-encoder")>();
  return { ...actual, encodeToMp4 };
});

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

function makeState(networkLog: NetworkLog | null) {
  return {
    networkLog,
    consoleLog: null,
    actionLog: null,
    setNetworkLog: vi.fn(),
    setConsoleLog: vi.fn(),
    setActionLog: vi.fn(),
    setNetworkLogAttach: vi.fn(),
    setConsoleLogAttach: vi.fn(),
    setActionLogAttach: vi.fn(),
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

function frames(...ts: number[]): CapturedFrame[] {
  return ts.map((timestamp) => ({ blob: new Blob(), timestamp }));
}

// 5프레임 등간격 600ms.
const FRAMES = frames(10000, 10600, 11200, 11800, 12400);

let applyReplayTrim: typeof import("../apply-trim").applyReplayTrim;

beforeEach(async () => {
  vi.clearAllMocks();
  storeState = makeState(null);
  ({ applyReplayTrim } = await import("../apply-trim"));
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
    expect(storeState.setNetworkLogAttach).not.toHaveBeenCalled();
    expect(storeState.setConsoleLogAttach).not.toHaveBeenCalled();
    expect(storeState.setActionLogAttach).not.toHaveBeenCalled();
  });
});
