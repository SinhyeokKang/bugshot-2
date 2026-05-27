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
  meta: {
    version: string;
    createdAt: string;
    pageUrl: string;
    issueUrl?: string;
  };
}
