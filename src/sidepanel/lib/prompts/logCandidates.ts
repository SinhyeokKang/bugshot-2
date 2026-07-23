import type {
  NetworkLogSummaryError,
  ConsoleLogSummaryError,
} from "../buildLogSummary";
import { extractPath } from "../buildLogSummary";
// buildAiDraftPrompt가 getDraftFewShot에서 이 모듈을 값 참조한다 — 값 import는 순환.
import type { AiDraftSessionContext } from "../buildAiDraftPrompt";
import type { NetworkRequest } from "@/types/network";
import { requestMatchesQuery } from "@/lib/network-search";
import { supportsConsoleNetworkLog } from "../captureLogSupport";
import { PROMPT_CAPS } from "./caps";
import { tokenizeUserQuery, type QueryTerm, type QueryTier } from "./queryTokens";
import { digestResponseShape } from "./responseDigest";

export type LogCandidateKind = "network" | "console";

// 근거 없는 시작값 — dogfooding 조정 대상.
const MATCHED_CAP = 3;
const OVERMATCH_CEIL = 8; // term당 매칭 초과 시 폐기(노이즈)

export interface NetworkLogCandidate extends NetworkLogSummaryError {
  ref: string; // "n1"…
}
export interface ConsoleLogCandidate extends ConsoleLogSummaryError {
  ref: string; // "c1"…
}
export interface MatchedLogCandidate {
  ref: string; // "m1"…
  id: string; // 원본 NetworkRequest.id
  method: string;
  path: string; // extractPath(r.url) 파생
  status: number; // 2xx만
  matchedTerm: string; // 인쇄용 provenance(최고 tier term)
  digest?: string; // shape 다이제스트(json만; 없으면 provenance만)
}

export interface LogCandidates {
  network: NetworkLogCandidate[];
  console: ConsoleLogCandidate[];
  matched: MatchedLogCandidate[];
}

// 프롬프트에 실제로 인쇄될 후보의 단일 출처. 프롬프트 인쇄·스키마 enum·응답 해석이 전부
// 이 집합에서 파생돼야 "모델이 본 적 없는 로그"가 본문에 들어갈 틈이 없다.
// ref는 게이트·dedup·캡을 전부 통과한 뒤 부여한다 — 요약 단계에서 매기면 인쇄되지 않은
// 번호(n5)가 실재하는 ref가 된다.
export function selectLogCandidates(ctx: AiDraftSessionContext): LogCandidates {
  if (!supportsConsoleNetworkLog(ctx.captureMode)) {
    return { network: [], console: [], matched: [] };
  }
  const caps = PROMPT_CAPS[ctx.caps.promptStyle];

  // dedup은 buildNetworkLogSummary(캡 앞)가 이미 했다 — 여기선 console과 대칭으로 캡·ref만.
  const network = (ctx.networkLogSummary?.errors ?? [])
    .slice(0, caps.networkErrors)
    .map((e, i) => ({ ...e, ref: `n${i + 1}` }));

  const consoleCands = (ctx.consoleLogSummary?.topErrors ?? [])
    .slice(0, caps.consoleErrors)
    .map((e, i) => ({ ...e, ref: `c${i + 1}` }));

  // 매칭 200 후보는 rich 전용 + full requests가 배선됐을 때만. 에러 후보 id는 excludeIds로
  // 넘겨 중복 인쇄를 막는다(status 2xx 필터상 실제 겹침은 드물지만 방어적).
  let matched: MatchedLogCandidate[] = [];
  if (ctx.caps.promptStyle === "rich" && ctx.requests && ctx.requests.length > 0) {
    const terms = tokenizeUserQuery(matchSources(ctx));
    const excludeIds = new Set(network.map((n) => n.id));
    matched = selectMatchedLogCandidates(terms, ctx.requests, excludeIds, MATCHED_CAP);
  }

  return { network, console: consoleCands, matched };
}

// 매칭 term 소스 — 유저 텍스트에 국한하지 않고 캡처 신호(콘솔 에러·액션·selector)까지.
function matchSources(ctx: AiDraftSessionContext): string[] {
  const sources: string[] = [];
  if (ctx.userPrompt) sources.push(ctx.userPrompt);
  if (ctx.existingDraft) {
    sources.push(ctx.existingDraft.title);
    sources.push(...Object.values(ctx.existingDraft.sections));
  }
  for (const e of ctx.consoleLogSummary?.topErrors ?? []) sources.push(e.message);
  if (ctx.actionLogSummary) sources.push(...ctx.actionLogSummary);
  if (ctx.selector) sources.push(ctx.selector);
  if (ctx.tagName) sources.push(ctx.tagName);
  return sources;
}

const TIER_RANK: Record<QueryTier, number> = { quoted: 3, ident: 2, word: 1 };

export function selectMatchedLogCandidates(
  terms: QueryTerm[],
  requests: NetworkRequest[],
  excludeIds: Set<string>,
  cap: number,
): MatchedLogCandidate[] {
  if (terms.length === 0) return [];
  const pop = requests.filter(
    (r) =>
      !r.webSocket &&
      r.phase === "complete" &&
      r.status >= 200 &&
      r.status < 300 &&
      !excludeIds.has(r.id),
  );
  if (pop.length === 0) return [];

  const agg = new Map<
    string,
    { req: NetworkRequest; topTier: number; hits: Set<string>; term: string; termRank: number }
  >();

  for (const t of terms) {
    if (!t.term) continue; // 빈 term은 requestMatchesQuery를 전 요청 매칭시킨다 — skip
    const hitReqs = pop.filter((r) => requestMatchesQuery(r, t.term));
    if (hitReqs.length === 0 || hitReqs.length > OVERMATCH_CEIL) continue;
    const rank = TIER_RANK[t.tier];
    for (const r of hitReqs) {
      const cur = agg.get(r.id);
      if (!cur) {
        agg.set(r.id, { req: r, topTier: rank, hits: new Set([t.term]), term: t.term, termRank: rank });
      } else {
        cur.hits.add(t.term);
        if (rank > cur.topTier) cur.topTier = rank;
        if (rank > cur.termRank) {
          cur.termRank = rank;
          cur.term = t.term;
        }
      }
    }
  }

  return [...agg.values()]
    .sort(
      (a, b) =>
        b.topTier - a.topTier ||
        b.hits.size - a.hits.size ||
        b.req.startTime - a.req.startTime,
    )
    .slice(0, cap)
    .map((e, i) => ({
      ref: `m${i + 1}`,
      id: e.req.id,
      method: e.req.method,
      path: extractPath(e.req.url),
      status: e.req.status,
      matchedTerm: e.term,
      digest: digestResponseShape(e.req.responseBody, e.req.contentType),
    }));
}

export function candidateRefs(c: LogCandidates): string[] {
  return [...c.network, ...c.console, ...c.matched].map((x) => x.ref);
}

// 블록은 description 고정 — 그 섹션이 비활성이면 logRefs를 요청하지 않는다(스키마·지시·
// few-shot 모두). 후보 줄 자체는 에러 컨텍스트로 계속 인쇄된다. 프롬프트 지시와 스키마가
// 이 판정을 각자 하면 어긋난다 — 단일 출처.
export function canRequestLogRefs(
  ctx: AiDraftSessionContext,
  c: LogCandidates,
): boolean {
  return (
    (c.network.length > 0 || c.console.length > 0 || c.matched.length > 0) &&
    ctx.enabledSections.some((s) => s.id === "description")
  );
}

export function findCandidate(
  c: LogCandidates,
  ref: string,
): { id: string; kind: LogCandidateKind } | undefined {
  // BYOK는 enum이 강제되지 않아 "N1"처럼 대문자로 올 수 있다 — ref는 항상 소문자로 부여된다.
  const norm = ref.toLowerCase();
  const net = c.network.find((x) => x.ref === norm);
  if (net) return { id: net.id, kind: "network" };
  const con = c.console.find((x) => x.ref === norm);
  if (con) return { id: con.id, kind: "console" };
  // 매칭 후보(m*)는 원본 NetworkRequest라 network kind로 되짚는다 — renderLogRefBlocks가
  // src.requests에서 id 매칭 → serializeNetworkRequest(원문 삽입)까지 자동.
  const mat = c.matched.find((x) => x.ref === norm);
  if (mat) return { id: mat.id, kind: "network" };
  return undefined;
}
