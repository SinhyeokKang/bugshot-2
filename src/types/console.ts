export type ConsoleLevel = "log" | "info" | "warn" | "error" | "debug";

export interface ConsoleEntry {
  id: string;
  level: ConsoleLevel;
  timestamp: number;
  args: string;
  stack?: string;
  pageUrl: string;
}

export interface ConsoleLog {
  id: string;
  startedAt: number;
  endedAt: number;
  totalSeen: number;
  captured: number;
  entries: ConsoleEntry[];
}
