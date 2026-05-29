import type { NetworkLog } from "./network";
import type { ConsoleLog } from "./console";
import type { ActionLog } from "./action";

export interface LogViewerData {
  networkLog: NetworkLog | null;
  consoleLog: ConsoleLog | null;
  actionLog: ActionLog | null;
  har: object | null;
  consoleLogJson: object | null;
  actionLogJson: object | null;
  video: {
    dataUrl: string;
    startedAt: number; // 동기화 앵커(공통 0점)
    thumbnail?: string; // <video poster>
  } | null;
  meta: {
    version: string;
    createdAt: string;
    pageUrl: string;
    issueTitle?: string;
    issueKey?: string;
    issueUrl?: string;
  };
}
