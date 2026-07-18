import { describe, it, expect } from "vitest";
import {
  buildNetworkLogSummary,
  buildConsoleLogSummary,
  buildActionLogSummary,
} from "../buildLogSummary";
import type { NetworkLog, NetworkRequest } from "@/types/network";
import type { ConsoleLog, ConsoleEntry } from "@/types/console";
import type { ActionLog, ActionEntry } from "@/types/action";

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

describe("buildNetworkLogSummary", () => {
  it("에러 없으면 빈 배열", () => {
    const log = makeNetworkLog({
      captured: 5,
      requests: [makeRequest()],
    });
    const summary = buildNetworkLogSummary(log);
    expect(summary.captured).toBe(5);
    expect(summary.errors).toEqual([]);
  });

  it("4xx/5xx만 에러로 수집", () => {
    const log = makeNetworkLog({
      captured: 3,
      requests: [
        makeRequest({ id: "1", status: 200, statusText: "OK" }),
        makeRequest({ id: "2", url: "https://example.com/not-found", method: "POST", status: 404, statusText: "Not Found" }),
        makeRequest({ id: "3", url: "https://example.com/error", status: 500, statusText: "Internal Server Error" }),
      ],
    });
    const summary = buildNetworkLogSummary(log);
    expect(summary.errors).toHaveLength(2);
    expect(summary.errors[0].status).toBe(404);
    expect(summary.errors[0].path).toBe("/not-found");
    expect(summary.errors[1].status).toBe(500);
  });

  it("최대 5개까지만 수집", () => {
    const requests = Array.from({ length: 8 }, (_, i) =>
      makeRequest({ id: String(i), url: `https://example.com/err${i}`, status: 500, statusText: "Error" }),
    );
    const log = makeNetworkLog({ captured: 8, requests });
    expect(buildNetworkLogSummary(log).errors).toHaveLength(5);
  });

  it("잘못된 URL은 원본 반환", () => {
    const log = makeNetworkLog({
      captured: 1,
      requests: [makeRequest({ url: "not-a-url", status: 400, statusText: "Bad" })],
    });
    expect(buildNetworkLogSummary(log).errors[0].path).toBe("not-a-url");
  });

  it("phase=error는 status 0이어도 에러로 수집", () => {
    const log = makeNetworkLog({
      captured: 2,
      requests: [
        makeRequest({ id: "1", status: 200, phase: "complete" }),
        makeRequest({ id: "2", url: "https://example.com/dead", status: 0, statusText: "Network Error", phase: "error" }),
      ],
    });
    const summary = buildNetworkLogSummary(log);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0].path).toBe("/dead");
    expect(summary.errors[0].statusText).toBe("Network Error");
  });

  it("phase=pending은 에러로 수집하지 않음", () => {
    const log = makeNetworkLog({
      captured: 2,
      requests: [
        makeRequest({ id: "1", status: 200, phase: "complete" }),
        makeRequest({ id: "2", status: 0, statusText: "", phase: "pending" }),
      ],
    });
    expect(buildNetworkLogSummary(log).errors).toHaveLength(0);
  });
});

describe("buildConsoleLogSummary", () => {
  it("에러/경고 없음", () => {
    const log = makeConsoleLog({
      captured: 2,
      entries: [
        makeEntry({ id: "1", level: "log", args: "hello" }),
        makeEntry({ id: "2", level: "info", args: "world" }),
      ],
    });
    const summary = buildConsoleLogSummary(log);
    expect(summary.errorCount).toBe(0);
    expect(summary.warnCount).toBe(0);
    expect(summary.topErrors).toEqual([]);
  });

  it("에러/경고 카운트", () => {
    const log = makeConsoleLog({
      captured: 4,
      entries: [
        makeEntry({ id: "1", level: "error", args: "err1" }),
        makeEntry({ id: "2", level: "error", args: "err2" }),
        makeEntry({ id: "3", level: "warn", args: "warn1" }),
        makeEntry({ id: "4", level: "log", args: "ok" }),
      ],
    });
    const summary = buildConsoleLogSummary(log);
    expect(summary.errorCount).toBe(2);
    expect(summary.warnCount).toBe(1);
  });

  it("중복 에러 메시지 제거", () => {
    const log = makeConsoleLog({
      captured: 3,
      entries: [
        makeEntry({ id: "1", level: "error", args: "same error" }),
        makeEntry({ id: "2", level: "error", args: "same error" }),
        makeEntry({ id: "3", level: "error", args: "different" }),
      ],
    });
    const summary = buildConsoleLogSummary(log);
    expect(summary.topErrors.map((e) => e.message)).toEqual([
      "same error",
      "different",
    ]);
  });

  it("120자 초과 잘림", () => {
    const longMsg = "A".repeat(200);
    const log = makeConsoleLog({
      captured: 1,
      entries: [makeEntry({ id: "1", level: "error", args: longMsg })],
    });
    const summary = buildConsoleLogSummary(log);
    expect(summary.topErrors[0].message).toHaveLength(118);
    expect(summary.topErrors[0].message.endsWith("…")).toBe(true);
  });

  it("멀티라인은 첫 줄만", () => {
    const log = makeConsoleLog({
      captured: 1,
      entries: [makeEntry({ id: "1", level: "error", args: "first line\nsecond line" })],
    });
    expect(buildConsoleLogSummary(log).topErrors[0].message).toBe("first line");
  });

  it("topErrors 최대 5개", () => {
    const entries = Array.from({ length: 8 }, (_, i) =>
      makeEntry({ id: String(i), level: "error", args: `error ${i}` }),
    );
    const log = makeConsoleLog({ captured: 8, entries });
    expect(buildConsoleLogSummary(log).topErrors).toHaveLength(5);
  });
});

// ai-draft-log-refs: 요약 항목에 원본 id가 동행해야 AI가 지목한 ref를 store 원본으로
// 되짚을 수 있다. id는 절대 프롬프트에 인쇄되지 않는다(그건 logCandidates·프롬프트 테스트가 잠근다).
describe("요약 항목의 원본 id 동행", () => {
  it("network 에러 항목은 원본 NetworkRequest.id를 갖는다", () => {
    const log = makeNetworkLog({
      captured: 2,
      requests: [
        makeRequest({ id: "nr-1700000000000-a", url: "https://example.com/a", status: 500 }),
        makeRequest({ id: "nr-1700000000000-b", url: "https://example.com/b", status: 404 }),
      ],
    });
    expect(buildNetworkLogSummary(log).errors.map((e) => e.id)).toEqual([
      "nr-1700000000000-a",
      "nr-1700000000000-b",
    ]);
  });

  it("console topErrors 항목은 {id, message} — 원본 ConsoleEntry.id를 갖는다", () => {
    const log = makeConsoleLog({
      captured: 1,
      entries: [makeEntry({ id: "cl-1700000000000-a", level: "error", args: "boom" })],
    });
    expect(buildConsoleLogSummary(log).topErrors).toEqual([
      { id: "cl-1700000000000-a", message: "boom" },
    ]);
  });

  it("first-line dedup 시 id는 첫 발생 항목으로 고정", () => {
    const log = makeConsoleLog({
      captured: 3,
      entries: [
        makeEntry({ id: "cl-1", level: "error", args: "same error\nstack A" }),
        makeEntry({ id: "cl-2", level: "error", args: "same error\nstack B" }),
        makeEntry({ id: "cl-3", level: "error", args: "different" }),
      ],
    });
    expect(buildConsoleLogSummary(log).topErrors.map((e) => e.id)).toEqual([
      "cl-1",
      "cl-3",
    ]);
  });
});

function makeAction(overrides: Partial<ActionEntry> = {}): ActionEntry {
  return {
    id: "1",
    kind: "click",
    timestamp: 0,
    pageUrl: "https://example.com",
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

describe("buildActionLogSummary", () => {
  it("빈 로그는 빈 배열", () => {
    expect(buildActionLogSummary(makeActionLog())).toEqual([]);
  });

  it("click/navigation/input 혼합을 자연어 줄로 (entry당 1줄)", () => {
    const log = makeActionLog({
      captured: 3,
      entries: [
        makeAction({ id: "1", kind: "click", target: "Submit 버튼" }),
        makeAction({
          id: "2",
          kind: "navigation",
          navType: "pushState",
          toUrl: "https://example.com/next",
        }),
        makeAction({
          id: "3",
          kind: "input",
          fieldLabel: "이메일",
          value: "a@b.com",
        }),
      ],
    });
    const lines = buildActionLogSummary(log);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Submit 버튼");
    expect(lines[1]).toContain("https://example.com/next");
    expect(lines[2]).toContain("이메일");
    expect(lines[2]).toContain("a@b.com");
  });

  it("click role이 있으면 괄호로 부기", () => {
    const log = makeActionLog({
      captured: 1,
      entries: [makeAction({ id: "1", kind: "click", target: "로그인", role: "button" })],
    });
    expect(buildActionLogSummary(log)[0]).toBe("Clicked: 로그인 (button)");
  });

  it("masked input은 값을 *** 로 노출", () => {
    const log = makeActionLog({
      captured: 1,
      entries: [
        makeAction({
          id: "1",
          kind: "input",
          fieldLabel: "비밀번호",
          value: "***",
          masked: true,
        }),
      ],
    });
    const lines = buildActionLogSummary(log);
    expect(lines[0]).toContain("***");
  });

  it("keypress/toggle/select 줄 포맷", () => {
    const log = makeActionLog({
      captured: 4,
      entries: [
        makeAction({ id: "1", kind: "keypress", value: "⌘+K" }),
        makeAction({ id: "2", kind: "toggle", fieldLabel: "약관 동의", value: "checked" }),
        makeAction({ id: "3", kind: "toggle", fieldLabel: "알림", value: "unchecked" }),
        makeAction({ id: "4", kind: "select", fieldLabel: "국가", value: "Korea" }),
      ],
    });
    const lines = buildActionLogSummary(log);
    expect(lines[0]).toBe("Pressed: ⌘+K");
    expect(lines[1]).toBe('Toggled "약관 동의": checked');
    expect(lines[2]).toBe('Toggled "알림": unchecked');
    expect(lines[3]).toBe('Selected "Korea" in "국가"');
  });

  it("폴백 회귀: keypress/toggle/select가 'Clicked'로 새지 않음", () => {
    const log = makeActionLog({
      captured: 3,
      entries: [
        makeAction({ id: "1", kind: "keypress", value: "Enter" }),
        makeAction({ id: "2", kind: "toggle", fieldLabel: "x", value: "checked" }),
        makeAction({ id: "3", kind: "select", fieldLabel: "y", value: "z" }),
      ],
    });
    for (const line of buildActionLogSummary(log)) {
      expect(line.startsWith("Clicked")).toBe(false);
    }
  });

  it("drag source+target(네이티브 DnD)은 'Dragged X to Y'", () => {
    const log = makeActionLog({
      captured: 1,
      entries: [
        makeAction({
          id: "1",
          kind: "drag",
          dragSource: { name: "카드" },
          dragTarget: { name: "받은편지함" },
        } as Partial<ActionEntry>),
      ],
    });
    expect(buildActionLogSummary(log)[0]).toBe("Dragged 카드 to 받은편지함");
  });

  it("drag source-only(포인터 경로)는 'Dragged X (drop target unknown)' — AI 목적지 환각 방지", () => {
    const log = makeActionLog({
      captured: 1,
      entries: [
        makeAction({
          id: "1",
          kind: "drag",
          dragSource: { name: "카드" },
        } as Partial<ActionEntry>),
      ],
    });
    expect(buildActionLogSummary(log)[0]).toBe(
      "Dragged 카드 (drop target unknown)",
    );
  });

  it("drag source 이름이 없으면 selector로 폴백", () => {
    const log = makeActionLog({
      captured: 1,
      entries: [
        makeAction({
          id: "1",
          kind: "drag",
          dragSource: { selector: "div.card" },
        } as Partial<ActionEntry>),
      ],
    });
    expect(buildActionLogSummary(log)[0]).toBe(
      "Dragged div.card (drop target unknown)",
    );
  });

  it("drag source가 name·selector 둘 다 없으면 'element'로 폴백", () => {
    const log = makeActionLog({
      captured: 1,
      entries: [
        makeAction({
          id: "1",
          kind: "drag",
          dragSource: {},
        } as Partial<ActionEntry>),
      ],
    });
    expect(buildActionLogSummary(log)[0]).toBe(
      "Dragged element (drop target unknown)",
    );
  });

  it("drag source name이 공백뿐이면 selector로 폴백 (트레일링 공백 방지)", () => {
    const log = makeActionLog({
      captured: 1,
      entries: [
        makeAction({
          id: "1",
          kind: "drag",
          dragSource: { name: "   ", selector: "div.card" },
        } as Partial<ActionEntry>),
      ],
    });
    expect(buildActionLogSummary(log)[0]).toBe(
      "Dragged div.card (drop target unknown)",
    );
  });

  it("폴백 회귀: drag가 'Clicked'로 새지 않음", () => {
    const log = makeActionLog({
      captured: 1,
      entries: [
        makeAction({
          id: "1",
          kind: "drag",
          dragSource: { name: "카드" },
        } as Partial<ActionEntry>),
      ],
    });
    expect(buildActionLogSummary(log)[0].startsWith("Clicked")).toBe(false);
  });

  it("최근 N개로 제한 (오래된 항목 제외)", () => {
    const entries = Array.from({ length: 30 }, (_, i) =>
      makeAction({ id: String(i), kind: "click", target: `버튼${i}` }),
    );
    const log = makeActionLog({ captured: 30, entries });
    const lines = buildActionLogSummary(log);
    expect(lines.length).toBeLessThan(30);
    expect(lines.join("\n")).toContain("버튼29");
    expect(lines.join("\n")).not.toContain("버튼0\n");
  });
});
