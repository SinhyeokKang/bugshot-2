import type { ConsoleLog } from "@/types/console";
import type { NetworkLog } from "@/types/network";
import type { LogViewerData } from "@/types/log-viewer";
import { buildMarkers } from "@/log-viewer/markers";

export interface TrimMarker {
  id: string;
  type: "console" | "network"; // action 제외(에러 구분 없음)
  absTs: number;
  positionPct: number; // 0-100
}

// buildMarkers(log-viewer)를 재사용해 console/network 에러성 마커만 추려 TrimMarker로 매핑.
// console=error|warn variant, network=buildMarkers가 이미 4xx|error|pending만 반환. action 제외.
export function buildErrorMarkers(
  logs: { consoleLog: ConsoleLog | null; networkLog: NetworkLog | null },
  videoStartedAt: number,
  durationSec: number,
): TrimMarker[] {
  if (durationSec <= 0) return [];
  const data = {
    consoleLog: logs.consoleLog,
    networkLog: logs.networkLog,
    actionLog: null,
  } as LogViewerData;

  const out: TrimMarker[] = [];
  if (logs.consoleLog) {
    for (const m of buildMarkers(data, "console", durationSec, videoStartedAt)) {
      if (m.variant === "error" || m.variant === "warn") {
        out.push({ id: m.id, type: "console", absTs: m.absTs, positionPct: m.positionPct });
      }
    }
  }
  if (logs.networkLog) {
    for (const m of buildMarkers(data, "network", durationSec, videoStartedAt)) {
      out.push({ id: m.id, type: "network", absTs: m.absTs, positionPct: m.positionPct });
    }
  }
  return out;
}
