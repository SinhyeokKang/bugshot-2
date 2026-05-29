import { describe, expect, it } from "vitest";

import { buildMarkers } from "../markers";
import type { LogViewerData } from "@/types/log-viewer";
import type { ConsoleLog, ConsoleEntry } from "@/types/console";
import type { NetworkLog, NetworkRequest } from "@/types/network";
import type { ActionLog, ActionEntry } from "@/types/action";

const BASE_TS = 1_700_000_000_000;
const VIDEO_STARTED_AT = BASE_TS;
const VIDEO_DURATION_SEC = 30;

function makeData(
  overrides: Partial<
    Pick<LogViewerData, "consoleLog" | "networkLog" | "actionLog">
  > = {},
): LogViewerData {
  return {
    consoleLog: null,
    networkLog: null,
    actionLog: null,
    har: null,
    consoleLogJson: null,
    actionLogJson: null,
    video: { dataUrl: "", startedAt: VIDEO_STARTED_AT },
    meta: { version: "1.0.0", createdAt: "", pageUrl: "" },
    ...overrides,
  };
}

function makeConsoleLog(entries: ConsoleEntry[]): ConsoleLog {
  return {
    id: "cl-1",
    startedAt: BASE_TS,
    endedAt: BASE_TS + 30_000,
    totalSeen: entries.length,
    captured: entries.length,
    entries,
  };
}

function makeConsoleEntry(
  overrides: Partial<ConsoleEntry> & Pick<ConsoleEntry, "level">,
): ConsoleEntry {
  return {
    id: `ce-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: BASE_TS + 5_000,
    args: "test message",
    pageUrl: "https://example.com",
    ...overrides,
  };
}

function makeNetworkLog(requests: NetworkRequest[]): NetworkLog {
  return {
    id: "nl-1",
    startedAt: BASE_TS,
    endedAt: BASE_TS + 30_000,
    totalSeen: requests.length,
    captured: requests.length,
    warnings: [],
    requests,
  };
}

function makeNetworkRequest(
  overrides: Partial<NetworkRequest> = {},
): NetworkRequest {
  return {
    id: `nr-${Math.random().toString(36).slice(2, 8)}`,
    url: "https://api.example.com/data",
    method: "GET",
    status: 200,
    statusText: "OK",
    startTime: BASE_TS + 5_000,
    durationMs: 100,
    requestHeaders: {},
    responseHeaders: {},
    pageUrl: "https://example.com",
    requestBodySize: 0,
    responseBodySize: 0,
    contentType: "application/json",
    phase: "complete",
    ...overrides,
  };
}

function makeActionLog(entries: ActionEntry[]): ActionLog {
  return {
    id: "al-1",
    startedAt: BASE_TS,
    endedAt: BASE_TS + 30_000,
    totalSeen: entries.length,
    captured: entries.length,
    entries,
  };
}

function makeActionEntry(
  overrides: Partial<ActionEntry> & Pick<ActionEntry, "kind">,
): ActionEntry {
  return {
    id: `ae-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: BASE_TS + 5_000,
    pageUrl: "https://example.com",
    ...overrides,
  };
}

// ---------- 빈 데이터 / 가드 ----------

describe("buildMarkers — 빈 데이터·가드", () => {
  it("consoleLog가 null이면 빈 배열", () => {
    const data = makeData();
    expect(buildMarkers(data, "console", VIDEO_DURATION_SEC, VIDEO_STARTED_AT)).toEqual([]);
  });

  it("networkLog가 null이면 빈 배열", () => {
    const data = makeData();
    expect(buildMarkers(data, "network", VIDEO_DURATION_SEC, VIDEO_STARTED_AT)).toEqual([]);
  });

  it("actionLog가 null이면 빈 배열", () => {
    const data = makeData();
    expect(buildMarkers(data, "action", VIDEO_DURATION_SEC, VIDEO_STARTED_AT)).toEqual([]);
  });

  it("videoDurationSec <= 0이면 빈 배열", () => {
    const data = makeData({
      consoleLog: makeConsoleLog([makeConsoleEntry({ level: "error" })]),
    });
    expect(buildMarkers(data, "console", 0, VIDEO_STARTED_AT)).toEqual([]);
    expect(buildMarkers(data, "console", -1, VIDEO_STARTED_AT)).toEqual([]);
  });
});

// ---------- Console 탭 ----------

describe("buildMarkers — console 탭", () => {
  it("error와 warn만 포함, log/info/debug 제외", () => {
    const data = makeData({
      consoleLog: makeConsoleLog([
        makeConsoleEntry({ id: "e1", level: "error" }),
        makeConsoleEntry({ id: "w1", level: "warn" }),
        makeConsoleEntry({ id: "l1", level: "log" }),
        makeConsoleEntry({ id: "i1", level: "info" }),
        makeConsoleEntry({ id: "d1", level: "debug" }),
      ]),
    });
    const markers = buildMarkers(data, "console", VIDEO_DURATION_SEC, VIDEO_STARTED_AT);
    expect(markers).toHaveLength(2);
    expect(markers.map((m) => m.id)).toEqual(["e1", "w1"]);
  });

  it("error → variant 'error', warn → variant 'warn'", () => {
    const data = makeData({
      consoleLog: makeConsoleLog([
        makeConsoleEntry({ id: "e1", level: "error" }),
        makeConsoleEntry({ id: "w1", level: "warn" }),
      ]),
    });
    const markers = buildMarkers(data, "console", VIDEO_DURATION_SEC, VIDEO_STARTED_AT);
    expect(markers[0].variant).toBe("error");
    expect(markers[1].variant).toBe("warn");
  });

  it("type은 'console'", () => {
    const data = makeData({
      consoleLog: makeConsoleLog([makeConsoleEntry({ level: "error" })]),
    });
    const markers = buildMarkers(data, "console", VIDEO_DURATION_SEC, VIDEO_STARTED_AT);
    expect(markers[0].type).toBe("console");
  });

  it("label: [ERROR] args 앞 80자 / [WARN] args 앞 80자", () => {
    const data = makeData({
      consoleLog: makeConsoleLog([
        makeConsoleEntry({ level: "error", args: "TypeError: x is null" }),
        makeConsoleEntry({ level: "warn", args: "Deprecation notice" }),
      ]),
    });
    const markers = buildMarkers(data, "console", VIDEO_DURATION_SEC, VIDEO_STARTED_AT);
    expect(markers[0].label).toBe("[ERROR] TypeError: x is null");
    expect(markers[1].label).toBe("[WARN] Deprecation notice");
  });

  it("label: args가 80자 초과 시 잘림", () => {
    const longArgs = "a".repeat(100);
    const data = makeData({
      consoleLog: makeConsoleLog([
        makeConsoleEntry({ level: "error", args: longArgs }),
      ]),
    });
    const markers = buildMarkers(data, "console", VIDEO_DURATION_SEC, VIDEO_STARTED_AT);
    const expectedTruncated = longArgs.slice(0, 80);
    expect(markers[0].label).toBe(`[ERROR] ${expectedTruncated}`);
  });

  it("absTs는 entry.timestamp", () => {
    const ts = BASE_TS + 10_000;
    const data = makeData({
      consoleLog: makeConsoleLog([
        makeConsoleEntry({ level: "error", timestamp: ts }),
      ]),
    });
    const markers = buildMarkers(data, "console", VIDEO_DURATION_SEC, VIDEO_STARTED_AT);
    expect(markers[0].absTs).toBe(ts);
  });
});

// ---------- Network 탭 ----------

describe("buildMarkers — network 탭", () => {
  it("phase=error 포함", () => {
    const data = makeData({
      networkLog: makeNetworkLog([
        makeNetworkRequest({ id: "r1", phase: "error", status: 0 }),
      ]),
    });
    const markers = buildMarkers(data, "network", VIDEO_DURATION_SEC, VIDEO_STARTED_AT);
    expect(markers).toHaveLength(1);
    expect(markers[0].variant).toBe("error");
  });

  it("phase=pending 포함", () => {
    const data = makeData({
      networkLog: makeNetworkLog([
        makeNetworkRequest({ id: "r1", phase: "pending", status: 0 }),
      ]),
    });
    const markers = buildMarkers(data, "network", VIDEO_DURATION_SEC, VIDEO_STARTED_AT);
    expect(markers).toHaveLength(1);
    expect(markers[0].variant).toBe("pending");
  });

  it("phase=complete + status >= 400 포함 (variant: error)", () => {
    const data = makeData({
      networkLog: makeNetworkLog([
        makeNetworkRequest({ id: "r1", phase: "complete", status: 500 }),
      ]),
    });
    const markers = buildMarkers(data, "network", VIDEO_DURATION_SEC, VIDEO_STARTED_AT);
    expect(markers).toHaveLength(1);
    expect(markers[0].variant).toBe("error");
  });

  it("phase=complete + status < 400 제외", () => {
    const data = makeData({
      networkLog: makeNetworkLog([
        makeNetworkRequest({ id: "r1", phase: "complete", status: 200 }),
        makeNetworkRequest({ id: "r2", phase: "complete", status: 301 }),
      ]),
    });
    const markers = buildMarkers(data, "network", VIDEO_DURATION_SEC, VIDEO_STARTED_AT);
    expect(markers).toHaveLength(0);
  });

  it("label: pending → [Pending], error/status≥400 → [{status}]", () => {
    const data = makeData({
      networkLog: makeNetworkLog([
        makeNetworkRequest({
          id: "r1",
          phase: "pending",
          status: 0,
          method: "GET",
          url: "https://api.example.com/data",
        }),
        makeNetworkRequest({
          id: "r2",
          phase: "complete",
          status: 404,
          method: "POST",
          url: "https://api.example.com/users",
        }),
      ]),
    });
    const markers = buildMarkers(data, "network", VIDEO_DURATION_SEC, VIDEO_STARTED_AT);
    expect(markers[0].label).toBe("[Pending] GET https://api.example.com/data");
    expect(markers[1].label).toBe("[404] POST https://api.example.com/users");
  });

  it("label: url이 60자 초과 시 뒤 60자만", () => {
    const longUrl = "https://api.example.com/" + "x".repeat(80);
    const data = makeData({
      networkLog: makeNetworkLog([
        makeNetworkRequest({
          id: "r1",
          phase: "error",
          status: 0,
          method: "GET",
          url: longUrl,
        }),
      ]),
    });
    const markers = buildMarkers(data, "network", VIDEO_DURATION_SEC, VIDEO_STARTED_AT);
    const urlSuffix = longUrl.slice(-60);
    expect(markers[0].label).toBe(`[0] GET ${urlSuffix}`);
  });

  it("type은 'network'", () => {
    const data = makeData({
      networkLog: makeNetworkLog([
        makeNetworkRequest({ phase: "error" }),
      ]),
    });
    const markers = buildMarkers(data, "network", VIDEO_DURATION_SEC, VIDEO_STARTED_AT);
    expect(markers[0].type).toBe("network");
  });

  it("absTs는 request.startTime", () => {
    const st = BASE_TS + 12_000;
    const data = makeData({
      networkLog: makeNetworkLog([
        makeNetworkRequest({ phase: "error", startTime: st }),
      ]),
    });
    const markers = buildMarkers(data, "network", VIDEO_DURATION_SEC, VIDEO_STARTED_AT);
    expect(markers[0].absTs).toBe(st);
  });
});

// ---------- Action 탭 ----------

describe("buildMarkers — action 탭", () => {
  it("전체 entries 포함", () => {
    const data = makeData({
      actionLog: makeActionLog([
        makeActionEntry({ id: "a1", kind: "click", target: "Button" }),
        makeActionEntry({ id: "a2", kind: "navigation", toUrl: "https://example.com/page" }),
        makeActionEntry({ id: "a3", kind: "input", fieldLabel: "Email" }),
      ]),
    });
    const markers = buildMarkers(data, "action", VIDEO_DURATION_SEC, VIDEO_STARTED_AT);
    expect(markers).toHaveLength(3);
  });

  it("navigation → variant 'navigate', 그 외 → variant 'default'", () => {
    const data = makeData({
      actionLog: makeActionLog([
        makeActionEntry({ kind: "click" }),
        makeActionEntry({ kind: "navigation" }),
        makeActionEntry({ kind: "input" }),
      ]),
    });
    const markers = buildMarkers(data, "action", VIDEO_DURATION_SEC, VIDEO_STARTED_AT);
    expect(markers[0].variant).toBe("default");
    expect(markers[1].variant).toBe("navigate");
    expect(markers[2].variant).toBe("default");
  });

  it("label: click → 'Click: {target}'", () => {
    const data = makeData({
      actionLog: makeActionLog([
        makeActionEntry({ kind: "click", target: "Submit" }),
      ]),
    });
    const markers = buildMarkers(data, "action", VIDEO_DURATION_SEC, VIDEO_STARTED_AT);
    expect(markers[0].label).toBe("Click: Submit");
  });

  it("label: navigation → 'Nav: {toUrl 뒤 60자}'", () => {
    const data = makeData({
      actionLog: makeActionLog([
        makeActionEntry({ kind: "navigation", toUrl: "https://example.com/page" }),
      ]),
    });
    const markers = buildMarkers(data, "action", VIDEO_DURATION_SEC, VIDEO_STARTED_AT);
    expect(markers[0].label).toBe("Nav: https://example.com/page");
  });

  it("label: navigation toUrl이 60자 초과 시 뒤 60자만", () => {
    const longUrl = "https://example.com/" + "p".repeat(80);
    const data = makeData({
      actionLog: makeActionLog([
        makeActionEntry({ kind: "navigation", toUrl: longUrl }),
      ]),
    });
    const markers = buildMarkers(data, "action", VIDEO_DURATION_SEC, VIDEO_STARTED_AT);
    const urlSuffix = longUrl.slice(-60);
    expect(markers[0].label).toBe(`Nav: ${urlSuffix}`);
  });

  it("label: input → 'Input: {fieldLabel}'", () => {
    const data = makeData({
      actionLog: makeActionLog([
        makeActionEntry({ kind: "input", fieldLabel: "Password" }),
      ]),
    });
    const markers = buildMarkers(data, "action", VIDEO_DURATION_SEC, VIDEO_STARTED_AT);
    expect(markers[0].label).toBe("Input: Password");
  });

  it("type은 'action'", () => {
    const data = makeData({
      actionLog: makeActionLog([
        makeActionEntry({ kind: "click" }),
      ]),
    });
    const markers = buildMarkers(data, "action", VIDEO_DURATION_SEC, VIDEO_STARTED_AT);
    expect(markers[0].type).toBe("action");
  });
});

// ---------- positionPct 계산 ----------

describe("buildMarkers — positionPct 계산", () => {
  it("비디오 중간 시점 → 50%", () => {
    const data = makeData({
      consoleLog: makeConsoleLog([
        makeConsoleEntry({
          level: "error",
          timestamp: BASE_TS + 15_000, // 15초 = 절반
        }),
      ]),
    });
    const markers = buildMarkers(data, "console", VIDEO_DURATION_SEC, VIDEO_STARTED_AT);
    expect(markers[0].positionPct).toBeCloseTo(50, 5);
  });

  it("비디오 시작 시점 → 0%", () => {
    const data = makeData({
      consoleLog: makeConsoleLog([
        makeConsoleEntry({
          level: "error",
          timestamp: BASE_TS, // 시작점
        }),
      ]),
    });
    const markers = buildMarkers(data, "console", VIDEO_DURATION_SEC, VIDEO_STARTED_AT);
    expect(markers[0].positionPct).toBe(0);
  });

  it("비디오 끝 시점 → 100%", () => {
    const data = makeData({
      consoleLog: makeConsoleLog([
        makeConsoleEntry({
          level: "error",
          timestamp: BASE_TS + 30_000, // 30초 = 끝
        }),
      ]),
    });
    const markers = buildMarkers(data, "console", VIDEO_DURATION_SEC, VIDEO_STARTED_AT);
    expect(markers[0].positionPct).toBe(100);
  });

  it("비디오 시작 전 timestamp → 0%로 클램프", () => {
    const data = makeData({
      consoleLog: makeConsoleLog([
        makeConsoleEntry({
          level: "error",
          timestamp: BASE_TS - 5_000, // 시작 5초 전
        }),
      ]),
    });
    const markers = buildMarkers(data, "console", VIDEO_DURATION_SEC, VIDEO_STARTED_AT);
    expect(markers[0].positionPct).toBe(0);
  });

  it("비디오 끝 이후 timestamp → 100%로 클램프", () => {
    const data = makeData({
      consoleLog: makeConsoleLog([
        makeConsoleEntry({
          level: "error",
          timestamp: BASE_TS + 60_000, // 60초 = 비디오 30초 초과
        }),
      ]),
    });
    const markers = buildMarkers(data, "console", VIDEO_DURATION_SEC, VIDEO_STARTED_AT);
    expect(markers[0].positionPct).toBe(100);
  });
});
