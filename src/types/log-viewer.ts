import type { NetworkLog } from "./network";
import type { ConsoleLog } from "./console";

export interface LogViewerData {
  networkLog: NetworkLog | null;
  consoleLog: ConsoleLog | null;
  har: object | null;
  consoleLogJson: object | null;
  meta: {
    version: string;
    createdAt: string;
    pageUrl: string;
    issueUrl?: string;
  };
}
