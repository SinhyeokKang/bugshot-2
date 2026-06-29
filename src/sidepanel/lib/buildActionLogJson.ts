import type { ActionLog } from "@/types/action";

export function buildActionLogJson(log: ActionLog, version: string): object {
  return {
    version: 1,
    creator: {
      name: "BugShot",
      version,
    },
    startedAt: new Date(log.startedAt).toISOString(),
    endedAt: new Date(log.endedAt).toISOString(),
    totalSeen: log.totalSeen,
    captured: log.captured,
    entries: log.entries.map((e) => ({
      kind: e.kind,
      timestamp: new Date(e.timestamp).toISOString(),
      pageUrl: e.pageUrl,
      ...(e.target ? { target: e.target } : {}),
      ...(e.role ? { role: e.role } : {}),
      ...(e.selector ? { selector: e.selector } : {}),
      ...(e.navType ? { navType: e.navType } : {}),
      ...(e.fromUrl ? { fromUrl: e.fromUrl } : {}),
      ...(e.toUrl ? { toUrl: e.toUrl } : {}),
      ...(e.fieldLabel ? { fieldLabel: e.fieldLabel } : {}),
      ...(e.value !== undefined ? { value: e.value } : {}),
      ...(e.masked ? { masked: e.masked } : {}),
      ...(e.dragSource ? { dragSource: e.dragSource } : {}),
      ...(e.dragTarget ? { dragTarget: e.dragTarget } : {}),
    })),
  };
}
