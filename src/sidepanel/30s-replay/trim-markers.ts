import type { ConsoleLog } from "@/types/console";
import type { NetworkLog } from "@/types/network";
import type { ActionLog } from "@/types/action";
import type { LogViewerData } from "@/types/log-viewer";
import { buildMarkers, type TimelineMarker } from "@/log-viewer/markers";

// buildMarkers(log-viewer)를 재사용해 에러성·페이지 이동 마커만 추려 그대로 반환(TimelineMarker).
// 축약하지 않고 variant·labelParts까지 보존 → log-viewer 마커 렌더·호버 툴팁을 그대로 재사용.
// console=error|warn variant, network=buildMarkers가 이미 4xx|error|pending만 반환,
// action=navigate(페이지 이동)만(click/input 등 일반 동작은 제외).
export function buildErrorMarkers(
  logs: { consoleLog: ConsoleLog | null; networkLog: NetworkLog | null; actionLog: ActionLog | null },
  videoStartedAt: number,
  durationSec: number,
): TimelineMarker[] {
  if (durationSec <= 0) return [];
  const data = {
    consoleLog: logs.consoleLog,
    networkLog: logs.networkLog,
    actionLog: logs.actionLog,
  } as LogViewerData;

  const out: TimelineMarker[] = [];
  if (logs.consoleLog) {
    out.push(
      ...buildMarkers(data, "console", durationSec, videoStartedAt).filter(
        (m) => m.variant === "error" || m.variant === "warn",
      ),
    );
  }
  if (logs.networkLog) {
    out.push(...buildMarkers(data, "network", durationSec, videoStartedAt));
  }
  if (logs.actionLog) {
    out.push(
      ...buildMarkers(data, "action", durationSec, videoStartedAt).filter(
        (m) => m.variant === "navigate",
      ),
    );
  }
  return out;
}
