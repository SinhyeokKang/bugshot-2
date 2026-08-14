import { networkLogPath } from "@/lib/network-log-path";
import type { NetworkLog } from "@/types/network";
import type { ConsoleLog } from "@/types/console";
import type { ActionEntry, ActionLog, ActionLogSummary, ActionNode } from "@/types/action";

const MAX_ERRORS = 5;
const MAX_ACTIONS = 20;

// id는 AI 프롬프트에 절대 인쇄하지 않는다 — logRefs 응답을 store 원본으로 되짚는 용도뿐.
export interface NetworkLogSummaryError {
  id: string;
  method: string;
  path: string;
  status: number;
  statusText: string;
}

export interface ConsoleLogSummaryError {
  id: string;
  message: string;
}

export interface NetworkLogSummary {
  captured: number;
  // 전체 에러 건수(비-dedup·비-cap). errors[]는 dedup+MAX_ERRORS cap된 샘플 목록이라
  // 개수 표시엔 부적합 — 콘솔 errorCount와 대칭으로 통짜 count를 별도 제공.
  // buildNetworkLogSummary는 항상 채우지만, 본문 빌더 테스트가 만드는 샘플 리터럴은 안 쓰므로 optional.
  errorCount?: number;
  errors: NetworkLogSummaryError[];
}

export interface ConsoleLogSummary {
  captured: number;
  errorCount: number;
  warnCount: number;
  topErrors: ConsoleLogSummaryError[];
}

export function buildNetworkLogSummary(log: NetworkLog): NetworkLogSummary {
  // dedup(method+path+status)은 캡보다 앞선다 — console과 대칭. 캡 뒤로 밀면 동일요청
  // 반복이 캡을 채워 그 뒤의 distinct 에러가 후보·본문에서 사라진다.
  const seen = new Set<string>();
  const errors: NetworkLogSummaryError[] = [];
  let errorCount = 0;
  for (const r of log.requests) {
    if (!(r.phase === "error" || r.status >= 400)) continue;
    errorCount++;
    const path = networkLogPath(r.url);
    const key = `${r.method} ${path} ${r.status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (errors.length < MAX_ERRORS) {
      errors.push({ id: r.id, method: r.method, path, status: r.status, statusText: r.statusText });
    }
  }
  return { captured: log.captured, errorCount, errors };
}

// 본문 빌더 8개가 "에러 N건"을 인쇄할 때 쓰는 단일 출처. errors[]는 dedup+cap된 표시용
// 샘플이라 개수로 쓰면 심각도가 축소된다(같은 요청이 3번 실패해도 1). errorCount가
// optional인 건 빌더 테스트의 샘플 리터럴이 안 채우기 때문이라 폴백을 여기서 흡수한다 —
// 8곳에 `?? errors.length`를 복붙하면 그게 다음 드리프트 씨앗이다(POSTMORTEM 2026-08-06).
export function networkErrorCount(net: NetworkLogSummary): number {
  return net.errorCount ?? net.errors.length;
}

export function buildConsoleLogSummary(log: ConsoleLog): ConsoleLogSummary {
  const errorCount = log.entries.filter((e) => e.level === "error").length;
  const warnCount = log.entries.filter((e) => e.level === "warn").length;
  const seen = new Set<string>();
  const topErrors: ConsoleLogSummaryError[] = [];
  for (const e of log.entries) {
    if (e.level !== "error") continue;
    const msg = firstLine(e.args);
    if (seen.has(msg)) continue;
    seen.add(msg);
    topErrors.push({ id: e.id, message: msg });
    if (topErrors.length >= MAX_ERRORS) break;
  }
  return { captured: log.captured, errorCount, warnCount, topErrors };
}

// 이 함수는 로케일 무관 영어 고정이 기존 규칙이라 i18n을 끌어오지 않는다.
// Map인 이유는 ActionLogContent.NAV_ICON과 같다 — navType은 페이지가 위조할 수 있고, 객체
// 리터럴이면 "constructor"가 함수 소스로 보간돼 LLM 프롬프트를 오염시킨다(`??`로는 못 막는다).
const NAV_VERB_EN = new Map<NonNullable<ActionEntry["navType"]>, string>([
  ["back", "Went back to"],
  ["forward", "Went forward to"],
  ["reload", "Reloaded"],
  ["traverse", "Navigated via history to"],
]);

// 최근 MAX_ACTIONS개 액션을 자연어 줄로. AI 프롬프트 참고 메타용(masked input은 값 *** 그대로).
export function buildActionLogSummary(log: ActionLog): ActionLogSummary {
  return log.entries.slice(-MAX_ACTIONS).map((e) => {
    if (e.kind === "navigation") {
      return `${(e.navType && NAV_VERB_EN.get(e.navType)) || "Navigated to"}: ${e.toUrl ?? ""}`;
    }
    if (e.kind === "input") {
      return `Typed in "${e.fieldLabel ?? ""}": "${e.value ?? ""}"`;
    }
    if (e.kind === "keypress") {
      return `Pressed: ${e.value ?? ""}`;
    }
    if (e.kind === "toggle") {
      return `Toggled "${e.fieldLabel ?? ""}": ${e.value ?? ""}`;
    }
    if (e.kind === "select") {
      return `Selected "${e.value ?? ""}" in "${e.fieldLabel ?? ""}"`;
    }
    if (e.kind === "drag") {
      const src = nodeName(e.dragSource);
      // source-only는 (drop target unknown) 신뢰 신호 — LLM이 목적지를 환각하지 못하게.
      return e.dragTarget
        ? `Dragged ${src} to ${nodeName(e.dragTarget)}`
        : `Dragged ${src} (drop target unknown)`;
    }
    if (e.kind === "click") {
      return `Clicked: ${e.target ?? e.selector ?? ""}${e.role ? ` (${e.role})` : ""}`;
    }
    // ActionEntryKind에 kind를 추가하면 여기서 컴파일 에러가 난다. 무조건 fallback이던
    // 시절엔 새 kind가 전부 "Clicked: "로 라벨링돼 useReproPrefill을 타고 LLM 프롬프트로
    // 나가면서 사실과 다른 재현 단계가 자동 삽입됐다.
    const _exhaustive: never = e.kind;
    return `${String(_exhaustive)}: ${e.target ?? e.selector ?? ""}`;
  });
}

function nodeName(node?: ActionNode): string {
  return node?.name?.trim() || node?.selector || "element";
}

function firstLine(text: string): string {
  const idx = text.indexOf("\n");
  const line = idx >= 0 ? text.slice(0, idx) : text;
  return line.length > 120 ? line.slice(0, 117) + "…" : line;
}
