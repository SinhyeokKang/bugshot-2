import type { LogViewerData } from "@/types/log-viewer";
import { toVideoSeconds } from "./timeline";

export type MarkerType = "console" | "network" | "action";
export type MarkerVariant = "error" | "warn" | "pending" | "navigate" | "default";

export interface TimelineMarker {
  id: string;
  type: MarkerType;
  variant: MarkerVariant;
  absTs: number;
  positionPct: number;
  label: string;
}

function clamp(min: number, max: number, v: number): number {
  return Math.min(max, Math.max(min, v));
}

function truncEnd(s: string, max: number): string {
  return s.length > max ? s.slice(-max) : s;
}

function truncStart(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

function pct(absTs: number, videoStartedAt: number, videoDurationSec: number): number {
  return clamp(0, 100, (toVideoSeconds(absTs, videoStartedAt) / videoDurationSec) * 100);
}

export function buildMarkers(
  data: LogViewerData,
  activeTab: "console" | "network" | "action",
  videoDurationSec: number,
  videoStartedAt: number,
): TimelineMarker[] {
  if (videoDurationSec <= 0) return [];

  if (activeTab === "console") {
    const log = data.consoleLog;
    if (!log) return [];
    return log.entries
      .filter((e) => e.level === "error" || e.level === "warn")
      .map((e) => ({
        id: e.id,
        type: "console" as const,
        variant: e.level === "error" ? ("error" as const) : ("warn" as const),
        absTs: e.timestamp,
        positionPct: pct(e.timestamp, videoStartedAt, videoDurationSec),
        label: `[${e.level === "error" ? "ERROR" : "WARN"}] ${truncStart(e.args, 80)}`,
      }));
  }

  if (activeTab === "network") {
    const log = data.networkLog;
    if (!log) return [];
    return log.requests
      .filter((r) => r.phase === "error" || r.phase === "pending" || r.status >= 400)
      .map((r) => {
        const isPending = r.phase === "pending";
        const variant: MarkerVariant = isPending ? "pending" : "error";
        const prefix = isPending ? "[Pending]" : `[${r.status}]`;
        return {
          id: r.id,
          type: "network" as const,
          variant,
          absTs: r.startTime,
          positionPct: pct(r.startTime, videoStartedAt, videoDurationSec),
          label: `${prefix} ${r.method} ${truncEnd(r.url, 60)}`,
        };
      });
  }

  // action
  const log = data.actionLog;
  if (!log) return [];
  return log.entries.map((e) => {
    let label: string;
    let variant: MarkerVariant = "default";
    switch (e.kind) {
      case "click":
        label = `Click: ${e.target ?? ""}`;
        break;
      case "navigation":
        variant = "navigate";
        label = `Nav: ${truncEnd(e.toUrl ?? "", 60)}`;
        break;
      case "input":
        label = `Input: ${e.fieldLabel ?? ""}`;
        break;
    }
    return {
      id: e.id,
      type: "action" as const,
      variant,
      absTs: e.timestamp,
      positionPct: pct(e.timestamp, videoStartedAt, videoDurationSec),
      label,
    };
  });
}
