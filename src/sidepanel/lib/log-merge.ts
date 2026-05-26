import type { NetworkLog, NetworkRequest } from "@/types/network";
import type { ConsoleLog, ConsoleEntry } from "@/types/console";
import type { EditorPhase } from "@/store/editor-store";
import { FROZEN_PHASES } from "@/lib/session-keys";

export const NETWORK_MAX_ENTRIES = 5000;
export const CONSOLE_MAX_ENTRIES = 2000;

// id 기준 dedup(incoming이 갱신본으로 덮어씀, 위치는 기존 순서 유지) → getTime 오름차순 안정 정렬
// → maxEntries 초과 시 oldest 제거.
export function mergeLogItems<T extends { id: string }>(
  existing: T[],
  incoming: T[],
  getTime: (item: T) => number,
  maxEntries: number,
): T[] {
  const byId = new Map<string, T>();
  for (const item of existing) byId.set(item.id, item);
  for (const item of incoming) byId.set(item.id, item);
  const merged = Array.from(byId.values());
  merged.sort((a, b) => getTime(a) - getTime(b));
  if (merged.length > maxEntries) {
    return merged.slice(merged.length - maxEntries);
  }
  return merged;
}

// lower <= getTime(item) <= upper 필터. upper 생략 시 하한만.
export function trimByTime<T>(
  items: T[],
  getTime: (item: T) => number,
  lower: number,
  upper?: number,
): T[] {
  return items.filter((item) => {
    const t = getTime(item);
    if (t < lower) return false;
    if (upper !== undefined && t > upper) return false;
    return true;
  });
}

export function rebuildNetworkLog(
  existing: NetworkLog | null,
  merged: NetworkRequest[],
  incoming: { totalSeen: number; warnings: NetworkLog["warnings"] },
): NetworkLog {
  const now = Date.now();
  const warnings = Array.from(
    new Set([...(existing?.warnings ?? []), ...incoming.warnings]),
  );
  return {
    id: existing?.id ?? crypto.randomUUID(),
    startedAt: merged.length > 0 ? merged[0].startTime : now,
    endedAt: now,
    totalSeen: Math.max(existing?.totalSeen ?? 0, incoming.totalSeen, merged.length),
    captured: merged.length,
    warnings,
    requests: merged,
  };
}

export function rebuildConsoleLog(
  existing: ConsoleLog | null,
  merged: ConsoleEntry[],
  incoming: { totalSeen: number },
): ConsoleLog {
  const now = Date.now();
  return {
    id: existing?.id ?? crypto.randomUUID(),
    startedAt: merged.length > 0 ? merged[0].timestamp : now,
    endedAt: now,
    totalSeen: Math.max(existing?.totalSeen ?? 0, incoming.totalSeen, merged.length),
    captured: merged.length,
    entries: merged,
  };
}

// drafting 이후 단계는 캡처된 자산을 편집·확인·제출 중 — 지연 sync가 첨부 로그를 흔들지 않도록 머지 동결.
export function isLogFrozen(phase: EditorPhase): boolean {
  return FROZEN_PHASES.has(phase);
}
