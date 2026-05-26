import type { NetworkLog } from "@/types/network";
import type { ConsoleLog } from "@/types/console";

export function buildLogsHtml(
  _networkLog: NetworkLog | null,
  _consoleLog: ConsoleLog | null,
  _pageUrl: string,
): string {
  throw new Error("Not implemented");
}
