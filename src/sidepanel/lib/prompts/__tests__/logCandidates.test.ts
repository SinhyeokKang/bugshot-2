import { describe, it, expect } from "vitest";
import {
  selectLogCandidates,
  candidateRefs,
  findCandidate,
} from "../logCandidates";
import { BYOK_CAPABILITIES, NANO_CAPABILITIES } from "../../ai-provider";
import type { AiDraftSessionContext } from "../../buildAiDraftPrompt";
import type {
  NetworkLogSummaryError,
  ConsoleLogSummaryError,
} from "../../buildLogSummary";

function netErr(i: number, overrides: Partial<NetworkLogSummaryError> = {}): NetworkLogSummaryError {
  return {
    id: `nr-1700000000000-${i}`,
    method: "GET",
    path: `/api/e${i}`,
    status: 500,
    statusText: "Internal Server Error",
    ...overrides,
  };
}

function conErr(i: number, overrides: Partial<ConsoleLogSummaryError> = {}): ConsoleLogSummaryError {
  return {
    id: `cl-1700000000000-${i}`,
    message: `TypeError: boom ${i}`,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<AiDraftSessionContext> = {}): AiDraftSessionContext {
  return {
    caps: BYOK_CAPABILITIES,
    captureMode: "video",
    locale: "ko",
    url: "https://example.com/page",
    pageTitle: "Example Page",
    enabledSections: [{ id: "description" }],
    ...overrides,
  };
}

function withLogs(
  netCount: number,
  conCount: number,
  overrides: Partial<AiDraftSessionContext> = {},
): AiDraftSessionContext {
  return makeCtx({
    networkLogSummary: {
      captured: netCount,
      errors: Array.from({ length: netCount }, (_, i) => netErr(i)),
    },
    consoleLogSummary: {
      captured: conCount,
      errorCount: conCount,
      warnCount: 0,
      topErrors: Array.from({ length: conCount }, (_, i) => conErr(i)),
    },
    ...overrides,
  });
}

describe("selectLogCandidates — 캡·게이트", () => {
  it("compact: kind별 캡 3/3 (합계 6)", () => {
    const c = selectLogCandidates(withLogs(5, 5, { caps: NANO_CAPABILITIES }));
    expect(c.network).toHaveLength(3);
    expect(c.console).toHaveLength(3);
  });

  it("rich: kind별 캡 5/5", () => {
    const c = selectLogCandidates(withLogs(5, 5));
    expect(c.network).toHaveLength(5);
    expect(c.console).toHaveLength(5);
  });

  it("ref는 필터·캡 통과 후 부여 — 연속·유일 (n1.., c1..)", () => {
    const c = selectLogCandidates(withLogs(5, 5, { caps: NANO_CAPABILITIES }));
    expect(c.network.map((x) => x.ref)).toEqual(["n1", "n2", "n3"]);
    expect(c.console.map((x) => x.ref)).toEqual(["c1", "c2", "c3"]);
  });

  it("element 모드 → 빈 후보 (supportsConsoleNetworkLog 게이트)", () => {
    const c = selectLogCandidates(withLogs(3, 3, { captureMode: "element" }));
    expect(c.network).toEqual([]);
    expect(c.console).toEqual([]);
  });

  it("요약이 없으면 빈 후보", () => {
    const c = selectLogCandidates(makeCtx());
    expect(c.network).toEqual([]);
    expect(c.console).toEqual([]);
  });

  it("warn-only console → 양 스타일 모두 빈 후보 (배열 길이로만 판정)", () => {
    for (const caps of [NANO_CAPABILITIES, BYOK_CAPABILITIES]) {
      const c = selectLogCandidates(
        makeCtx({
          caps,
          consoleLogSummary: {
            captured: 3,
            errorCount: 0,
            warnCount: 3,
            topErrors: [],
          },
        }),
      );
      expect(c.console).toEqual([]);
    }
  });
});

describe("selectLogCandidates — network dedup", () => {
  it("같은 method+path+status × 5 → 후보 1개 (첫 발생 id 고정)", () => {
    const c = selectLogCandidates(
      makeCtx({
        networkLogSummary: {
          captured: 5,
          errors: Array.from({ length: 5 }, (_, i) =>
            netErr(i, { method: "POST", path: "/api/pay", status: 500 }),
          ),
        },
      }),
    );
    expect(c.network).toHaveLength(1);
    expect(c.network[0].id).toBe(netErr(0).id);
  });

  it("status가 다르면 같은 엔드포인트라도 별개 후보", () => {
    const c = selectLogCandidates(
      makeCtx({
        networkLogSummary: {
          captured: 2,
          errors: [
            netErr(0, { path: "/api/pay", status: 500 }),
            netErr(1, { path: "/api/pay", status: 404, statusText: "Not Found" }),
          ],
        },
      }),
    );
    expect(c.network).toHaveLength(2);
  });

  it("dedup 후에도 ref 번호는 연속 (n1, n2 — 구멍 없음)", () => {
    const c = selectLogCandidates(
      makeCtx({
        networkLogSummary: {
          captured: 3,
          errors: [
            netErr(0, { path: "/api/pay" }),
            netErr(1, { path: "/api/pay" }),
            netErr(2, { path: "/api/user" }),
          ],
        },
      }),
    );
    expect(c.network.map((x) => x.ref)).toEqual(["n1", "n2"]);
  });
});

describe("candidateRefs / findCandidate", () => {
  it("candidateRefs는 인쇄될 ref 전체를 반환", () => {
    const c = selectLogCandidates(withLogs(2, 1));
    expect(candidateRefs(c)).toEqual(["n1", "n2", "c1"]);
  });

  it("findCandidate: 실재 ref → 원본 id + kind", () => {
    const c = selectLogCandidates(withLogs(1, 1));
    expect(findCandidate(c, "n1")).toEqual({ id: netErr(0).id, kind: "network" });
    expect(findCandidate(c, "c1")).toEqual({ id: conErr(0).id, kind: "console" });
  });

  it("findCandidate: 미지 ref → undefined", () => {
    const c = selectLogCandidates(withLogs(1, 1));
    expect(findCandidate(c, "n9")).toBeUndefined();
    expect(findCandidate(c, "x1")).toBeUndefined();
  });
});
