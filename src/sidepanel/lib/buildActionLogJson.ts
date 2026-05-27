import type { ActionLog } from "@/types/action";

export function buildActionLogJson(log: ActionLog): object {
  return {
    version: 1,
    creator: {
      name: "BugShot",
      version: chrome.runtime.getManifest().version,
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
      ...(e.selector ? { selector: e.selector } : {}),
      ...(e.navType ? { navType: e.navType } : {}),
      ...(e.fromUrl ? { fromUrl: e.fromUrl } : {}),
      ...(e.toUrl ? { toUrl: e.toUrl } : {}),
      ...(e.fieldLabel ? { fieldLabel: e.fieldLabel } : {}),
      ...(e.value !== undefined ? { value: e.value } : {}),
      ...(e.masked ? { masked: e.masked } : {}),
    })),
  };
}
