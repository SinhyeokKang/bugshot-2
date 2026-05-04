import type { NetworkLog } from "@/types/network";
import type { ConsoleLog } from "@/types/console";

const MAX_ERRORS = 5;

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
    .filter((r) => r.status >= 400)
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
