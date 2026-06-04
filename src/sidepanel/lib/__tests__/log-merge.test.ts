import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mergeLogItems,
  trimByTime,
  replayLogBounds,
  REPLAY_LOG_GUARD_MS,
  rebuildNetworkLog,
  rebuildConsoleLog,
  rebuildActionLog,
  isLogFrozen,
  NETWORK_MAX_ENTRIES,
  CONSOLE_MAX_ENTRIES,
} from "../log-merge";
import type { EditorPhase } from "@/store/editor-store";
import type { NetworkLog, NetworkRequest } from "@/types/network";
import type { ConsoleLog, ConsoleEntry } from "@/types/console";
import type { ActionLog, ActionEntry } from "@/types/action";

// rebuild*는 incoming 메타(totalSeen/warnings)를 받는 3-arg 시그니처 — design.md의 2-arg 표기와 다름.

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: "1",
    url: "https://example.com/api",
    method: "GET",
    status: 200,
    statusText: "OK",
    startTime: 0,
    durationMs: 50,
    requestHeaders: {},
    responseHeaders: {},
    pageUrl: "",
    requestBodySize: 0,
    responseBodySize: 0,
    contentType: "",
    phase: "complete",
    ...overrides,
  };
}

function makeNetworkLog(overrides: Partial<NetworkLog> = {}): NetworkLog {
  return {
    id: "net-1",
    startedAt: 0,
    endedAt: 1000,
    totalSeen: 0,
    captured: 0,
    warnings: [],
    requests: [],
    ...overrides,
  };
}

function makeEntry(overrides: Partial<ConsoleEntry> = {}): ConsoleEntry {
  return {
    id: "1",
    level: "log",
    timestamp: 0,
    args: "",
    pageUrl: "",
    ...overrides,
  };
}

function makeConsoleLog(overrides: Partial<ConsoleLog> = {}): ConsoleLog {
  return {
    id: "con-1",
    startedAt: 0,
    endedAt: 1000,
    totalSeen: 0,
    captured: 0,
    entries: [],
    ...overrides,
  };
}

function makeActionEntry(overrides: Partial<ActionEntry> = {}): ActionEntry {
  return {
    id: "1",
    kind: "click",
    timestamp: 0,
    pageUrl: "",
    ...overrides,
  };
}

function makeActionLog(overrides: Partial<ActionLog> = {}): ActionLog {
  return {
    id: "act-1",
    startedAt: 0,
    endedAt: 1000,
    totalSeen: 0,
    captured: 0,
    entries: [],
    ...overrides,
  };
}

const reqTime = (r: NetworkRequest) => r.startTime;

describe("mergeLogItems", () => {
  it("기존 + 신규 엔트리 모두 보존하고 시간순 정렬", () => {
    const existing = [makeRequest({ id: "b", startTime: 5 })];
    const incoming = [makeRequest({ id: "a", startTime: 1 })];

    const merged = mergeLogItems(existing, incoming, reqTime, NETWORK_MAX_ENTRIES);

    expect(merged.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("같은 id 재수신 시 incoming이 덮어쓰고 개수 안 늘어남 (pending→complete)", () => {
    const existing = [makeRequest({ id: "x", startTime: 1, phase: "pending", status: 0 })];
    const incoming = [makeRequest({ id: "x", startTime: 1, phase: "complete", status: 200 })];

    const merged = mergeLogItems(existing, incoming, reqTime, NETWORK_MAX_ENTRIES);

    expect(merged).toHaveLength(1);
    expect(merged[0].phase).toBe("complete");
    expect(merged[0].status).toBe(200);
  });

  it("cap 초과 시 oldest부터 제거", () => {
    const existing = [
      makeRequest({ id: "a", startTime: 1 }),
      makeRequest({ id: "b", startTime: 2 }),
    ];
    const incoming = [
      makeRequest({ id: "c", startTime: 3 }),
      makeRequest({ id: "d", startTime: 4 }),
    ];

    const merged = mergeLogItems(existing, incoming, reqTime, 3);

    expect(merged.map((r) => r.id)).toEqual(["b", "c", "d"]);
  });

  it("cap에 정확히 닿을 때는 evict 안 함", () => {
    const existing = [
      makeRequest({ id: "a", startTime: 1 }),
      makeRequest({ id: "b", startTime: 2 }),
    ];
    const incoming = [makeRequest({ id: "c", startTime: 3 })];

    const merged = mergeLogItems(existing, incoming, reqTime, 3);

    expect(merged.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("같은 timestamp는 dedup 후에도 순서 보존 (정렬 안정성)", () => {
    const existing = [
      makeRequest({ id: "a", startTime: 1 }),
      makeRequest({ id: "b", startTime: 1 }),
    ];
    const incoming = [makeRequest({ id: "a", startTime: 1, status: 500 })];

    const merged = mergeLogItems(existing, incoming, reqTime, NETWORK_MAX_ENTRIES);

    expect(merged.map((r) => r.id)).toEqual(["a", "b"]);
    expect(merged[0].status).toBe(500);
  });

  it("빈 입력 양쪽이면 빈 배열", () => {
    expect(mergeLogItems<NetworkRequest>([], [], reqTime, NETWORK_MAX_ENTRIES)).toEqual([]);
  });
});

describe("trimByTime", () => {
  const items = [
    makeRequest({ id: "1", startTime: 1 }),
    makeRequest({ id: "2", startTime: 2 }),
    makeRequest({ id: "3", startTime: 3 }),
    makeRequest({ id: "4", startTime: 4 }),
    makeRequest({ id: "5", startTime: 5 }),
  ];

  it("하한·상한 양쪽 경계 포함 필터", () => {
    const trimmed = trimByTime(items, reqTime, 2, 4);
    expect(trimmed.map((r) => r.id)).toEqual(["2", "3", "4"]);
  });

  it("upper 생략 시 하한만 적용", () => {
    const trimmed = trimByTime(items, reqTime, 3);
    expect(trimmed.map((r) => r.id)).toEqual(["3", "4", "5"]);
  });

  it("전부 범위 밖이면 빈 배열", () => {
    expect(trimByTime(items, reqTime, 10, 20)).toEqual([]);
  });

  it("빈 입력이면 빈 배열", () => {
    expect(trimByTime<NetworkRequest>([], reqTime, 0, 100)).toEqual([]);
  });
});

describe("replayLogBounds", () => {
  it("하한은 첫 프레임 시각에서 가드밴드만큼 당기고 상한은 캡처 시각", () => {
    const { lower, upper } = replayLogBounds(10000, 15000);
    expect(lower).toBe(10000 - REPLAY_LOG_GUARD_MS);
    expect(upper).toBe(15000);
  });

  it("첫 프레임 직전 가드밴드 구간 로그는 보존, 그 이전은 제외", () => {
    const firstFrame = 10000;
    const items = [
      makeRequest({ id: "tooEarly", startTime: firstFrame - REPLAY_LOG_GUARD_MS - 1 }),
      makeRequest({ id: "guarded", startTime: firstFrame - REPLAY_LOG_GUARD_MS + 1 }),
      makeRequest({ id: "inWindow", startTime: firstFrame + 500 }),
      makeRequest({ id: "afterCapture", startTime: firstFrame + 6000 }),
    ];
    const { lower, upper } = replayLogBounds(firstFrame, firstFrame + 5000);
    const trimmed = trimByTime(items, reqTime, lower, upper);
    expect(trimmed.map((r) => r.id)).toEqual(["guarded", "inWindow"]);
  });
});

describe("rebuildNetworkLog", () => {
  const NOW = 10_000;
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("머지 배열로 메타 재계산 (startedAt=첫 엔트리, endedAt=now, captured=길이)", () => {
    const existing = makeNetworkLog({ totalSeen: 1, warnings: [] });
    const merged = [
      makeRequest({ id: "a", startTime: 100 }),
      makeRequest({ id: "b", startTime: 300 }),
    ];

    const log = rebuildNetworkLog(existing, merged, { totalSeen: 2, warnings: [] });

    expect(log.startedAt).toBe(100);
    expect(log.endedAt).toBe(NOW);
    expect(log.captured).toBe(2);
    expect(log.requests).toBe(merged);
  });

  it("totalSeen은 기존·incoming·머지 길이 중 최댓값", () => {
    const existing = makeNetworkLog({ totalSeen: 7 });
    const merged = [makeRequest({ id: "a", startTime: 1 })];

    const log = rebuildNetworkLog(existing, merged, { totalSeen: 3, warnings: [] });

    expect(log.totalSeen).toBe(7);
  });

  it("warnings는 기존과 incoming의 union (중복 제거)", () => {
    const existing = makeNetworkLog({ warnings: ["MEMORY_CAPPED"] });
    const merged: NetworkRequest[] = [];

    const log = rebuildNetworkLog(existing, merged, {
      totalSeen: 0,
      warnings: ["MEMORY_CAPPED", "BODY_TRUNCATED"],
    });

    expect([...log.warnings].sort()).toEqual(["BODY_TRUNCATED", "MEMORY_CAPPED"]);
  });

  it("captured ≤ totalSeen 불변", () => {
    const merged = [
      makeRequest({ id: "a", startTime: 1 }),
      makeRequest({ id: "b", startTime: 2 }),
      makeRequest({ id: "c", startTime: 3 }),
    ];

    const log = rebuildNetworkLog(null, merged, { totalSeen: 0, warnings: [] });

    expect(log.captured).toBe(3);
    expect(log.totalSeen).toBeGreaterThanOrEqual(log.captured);
  });

  it("빈 incoming + existing null이면 captured 0", () => {
    const log = rebuildNetworkLog(null, [], { totalSeen: 0, warnings: [] });
    expect(log.captured).toBe(0);
    expect(log.totalSeen).toBe(0);
  });
});

describe("rebuildConsoleLog", () => {
  const NOW = 20_000;
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("머지 배열로 메타 재계산", () => {
    const existing = makeConsoleLog({ totalSeen: 1 });
    const merged = [
      makeEntry({ id: "a", timestamp: 200 }),
      makeEntry({ id: "b", timestamp: 500 }),
    ];

    const log = rebuildConsoleLog(existing, merged, { totalSeen: 2 });

    expect(log.startedAt).toBe(200);
    expect(log.endedAt).toBe(NOW);
    expect(log.captured).toBe(2);
    expect(log.entries).toBe(merged);
  });

  it("totalSeen은 기존·incoming·머지 길이 중 최댓값", () => {
    const log = rebuildConsoleLog(null, [makeEntry({ id: "a", timestamp: 1 })], { totalSeen: 9 });
    expect(log.totalSeen).toBe(9);
  });

  it("빈 incoming이면 captured 0, captured ≤ totalSeen", () => {
    const log = rebuildConsoleLog(null, [], { totalSeen: 0 });
    expect(log.captured).toBe(0);
    expect(log.totalSeen).toBeGreaterThanOrEqual(log.captured);
  });
});

describe("rebuildActionLog", () => {
  const NOW = 30_000;
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("머지 배열로 메타 재계산 (startedAt=첫 엔트리, endedAt=now, captured=길이)", () => {
    const existing = makeActionLog({ totalSeen: 1 });
    const merged = [
      makeActionEntry({ id: "a", timestamp: 300 }),
      makeActionEntry({ id: "b", timestamp: 700 }),
    ];

    const log = rebuildActionLog(existing, merged, { totalSeen: 2 });

    expect(log.startedAt).toBe(300);
    expect(log.endedAt).toBe(NOW);
    expect(log.captured).toBe(2);
    expect(log.entries).toBe(merged);
  });

  it("totalSeen은 기존·incoming·머지 길이 중 최댓값", () => {
    const log = rebuildActionLog(null, [makeActionEntry({ id: "a", timestamp: 1 })], { totalSeen: 9 });
    expect(log.totalSeen).toBe(9);
  });

  it("빈 incoming이면 captured 0, startedAt=now, captured ≤ totalSeen", () => {
    const log = rebuildActionLog(null, [], { totalSeen: 0 });
    expect(log.captured).toBe(0);
    expect(log.startedAt).toBe(NOW);
    expect(log.totalSeen).toBeGreaterThanOrEqual(log.captured);
  });

  it("기존 id 유지 (재빌드해도 새 id 안 만듦)", () => {
    const existing = makeActionLog({ id: "keep-me" });
    const log = rebuildActionLog(existing, [], { totalSeen: 0 });
    expect(log.id).toBe("keep-me");
  });
});

describe("isLogFrozen", () => {
  it("drafting·previewing·done에서만 true", () => {
    const frozen: EditorPhase[] = ["drafting", "previewing", "done"];
    for (const phase of frozen) {
      expect(isLogFrozen(phase)).toBe(true);
    }
  });

  it("idle·picking·styling·capturing·recording에서는 false", () => {
    const live: EditorPhase[] = [
      "idle",
      "picking",
      "styling",
      "capturing",
      "recording",
    ];
    for (const phase of live) {
      expect(isLogFrozen(phase)).toBe(false);
    }
  });
});

describe("상수", () => {
  it("cap 값", () => {
    expect(NETWORK_MAX_ENTRIES).toBe(5000);
    expect(CONSOLE_MAX_ENTRIES).toBe(2000);
  });
});
