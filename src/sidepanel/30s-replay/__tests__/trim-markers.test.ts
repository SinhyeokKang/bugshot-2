import { describe, it, expect } from "vitest";
import { buildErrorMarkers } from "../trim-markers";
import type { ConsoleLog, ConsoleEntry } from "@/types/console";
import type { NetworkLog, NetworkRequest } from "@/types/network";
import type { ActionLog, ActionEntry } from "@/types/action";

function makeEntry(o: Partial<ConsoleEntry> = {}): ConsoleEntry {
  return { id: "1", level: "log", timestamp: 0, args: "", pageUrl: "", ...o };
}

function makeConsoleLog(entries: ConsoleEntry[]): ConsoleLog {
  return {
    id: "con-1",
    startedAt: 0,
    endedAt: 0,
    totalSeen: entries.length,
    captured: entries.length,
    entries,
  };
}

function makeRequest(o: Partial<NetworkRequest> = {}): NetworkRequest {
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
    ...o,
  };
}

function makeNetworkLog(requests: NetworkRequest[]): NetworkLog {
  return {
    id: "net-1",
    startedAt: 0,
    endedAt: 0,
    totalSeen: requests.length,
    captured: requests.length,
    warnings: [],
    requests,
  };
}

function makeActionEntry(o: Partial<ActionEntry> = {}): ActionEntry {
  return { id: "1", kind: "click", timestamp: 0, pageUrl: "", ...o };
}

function makeActionLog(entries: ActionEntry[]): ActionLog {
  return {
    id: "act-1",
    startedAt: 0,
    endedAt: 0,
    totalSeen: entries.length,
    captured: entries.length,
    entries,
  };
}

const START = 1000;
const DUR = 10; // 영상 10초

describe("buildErrorMarkers — console", () => {
  it("error·warn만 포함하고 info·log는 제외", () => {
    const consoleLog = makeConsoleLog([
      makeEntry({ id: "e", level: "error", timestamp: START + 1000 }),
      makeEntry({ id: "w", level: "warn", timestamp: START + 2000 }),
      makeEntry({ id: "i", level: "info", timestamp: START + 3000 }),
      makeEntry({ id: "l", level: "log", timestamp: START + 4000 }),
    ]);

    const markers = buildErrorMarkers({ consoleLog, networkLog: null, actionLog: null }, START, DUR);

    expect(markers.map((m) => m.id).sort()).toEqual(["e", "w"]);
    expect(markers.every((m) => m.type === "console")).toBe(true);
  });
});

describe("buildErrorMarkers — network", () => {
  it("4xx/5xx·phase error·pending 포함, 2xx 정상 제외", () => {
    const networkLog = makeNetworkLog([
      makeRequest({ id: "s500", status: 500, startTime: START + 1000 }),
      makeRequest({ id: "perr", phase: "error", status: 0, startTime: START + 2000 }),
      makeRequest({ id: "ppend", phase: "pending", status: 0, startTime: START + 3000 }),
      makeRequest({ id: "ok", status: 200, startTime: START + 4000 }),
    ]);

    const markers = buildErrorMarkers({ consoleLog: null, networkLog, actionLog: null }, START, DUR);

    expect(markers.map((m) => m.id).sort()).toEqual(["perr", "ppend", "s500"]);
    expect(markers.every((m) => m.type === "network")).toBe(true);
  });
});

describe("buildErrorMarkers — action (navigate)", () => {
  it("navigation만 포함하고 click·input 등 일반 동작은 제외", () => {
    const actionLog = makeActionLog([
      makeActionEntry({ id: "nav", kind: "navigation", navType: "pushState", toUrl: "https://x.com/next", timestamp: START + 1000 }),
      makeActionEntry({ id: "clk", kind: "click", target: "버튼", timestamp: START + 2000 }),
      makeActionEntry({ id: "inp", kind: "input", fieldLabel: "검색", value: "x", timestamp: START + 3000 }),
    ]);

    const markers = buildErrorMarkers({ consoleLog: null, networkLog: null, actionLog }, START, DUR);

    expect(markers.map((m) => m.id)).toEqual(["nav"]);
    expect(markers.every((m) => m.type === "action" && m.variant === "navigate")).toBe(true);
  });
});

describe("buildErrorMarkers — positionPct", () => {
  it("videoStartedAt 기준 환산이 정확 (5s/10s → 50%)", () => {
    const consoleLog = makeConsoleLog([
      makeEntry({ id: "e", level: "error", timestamp: START + 5000 }),
    ]);

    const [m] = buildErrorMarkers({ consoleLog, networkLog: null, actionLog: null }, START, DUR);

    expect(m.positionPct).toBe(50);
  });

  it("범위 밖이면 0~100으로 clamp", () => {
    const consoleLog = makeConsoleLog([
      makeEntry({ id: "e", level: "error", timestamp: START + 99000 }),
    ]);

    const [m] = buildErrorMarkers({ consoleLog, networkLog: null, actionLog: null }, START, DUR);

    expect(m.positionPct).toBe(100);
  });
});

describe("buildErrorMarkers — 엣지", () => {
  it("durationSec<=0이면 빈 배열(NaN 없음)", () => {
    const consoleLog = makeConsoleLog([
      makeEntry({ id: "e", level: "error", timestamp: START + 1000 }),
    ]);

    expect(buildErrorMarkers({ consoleLog, networkLog: null, actionLog: null }, START, 0)).toEqual([]);
  });

  it("로그가 모두 null이면 빈 배열", () => {
    expect(buildErrorMarkers({ consoleLog: null, networkLog: null, actionLog: null }, START, DUR)).toEqual([]);
  });
});
