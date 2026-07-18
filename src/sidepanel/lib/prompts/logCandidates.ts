import type {
  NetworkLogSummaryError,
  ConsoleLogSummaryError,
} from "../buildLogSummary";
// buildAiDraftPrompt가 getDraftFewShot에서 이 모듈을 값 참조한다 — 값 import는 순환.
import type { AiDraftSessionContext } from "../buildAiDraftPrompt";
import { supportsConsoleNetworkLog } from "../captureLogSupport";
import { PROMPT_CAPS } from "./caps";

export type LogCandidateKind = "network" | "console";

export interface NetworkLogCandidate extends NetworkLogSummaryError {
  ref: string; // "n1"…
}
export interface ConsoleLogCandidate extends ConsoleLogSummaryError {
  ref: string; // "c1"…
}

export interface LogCandidates {
  network: NetworkLogCandidate[];
  console: ConsoleLogCandidate[];
}

// 프롬프트에 실제로 인쇄될 후보의 단일 출처. 프롬프트 인쇄·스키마 enum·응답 해석이 전부
// 이 집합에서 파생돼야 "모델이 본 적 없는 로그"가 본문에 들어갈 틈이 없다.
// ref는 게이트·dedup·캡을 전부 통과한 뒤 부여한다 — 요약 단계에서 매기면 인쇄되지 않은
// 번호(n5)가 실재하는 ref가 된다.
export function selectLogCandidates(ctx: AiDraftSessionContext): LogCandidates {
  if (!supportsConsoleNetworkLog(ctx.captureMode)) {
    return { network: [], console: [] };
  }
  const caps = PROMPT_CAPS[ctx.caps.promptStyle];

  const seen = new Set<string>();
  const network: NetworkLogCandidate[] = [];
  for (const e of ctx.networkLogSummary?.errors ?? []) {
    const key = `${e.method} ${e.path} ${e.status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    network.push({ ...e, ref: `n${network.length + 1}` });
    if (network.length >= caps.networkErrors) break;
  }

  const console = (ctx.consoleLogSummary?.topErrors ?? [])
    .slice(0, caps.consoleErrors)
    .map((e, i) => ({ ...e, ref: `c${i + 1}` }));

  return { network, console };
}

export function candidateRefs(c: LogCandidates): string[] {
  return [...c.network, ...c.console].map((x) => x.ref);
}

// 블록은 description 고정 — 그 섹션이 비활성이면 logRefs를 요청하지 않는다(스키마·지시·
// few-shot 모두). 후보 줄 자체는 에러 컨텍스트로 계속 인쇄된다. 프롬프트 지시와 스키마가
// 이 판정을 각자 하면 어긋난다 — 단일 출처.
export function canRequestLogRefs(
  ctx: AiDraftSessionContext,
  c: LogCandidates,
): boolean {
  return (
    (c.network.length > 0 || c.console.length > 0) &&
    ctx.enabledSections.some((s) => s.id === "description")
  );
}

export function findCandidate(
  c: LogCandidates,
  ref: string,
): { id: string; kind: LogCandidateKind } | undefined {
  const net = c.network.find((x) => x.ref === ref);
  if (net) return { id: net.id, kind: "network" };
  const con = c.console.find((x) => x.ref === ref);
  if (con) return { id: con.id, kind: "console" };
  return undefined;
}
