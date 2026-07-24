// 3종 로그(console/network/action)를 절대 ms로 병합하는 순수 모듈. 부수효과·DOM·JSX 없음
// (node 테스트 대상). 스크러버 마커용 markers.ts와 별개 — 이쪽은 원본 엔트리를 참조하는 리스트 아이템.
import type { ConsoleEntry, ConsoleLog } from "@/types/console";
import type { NetworkLog, NetworkRequest } from "@/types/network";
import type { ActionEntry, ActionLog } from "@/types/action";
import { consoleLevelBgClass, TONE_BG } from "@/lib/log-colors";
import { isNetworkError, isNetworkPending } from "@/lib/network-status";
import { requestMatchesQuery } from "@/lib/network-search";
import { actionSearchText } from "@/sidepanel/lib/actionInline";

export type TimelineItem =
  | { kind: "action"; id: string; absTs: number; entry: ActionEntry }
  | { kind: "console"; id: string; absTs: number; entry: ConsoleEntry }
  | { kind: "network"; id: string; absTs: number; req: NetworkRequest };

export type TimelineKind = TimelineItem["kind"];
export type TimelineFilter = "all" | TimelineKind;

// 동일 absTs 타이브레이크 순서: 원인(action) → 요청(network) → 결과(console).
const KIND_ORDER: Record<TimelineKind, number> = { action: 0, network: 1, console: 2 };

// 3종 flatten → absTs 오름차순 안정 정렬. 동일 absTs는 kind 우선순위로 결정론적 정렬.
export function buildTimeline(
  consoleLog: ConsoleLog | null,
  networkLog: NetworkLog | null,
  actionLog: ActionLog | null,
): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const entry of actionLog?.entries ?? []) {
    items.push({ kind: "action", id: entry.id, absTs: entry.timestamp, entry });
  }
  for (const req of networkLog?.requests ?? []) {
    items.push({ kind: "network", id: req.id, absTs: req.startTime, req });
  }
  for (const entry of consoleLog?.entries ?? []) {
    items.push({ kind: "console", id: entry.id, absTs: entry.timestamp, entry });
  }
  // Array.sort는 안정(ES2019+) — 동일 absTs·동일 kind는 원본 입력 순서가 보존된다.
  return items.sort((a, b) => a.absTs - b.absTs || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

// 타입 필터(단일선택, all 포함) + 검색 매칭. query는 raw 문자열, 대소문자 무시.
export function matchesTimelineItem(
  item: TimelineItem,
  filter: TimelineFilter,
  query: string,
): boolean {
  if (filter !== "all" && item.kind !== filter) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  switch (item.kind) {
    case "console": return item.entry.args.toLowerCase().includes(q);
    case "network": return requestMatchesQuery(item.req, q);
    case "action": return actionSearchText(item.entry).includes(q);
  }
}

// 면색 = "문제"만. 기존 로그 탭 배경색과 완전 sync(log-colors 단일 출처 위임).
// console error/warn/info 틴트, network 실패/pending 틴트, action·log·debug·성공은 "".
export function timelineFillClass(item: TimelineItem): string {
  switch (item.kind) {
    case "console": return consoleLevelBgClass(item.entry.level);
    case "network":
      return isNetworkError(item.req) ? TONE_BG.red : isNetworkPending(item.req) ? TONE_BG.amber : "";
    case "action": return "";
  }
}
