export type ConsoleLevel = "log" | "info" | "warn" | "error" | "debug";

export interface ConsoleEntry {
  id: string;
  level: ConsoleLevel;
  timestamp: number;
  args: string;
  stack?: string;
  pageUrl: string;
  // pre-arm 버퍼링으로 sentinel 도착 전(페이지 로드 초반) 캡처됨 → reload logClear 경계 우회 보존.
  preArm?: boolean;
}

export interface ConsoleLog {
  id: string;
  startedAt: number;
  endedAt: number;
  totalSeen: number;
  captured: number;
  entries: ConsoleEntry[];
}
