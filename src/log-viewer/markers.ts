import type { LogViewerData } from "@/types/log-viewer";
import { toVideoSeconds } from "./timeline";
import { t } from "./i18n";

export type MarkerType = "console" | "network" | "action";
export type MarkerVariant = "error" | "warn" | "info" | "pending" | "navigate" | "default";

export interface LabelPart {
  text: string;
  className?: string;
}

export interface TimelineMarker {
  id: string;
  type: MarkerType;
  variant: MarkerVariant;
  absTs: number;
  positionPct: number;
  label: string;
  labelParts: LabelPart[];
}

function clamp(min: number, max: number, v: number): number {
  return Math.min(max, Math.max(min, v));
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
    const LEVEL_VARIANT: Record<string, MarkerVariant> = {
      error: "error", warn: "warn", info: "info",
    };
    const LEVEL_COLOR: Record<string, string> = {
      error: "text-red-600", warn: "text-amber-600",
      info: "text-blue-600", debug: "text-gray-500", log: "text-gray-500",
    };
    return log.entries.map((e) => {
      const tag = e.level.toUpperCase();
      return {
        id: e.id,
        type: "console" as const,
        variant: LEVEL_VARIANT[e.level] ?? ("default" as const),
        absTs: e.timestamp,
        positionPct: pct(e.timestamp, videoStartedAt, videoDurationSec),
        label: `[${tag}] ${e.args}`,
        labelParts: [
          { text: tag, className: LEVEL_COLOR[e.level] ?? "text-gray-500" },
          { text: "\n" },
          { text: e.args },
        ],
      };
    });
  }

  if (activeTab === "network") {
    const log = data.networkLog;
    if (!log) return [];
    const METHOD_COLOR: Record<string, string> = {
      GET: "text-blue-600", POST: "text-green-600", PUT: "text-amber-600",
      PATCH: "text-amber-600", DELETE: "text-red-600",
    };
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
          label: `${prefix} ${r.method} ${r.url}`,
          labelParts: [
            { text: isPending ? "Pending" : String(r.status), className: isPending ? "text-amber-600" : "text-red-600" },
            { text: "\n" },
            { text: r.method, className: METHOD_COLOR[r.method] ?? "text-violet-600" },
            { text: "\n" },
            { text: r.url },
          ],
        };
      });
  }

  // action
  const log = data.actionLog;
  if (!log) return [];
  return log.entries.map((e) => {
    let label: string;
    let labelParts: LabelPart[];
    let variant: MarkerVariant = "default";
    switch (e.kind) {
      case "click": {
        const name = e.target ?? e.selector ?? "";
        const roleKey = e.role ? `actionLog.role.${e.role}` : "";
        const rw = roleKey ? t(roleKey) : "";
        const target = rw && rw !== roleKey ? `"${name}" ${rw}` : `"${name}"`;
        label = t("actionLog.verb.click", { target });
        labelParts = [{ text: label }];
        break;
      }
      case "navigation": {
        variant = "navigate";
        label = t("actionLog.verb.navigate", { target: e.toUrl ?? "" });
        labelParts = [{ text: label, className: "text-blue-600" }];
        break;
      }
      case "input": {
        const field = `"${e.fieldLabel ?? e.selector ?? ""}"`;
        const value = e.masked ? "[********]" : `"${e.value ?? ""}"`;
        label = t("actionLog.verb.input", { field, value });
        labelParts = [{ text: label }];
        break;
      }
      default: { e.kind satisfies never; label = ""; labelParts = []; }
    }
    return {
      id: e.id,
      type: "action" as const,
      variant,
      absTs: e.timestamp,
      positionPct: pct(e.timestamp, videoStartedAt, videoDurationSec),
      label,
      labelParts,
    };
  });
}
