import { describe, it, expect } from "vitest";
import type { NetworkLog } from "@/types/network";
import type { ConsoleLog } from "@/types/console";
import type { ActionLog } from "@/types/action";
import { logCardTypeCounts } from "../logCardTypeCounts";

// key + params를 그대로 문자열로 펼치는 가짜 t. 세그먼트에 어떤 key·건수가 들어갔는지
// 결과 문자열로 그대로 드러난다.
const t = (key: string, params?: Record<string, string | number>): string => {
  if (!params) return key;
  let s = key;
  for (const [k, v] of Object.entries(params)) s += ` ${k}=${v}`;
  return s;
};

const networkLog: NetworkLog = {
  id: "net-1",
  startedAt: 0,
  endedAt: 0,
  totalSeen: 12,
  captured: 12,
  warnings: [],
  requests: [
    // 서로 다른 method+path+status 3건 → errors=3
    req("r1", "GET", "https://x.test/a", 500),
    req("r2", "GET", "https://x.test/b", 404),
    req("r3", "POST", "https://x.test/c", 503),
    // 정상 요청(에러 아님)
    req("r4", "GET", "https://x.test/ok", 200),
  ],
};

const consoleLog: ConsoleLog = {
  id: "con-1",
  startedAt: 0,
  endedAt: 0,
  totalSeen: 5,
  captured: 5,
  entries: [
    entry("c1", "error", "boom-1"),
    entry("c2", "error", "boom-2"),
    entry("c3", "warn", "careful"),
  ],
};

const actionLog: ActionLog = {
  id: "act-1",
  startedAt: 0,
  endedAt: 0,
  totalSeen: 8,
  captured: 8,
  entries: [],
};

function req(id: string, method: string, url: string, status: number): NetworkLog["requests"][number] {
  return {
    id,
    url,
    method,
    status,
    statusText: "",
    startTime: 0,
    durationMs: 0,
    requestHeaders: {},
    responseHeaders: {},
    pageUrl: "https://x.test",
    requestBodySize: 0,
    responseBodySize: 0,
    contentType: "",
    phase: status >= 400 ? "complete" : "complete",
  };
}

function entry(id: string, level: ConsoleLog["entries"][number]["level"], args: string): ConsoleLog["entries"][number] {
  return { id, level, timestamp: 0, args, pageUrl: "https://x.test" };
}

describe("logCardTypeCounts — 캡처된 타입 세그먼트 조립", () => {
  it("세 타입 모두 캡처면 console → network → action 순으로 조립한다", () => {
    const desc = logCardTypeCounts({ networkLog, consoleLog, actionLog }, t);

    const parts = desc.split(" · ");
    expect(parts).toHaveLength(3);
    expect(
      desc.indexOf("consoleCount") < desc.indexOf("networkCount"),
    ).toBe(true);
    expect(
      desc.indexOf("networkCount") < desc.indexOf("actionCount"),
    ).toBe(true);
  });

  it("network 세그먼트에 captured 건수와 파생 에러 건수를 반영한다", () => {
    const desc = logCardTypeCounts({ networkLog, consoleLog: null, actionLog: null }, t);

    expect(desc).toContain("captured=12");
    expect(desc).toContain("errors=3");
  });

  it("network 에러는 dedup·cap 없이 전체 건수(errorCount)로 센다", () => {
    // 7개 에러(중복 3 포함) → errors[] 샘플은 dedup+cap 5여도 count는 7이어야 한다.
    const many: NetworkLog = {
      ...networkLog,
      captured: 20,
      requests: [
        req("e1", "GET", "https://x.test/a", 500),
        req("e2", "GET", "https://x.test/a", 500), // dup
        req("e3", "GET", "https://x.test/b", 404),
        req("e4", "GET", "https://x.test/c", 502),
        req("e5", "GET", "https://x.test/d", 503),
        req("e6", "GET", "https://x.test/e", 500),
        req("e7", "GET", "https://x.test/a", 500), // dup
      ],
    };
    const desc = logCardTypeCounts({ networkLog: many, consoleLog: null, actionLog: null }, t);

    expect(desc).toContain("errors=7");
  });

  it("console 세그먼트에 captured 건수와 error-level 건수를 반영한다", () => {
    const desc = logCardTypeCounts({ networkLog: null, consoleLog, actionLog: null }, t);

    expect(desc).toContain("captured=5");
    expect(desc).toContain("errors=2");
  });

  it("action 세그먼트는 captured 건수만 담는다", () => {
    const desc = logCardTypeCounts({ networkLog: null, consoleLog: null, actionLog }, t);

    expect(desc).toContain("captured=8");
    expect(desc).not.toContain(" · ");
  });

  it("캡처된 타입이 하나면 구분자 없이 단일 세그먼트", () => {
    const desc = logCardTypeCounts({ networkLog: null, consoleLog, actionLog: null }, t);

    expect(desc).not.toContain(" · ");
    expect(desc.length).toBeGreaterThan(0);
  });

  it("captured=0인 타입은 세그먼트에서 제외한다", () => {
    const desc = logCardTypeCounts(
      { networkLog: { ...networkLog, captured: 0 }, consoleLog, actionLog: null },
      t,
    );

    expect(desc).not.toContain("networkCount");
    expect(desc).toContain("consoleCount");
  });

  it("모든 타입이 null이거나 captured=0이면 빈 문자열", () => {
    expect(logCardTypeCounts({ networkLog: null, consoleLog: null, actionLog: null }, t)).toBe("");
    expect(
      logCardTypeCounts(
        {
          networkLog: { ...networkLog, captured: 0 },
          consoleLog: { ...consoleLog, captured: 0 },
          actionLog: { ...actionLog, captured: 0 },
        },
        t,
      ),
    ).toBe("");
  });
});
