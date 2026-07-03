import type { LogViewerData } from "@/types/log-viewer";
import type { ActionNode } from "@/types/action";
import { toVideoSeconds } from "./timeline";
import { t } from "./i18n";
import { TONE_TEXT, consoleLevelTextClass, networkMethodTextClass } from "@/lib/log-colors";
import { splitTemplate } from "@/sidepanel/lib/actionInline";

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

function dragNodeText(node?: ActionNode): string {
  return node?.name?.trim() || node?.selector || "";
}

function pct(absTs: number, videoStartedAt: number, videoDurationSec: number): number {
  return clamp(0, 100, (toVideoSeconds(absTs, videoStartedAt) / videoDurationSec) * 100);
}

export function buildMarkers(
  data: Pick<LogViewerData, "consoleLog" | "networkLog" | "actionLog">,
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
          { text: tag, className: consoleLevelTextClass(e.level) },
          { text: "\n" },
          { text: e.args },
        ],
      };
    });
  }

  if (activeTab === "network") {
    const log = data.networkLog;
    if (!log) return [];
    return log.requests
      .filter((r) => r.phase === "error" || r.phase === "pending" || r.status >= 400)
      .map((r) => {
        const isPending = r.phase === "pending";
        const variant: MarkerVariant = isPending ? "pending" : "error";
        const pendingLabel = t("networkLog.marker.pending");
        const prefix = isPending ? `[${pendingLabel}]` : `[${r.status}]`;
        return {
          id: r.id,
          type: "network" as const,
          variant,
          absTs: r.startTime,
          positionPct: pct(r.startTime, videoStartedAt, videoDurationSec),
          label: `${prefix} ${r.method} ${r.url}`,
          labelParts: [
            { text: isPending ? pendingLabel : String(r.status), className: isPending ? TONE_TEXT.amber : TONE_TEXT.red },
            { text: "\n" },
            { text: r.method, className: networkMethodTextClass(r.method) },
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
        const url = e.toUrl ?? "";
        label = t("actionLog.verb.navigate", { target: url });
        // 탭(ActionLogContent)과 동일 패턴: verb 텍스트는 기본색, URL(target 슬롯)만 파랑.
        labelParts = splitTemplate(t("actionLog.verb.navigate")).map((tok) =>
          tok.type === "slot"
            ? { text: url, className: TONE_TEXT.blue }
            : { text: tok.value },
        );
        break;
      }
      case "input": {
        const field = `"${e.fieldLabel ?? e.selector ?? ""}"`;
        const value = e.masked ? "[********]" : `"${e.value ?? ""}"`;
        label = t("actionLog.verb.input", { field, value });
        labelParts = [{ text: label }];
        break;
      }
      case "keypress": {
        label = t("actionLog.verb.keypress", { keys: e.value ?? "" });
        labelParts = [{ text: label }];
        break;
      }
      case "toggle": {
        const field = `"${e.fieldLabel ?? e.selector ?? ""}"`;
        label = t(e.value === "checked" ? "actionLog.verb.toggle.check" : "actionLog.verb.toggle.uncheck", { field });
        labelParts = [{ text: label }];
        break;
      }
      case "select": {
        const field = `"${e.fieldLabel ?? e.selector ?? ""}"`;
        label = t("actionLog.verb.select", { field, value: `"${e.value ?? ""}"` });
        labelParts = [{ text: label }];
        break;
      }
      case "drag": {
        const source = dragNodeText(e.dragSource);
        label = e.dragTarget
          ? t("actionLog.verb.dragTo", { source, target: dragNodeText(e.dragTarget) })
          : t("actionLog.verb.drag", { source });
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
