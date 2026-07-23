import { describe, it, expect } from "vitest";
import {
  selectLogCandidates,
  selectMatchedLogCandidates,
  candidateRefs,
  findCandidate,
  canRequestLogRefs,
} from "../logCandidates";
import type { QueryTerm } from "../queryTokens";
import { BYOK_CAPABILITIES, NANO_CAPABILITIES } from "../../ai-provider";
import type { AiDraftSessionContext } from "../../buildAiDraftPrompt";
import type {
  NetworkLogSummaryError,
  ConsoleLogSummaryError,
} from "../../buildLogSummary";
import type { NetworkRequest } from "@/types/network";

function word(term: string): QueryTerm {
  return { term, tier: "word" };
}
function makeReq(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: "r1",
    url: "https://shop.example.com/api/orders?page=1",
    method: "GET",
    status: 200,
    statusText: "OK",
    startTime: 1000,
    durationMs: 20,
    requestHeaders: {},
    responseHeaders: {},
    pageUrl: "",
    requestBodySize: 0,
    responseBodySize: 0,
    contentType: "application/json",
    phase: "complete",
    responseBody: '{"orderStatus":"SHIPPED","items":[]}',
    ...overrides,
  };
}

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
      errorCount: netCount,
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

describe("selectMatchedLogCandidates — 200 매칭 후보", () => {
  it("term이 200 응답 본문에 매칭 → 후보 1개 (matchedTerm·ref·digest·path)", () => {
    const out = selectMatchedLogCandidates([word("orderstatus")], [makeReq()], new Set(), 3);
    expect(out).toHaveLength(1);
    expect(out[0].ref).toBe("m1");
    expect(out[0].matchedTerm).toBe("orderstatus");
    expect(out[0].status).toBe(200);
    expect(out[0].path).toBe("/api/orders"); // extractPath(url) — 쿼리 스트립
    expect(out[0].digest).toContain("orderStatus:str"); // 키 이름은 원형 유지
    expect(out[0].digest).not.toContain("SHIPPED"); // 값 부재
  });

  it("OVERMATCH_CEIL(8) 초과 term은 후보에 기여 안 함", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      makeReq({ id: `a${i}`, url: `https://x.test/api/${i}`, responseBody: "{}" }),
    );
    expect(selectMatchedLogCandidates([word("api")], many, new Set(), 3)).toEqual([]);
  });

  it("excludeIds·WebSocket·비-complete·비-2xx 제외", () => {
    const t = [word("orderstatus")];
    expect(selectMatchedLogCandidates(t, [makeReq({ id: "r1" })], new Set(["r1"]), 3)).toEqual([]);
    expect(
      selectMatchedLogCandidates(t, [makeReq({ webSocket: { protocol: "", frames: [], framesTotal: 0 } })], new Set(), 3),
    ).toEqual([]);
    expect(selectMatchedLogCandidates(t, [makeReq({ phase: "pending" })], new Set(), 3)).toEqual([]);
    expect(selectMatchedLogCandidates(t, [makeReq({ status: 404 })], new Set(), 3)).toEqual([]);
    expect(selectMatchedLogCandidates(t, [makeReq({ status: 302 })], new Set(), 3)).toEqual([]);
  });

  it("랭킹: distinct term 히트 수 우선 (2히트 > 1히트)", () => {
    const a = makeReq({ id: "a", responseBody: '{"orderStatus":1,"refund":true}', startTime: 1000 });
    const b = makeReq({ id: "b", responseBody: '{"orderStatus":1}', startTime: 5000 });
    const out = selectMatchedLogCandidates([word("orderstatus"), word("refund")], [a, b], new Set(), 3);
    expect(out[0].id).toBe("a");
  });

  it("랭킹: tier 우선 (quoted > word)", () => {
    const a = makeReq({ id: "a", responseBody: '{"orderStatus":1}' });
    const b = makeReq({ id: "b", responseBody: '{"ord-1":1}' });
    const terms: QueryTerm[] = [word("orderstatus"), { term: "ord-1", tier: "quoted" }];
    const out = selectMatchedLogCandidates(terms, [a, b], new Set(), 3);
    expect(out[0].id).toBe("b");
  });

  it("cap 초과분 절삭 + ref m1.. 연속·유일", () => {
    const reqs = Array.from({ length: 3 }, (_, i) =>
      makeReq({ id: `r${i}`, responseBody: '{"orderStatus":1}', startTime: 1000 + i }),
    );
    const out = selectMatchedLogCandidates([word("orderstatus")], reqs, new Set(), 2);
    expect(out).toHaveLength(2);
    expect(out.map((m) => m.ref)).toEqual(["m1", "m2"]);
  });

  it("non-json 200 → 매칭되나 digest 미부착", () => {
    const req = makeReq({ contentType: "text/plain", responseBody: "orderStatus here" });
    const out = selectMatchedLogCandidates([word("orderstatus")], [req], new Set(), 3);
    expect(out).toHaveLength(1);
    expect(out[0].digest).toBeUndefined();
  });

  it("terms=[] → []", () => {
    expect(selectMatchedLogCandidates([], [makeReq()], new Set(), 3)).toEqual([]);
  });

  it("빈 term 섞여도 전 요청 오매칭 없이 skip", () => {
    const out = selectMatchedLogCandidates([word("")], [makeReq(), makeReq({ id: "r2" })], new Set(), 3);
    expect(out).toEqual([]);
  });
});

describe("selectLogCandidates — matched 편입 (rich 게이트)", () => {
  function richCtx(overrides: Partial<AiDraftSessionContext> = {}): AiDraftSessionContext {
    return makeCtx({
      userPrompt: "주문 목록에서 orderStatus 매핑이 이상해요",
      requests: [makeReq()],
      ...overrides,
    });
  }

  it("rich + requests + 매칭 소스 → matched 채워짐 (ref m1)", () => {
    const c = selectLogCandidates(richCtx());
    expect(c.matched).toHaveLength(1);
    expect(c.matched[0].ref).toBe("m1");
  });

  it("compact → matched []", () => {
    const c = selectLogCandidates(richCtx({ caps: NANO_CAPABILITIES }));
    expect(c.matched).toEqual([]);
  });

  it("ctx.requests 없음 → matched []", () => {
    const c = selectLogCandidates(makeCtx({ userPrompt: "orderStatus" }));
    expect(c.matched).toEqual([]);
  });

  it("candidateRefs에 m* 포함", () => {
    const c = selectLogCandidates(richCtx());
    expect(candidateRefs(c)).toContain("m1");
  });

  it("findCandidate(M1) → network kind (대소문자 무시)", () => {
    const c = selectLogCandidates(richCtx());
    expect(findCandidate(c, "m1")).toEqual({ id: "r1", kind: "network" });
    expect(findCandidate(c, "M1")).toEqual({ id: "r1", kind: "network" });
  });

  it("canRequestLogRefs: matched만 있어도 true (description 활성)", () => {
    const c = selectLogCandidates(richCtx());
    expect(c.network).toEqual([]);
    expect(c.console).toEqual([]);
    expect(canRequestLogRefs(richCtx(), c)).toBe(true);
  });
});
