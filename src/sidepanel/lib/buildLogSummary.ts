import type { NetworkLog } from "@/types/network";
import type { ConsoleLog } from "@/types/console";
import type { ActionLog, ActionLogSummary, ActionNode } from "@/types/action";

const MAX_ERRORS = 5;
const MAX_ACTIONS = 20;

export interface NetworkLogSummary {
  captured: number;
  errors: { method: string; path: string; status: number; statusText: string }[];
}

export interface ConsoleLogSummary {
  captured: number;
  errorCount: number;
  warnCount: number;
  topErrors: string[];
}

export function buildNetworkLogSummary(log: NetworkLog): NetworkLogSummary {
  const errors = log.requests
    .filter((r) => r.phase === "error" || r.status >= 400)
    .slice(0, MAX_ERRORS)
    .map((r) => ({
      method: r.method,
      path: extractPath(r.url),
      status: r.status,
      statusText: r.statusText,
    }));
  return { captured: log.captured, errors };
}

export function buildConsoleLogSummary(log: ConsoleLog): ConsoleLogSummary {
  const errorCount = log.entries.filter((e) => e.level === "error").length;
  const warnCount = log.entries.filter((e) => e.level === "warn").length;
  const seen = new Set<string>();
  const topErrors: string[] = [];
  for (const e of log.entries) {
    if (e.level !== "error") continue;
    const msg = firstLine(e.args);
    if (seen.has(msg)) continue;
    seen.add(msg);
    topErrors.push(msg);
    if (topErrors.length >= MAX_ERRORS) break;
  }
  return { captured: log.captured, errorCount, warnCount, topErrors };
}

// 최근 MAX_ACTIONS개 액션을 자연어 줄로. AI 프롬프트 참고 메타용(masked input은 값 *** 그대로).
export function buildActionLogSummary(log: ActionLog): ActionLogSummary {
  return log.entries.slice(-MAX_ACTIONS).map((e) => {
    if (e.kind === "navigation") {
      return `Navigated to: ${e.toUrl ?? ""}`;
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
    return `Clicked: ${e.target ?? e.selector ?? ""}${e.role ? ` (${e.role})` : ""}`;
  });
}

function nodeName(node?: ActionNode): string {
  return node?.name?.trim() || node?.selector || "element";
}

function extractPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function firstLine(text: string): string {
  const idx = text.indexOf("\n");
  const line = idx >= 0 ? text.slice(0, idx) : text;
  return line.length > 120 ? line.slice(0, 117) + "…" : line;
}
