import { describe, expect, it } from "vitest";

import type { ConsoleEntry, ConsoleLevel, ConsoleLog } from "@/types/console";
import type { NetworkLog, NetworkRequest, NetworkRequestPhase } from "@/types/network";
import type { ActionEntry, ActionEntryKind, ActionLog } from "@/types/action";

import {
  buildTimeline,
  matchesTimelineItem,
  timelineFillClass,
  type TimelineItem,
} from "../timeline-merge";

// ── 최소 픽스처 ───────────────────────────────────────────────
function consoleEntry(
  id: string,
  timestamp: number,
  level: ConsoleLevel = "log",
  args = "",
  stack?: string,
): ConsoleEntry {
  return { id, level, timestamp, args, pageUrl: "https://x.test/", ...(stack ? { stack } : {}) };
}

function consoleLog(entries: ConsoleEntry[]): ConsoleLog {
  return { id: "c", startedAt: 0, endedAt: 0, totalSeen: entries.length, captured: entries.length, entries };
}

function networkRequest(
  id: string,
  startTime: number,
  opts: Partial<Pick<NetworkRequest, "url" | "method" | "status" | "phase">> = {},
): NetworkRequest {
  const phase: NetworkRequestPhase = opts.phase ?? "complete";
  return {
    id,
    url: opts.url ?? "https://api.test/data",
    method: opts.method ?? "GET",
    status: opts.status ?? 200,
    statusText: "",
    startTime,
    durationMs: 10,
    requestHeaders: {},
    responseHeaders: {},
    pageUrl: "https://x.test/",
    requestBodySize: 0,
    responseBodySize: 0,
    contentType: "application/json",
    phase,
  };
}

function networkLog(requests: NetworkRequest[]): NetworkLog {
  return { id: "n", startedAt: 0, endedAt: 0, totalSeen: requests.length, captured: requests.length, warnings: [], requests };
}

function actionEntry(
  id: string,
  timestamp: number,
  kind: ActionEntryKind = "click",
  extra: Partial<ActionEntry> = {},
): ActionEntry {
  return { id, kind, timestamp, pageUrl: "https://x.test/", ...extra };
}

function actionLog(entries: ActionEntry[]): ActionLog {
  return { id: "a", startedAt: 0, endedAt: 0, totalSeen: entries.length, captured: entries.length, entries };
}

// ── buildTimeline ─────────────────────────────────────────────
describe("buildTimeline — 3종 로그 absTs 병합·정렬", () => {
  it("3종 혼합 입력이 absTs 오름차순으로 병합됨", () => {
    const result = buildTimeline(
      consoleLog([consoleEntry("c1", 300)]),
      networkLog([networkRequest("n1", 100)]),
      actionLog([actionEntry("a1", 200)]),
    );
    expect(result.map((i) => i.id)).toEqual(["n1", "a1", "c1"]);
  });

  it("각 kind의 absTs가 원본 타임필드에서 파생됨 (console.timestamp / network.startTime / action.timestamp)", () => {
    const result = buildTimeline(
      consoleLog([consoleEntry("c1", 30)]),
      networkLog([networkRequest("n1", 10)]),
      actionLog([actionEntry("a1", 20)]),
    );
    const byId = Object.fromEntries(result.map((i) => [i.id, i.absTs]));
    expect(byId).toEqual({ n1: 10, a1: 20, c1: 30 });
  });

  it("판별 유니온이 kind별 원본 참조를 그대로 보유", () => {
    const cEntry = consoleEntry("c1", 1);
    const nReq = networkRequest("n1", 2);
    const aEntry = actionEntry("a1", 3);
    const result = buildTimeline(consoleLog([cEntry]), networkLog([nReq]), actionLog([aEntry]));
    const console = result.find((i) => i.kind === "console") as Extract<TimelineItem, { kind: "console" }>;
    const network = result.find((i) => i.kind === "network") as Extract<TimelineItem, { kind: "network" }>;
    const action = result.find((i) => i.kind === "action") as Extract<TimelineItem, { kind: "action" }>;
    expect(console.entry).toBe(cEntry);
    expect(network.req).toBe(nReq);
    expect(action.entry).toBe(aEntry);
  });

  it("동일 absTs 다발은 kind 우선순위(action→network→console)로 타이브레이크", () => {
    const result = buildTimeline(
      consoleLog([consoleEntry("c1", 100)]),
      networkLog([networkRequest("n1", 100)]),
      actionLog([actionEntry("a1", 100)]),
    );
    expect(result.map((i) => i.id)).toEqual(["a1", "n1", "c1"]);
  });

  it("동일 absTs·동일 kind는 원본 입력 순서 보존 (안정 정렬)", () => {
    const result = buildTimeline(
      consoleLog([consoleEntry("c1", 100), consoleEntry("c2", 100), consoleEntry("c3", 100)]),
      null,
      null,
    );
    expect(result.map((i) => i.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("null 로그 3종은 빈 배열", () => {
    expect(buildTimeline(null, null, null)).toEqual([]);
  });

  it("빈 entries 로그도 빈 배열", () => {
    expect(buildTimeline(consoleLog([]), networkLog([]), actionLog([]))).toEqual([]);
  });

  it("한 종류만 있으면 그 타입만 시간순 반환", () => {
    const result = buildTimeline(null, networkLog([networkRequest("n2", 200), networkRequest("n1", 100)]), null);
    expect(result.map((i) => i.id)).toEqual(["n1", "n2"]);
    expect(result.every((i) => i.kind === "network")).toBe(true);
  });
});

// ── matchesTimelineItem ───────────────────────────────────────
describe("matchesTimelineItem — 타입 필터(단일선택) + 검색 매칭", () => {
  const cItem = buildTimeline(consoleLog([consoleEntry("c1", 1, "log", "Failed to Fetch user")]), null, null)[0];
  const nItem = buildTimeline(null, networkLog([networkRequest("n1", 1, { url: "https://api.test/orders" })]), null)[0];
  const aItem = buildTimeline(null, null, actionLog([actionEntry("a1", 1, "click", { target: "Save button" })]))[0];

  it("filter가 다른 kind면 query와 무관하게 false", () => {
    expect(matchesTimelineItem(cItem, "network", "")).toBe(false);
  });

  it("filter=all + 빈 query면 true (텍스트 필터 없음)", () => {
    expect(matchesTimelineItem(cItem, "all", "")).toBe(true);
  });

  it("filter가 해당 kind면 통과", () => {
    expect(matchesTimelineItem(cItem, "console", "")).toBe(true);
  });

  it("console: entry.args 부분일치 (대소문자 무시)", () => {
    expect(matchesTimelineItem(cItem, "all", "fetch")).toBe(true);
    expect(matchesTimelineItem(cItem, "all", "timeout")).toBe(false);
  });

  it("network: requestMatchesQuery 경유 URL 매칭 (대소문자 무시)", () => {
    expect(matchesTimelineItem(nItem, "all", "ORDERS")).toBe(true);
    expect(matchesTimelineItem(nItem, "all", "users")).toBe(false);
  });

  it("action: searchText 부분일치 (대소문자 무시)", () => {
    expect(matchesTimelineItem(aItem, "all", "save")).toBe(true);
    expect(matchesTimelineItem(aItem, "all", "cancel")).toBe(false);
  });
});

// ── timelineFillClass ─────────────────────────────────────────
// 반환 클래스는 기존 로그 탭 배경색 함수의 base 틴트와 완전 일치해야 한다(우측 탭과 시각 sync).
describe("timelineFillClass — 우측 탭 배경색 base 틴트와 동일", () => {
  const item = (
    partial: ConsoleEntry | NetworkRequest,
    kind: TimelineItem["kind"],
  ): TimelineItem =>
    kind === "console"
      ? { kind, id: "x", absTs: 0, entry: partial as ConsoleEntry }
      : { kind: "network", id: "x", absTs: 0, req: partial as NetworkRequest };

  it("console error → red base 틴트", () => {
    expect(timelineFillClass(item(consoleEntry("c", 0, "error"), "console"))).toBe("bg-red-100 dark:bg-red-950/50");
  });

  it("console warn → amber base 틴트", () => {
    expect(timelineFillClass(item(consoleEntry("c", 0, "warn"), "console"))).toBe("bg-amber-100 dark:bg-amber-950/50");
  });

  it("console info → blue base 틴트 (우측 콘솔 탭과 sync — 무틴트 아님)", () => {
    expect(timelineFillClass(item(consoleEntry("c", 0, "info"), "console"))).toBe("bg-blue-100 dark:bg-blue-950/50");
  });

  it("console log/debug → 빈 문자열", () => {
    expect(timelineFillClass(item(consoleEntry("c", 0, "log"), "console"))).toBe("");
    expect(timelineFillClass(item(consoleEntry("c", 0, "debug"), "console"))).toBe("");
  });

  it("network status>=400 → red base 틴트", () => {
    expect(timelineFillClass(item(networkRequest("n", 0, { status: 500 }), "network"))).toBe("bg-red-100 dark:bg-red-950/50");
  });

  it("network phase error → red base 틴트", () => {
    expect(timelineFillClass(item(networkRequest("n", 0, { phase: "error", status: 0 }), "network"))).toBe("bg-red-100 dark:bg-red-950/50");
  });

  it("network pending → amber base 틴트", () => {
    expect(timelineFillClass(item(networkRequest("n", 0, { phase: "pending", status: 0 }), "network"))).toBe("bg-amber-100 dark:bg-amber-950/50");
  });

  it("network 2xx complete → 빈 문자열", () => {
    expect(timelineFillClass(item(networkRequest("n", 0, { status: 200 }), "network"))).toBe("");
  });

  it("action navigation → blue 틴트 (액션 탭 kindBgColor와 sync)", () => {
    const navItem: TimelineItem = { kind: "action", id: "a", absTs: 0, entry: actionEntry("a", 0, "navigation") };
    expect(timelineFillClass(navItem)).toBe("bg-blue-100 dark:bg-blue-950/50");
  });

  it("action navigation 외(click 등) → 빈 문자열", () => {
    const aItem: TimelineItem = { kind: "action", id: "a", absTs: 0, entry: actionEntry("a", 0, "click") };
    expect(timelineFillClass(aItem)).toBe("");
  });
});
