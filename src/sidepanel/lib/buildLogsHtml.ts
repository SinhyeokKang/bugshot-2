import type { NetworkLog } from "@/types/network";
import type { ConsoleLog } from "@/types/console";
import type { LogViewerData } from "@/types/log-viewer";
import { buildHar } from "./buildHar";
import { buildConsoleLogJson } from "./buildConsoleLogJson";
import template from "../../../dist-log-viewer/index.html?raw";

export function buildLogsHtml(
  networkLog: NetworkLog | null,
  consoleLog: ConsoleLog | null,
  pageUrl: string,
  issueUrl?: string,
): string {
  const data: LogViewerData = {
    networkLog,
    consoleLog,
    har: networkLog ? buildHar(networkLog) : null,
    consoleLogJson: consoleLog ? buildConsoleLogJson(consoleLog) : null,
    meta: {
      version: chrome.runtime.getManifest().version,
      createdAt: new Date().toISOString(),
      pageUrl,
      ...(issueUrl ? { issueUrl } : {}),
    },
  };

  const json = JSON.stringify(data).replace(/</g, "\\u003c");

  return template.replace(
    /<script id="__BUGSHOT_DATA__" type="application\/json"><\/script>/,
    `<script id="__BUGSHOT_DATA__" type="application/json">${json}</script>`,
  );
}
