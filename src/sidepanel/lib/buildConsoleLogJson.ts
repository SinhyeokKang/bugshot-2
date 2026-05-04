import type { ConsoleLog } from "@/types/console";

export function buildConsoleLogJson(log: ConsoleLog): object {
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
      level: e.level,
      timestamp: new Date(e.timestamp).toISOString(),
      message: e.args,
      ...(e.stack ? { stack: e.stack } : {}),
      pageUrl: e.pageUrl,
    })),
  };
}

export function serializeConsoleLog(data: object): string {
  return JSON.stringify(data, null, 2);
}
