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

// network dedup은 buildNetworkLogSummary(캡 앞)로 이관 — 그쪽 테스트가 잠근다.
// selectLogCandidates는 console과 대칭으로 캡·ref 부여만 한다.

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

  // BYOK는 스키마 enum이 강제되지 않아 모델이 "N1"처럼 대문자로 답할 수 있다 — 조용히 드랍 대신 회수.
  it("findCandidate: 대소문자 무시 (N1 → n1 후보)", () => {
    const c = selectLogCandidates(withLogs(1, 1));
    expect(findCandidate(c, "N1")).toEqual({ id: netErr(0).id, kind: "network" });
    expect(findCandidate(c, "C1")).toEqual({ id: conErr(0).id, kind: "console" });
  });
});
