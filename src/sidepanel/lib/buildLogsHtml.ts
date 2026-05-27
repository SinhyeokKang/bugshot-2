import type { NetworkLog } from "@/types/network";
import type { ConsoleLog } from "@/types/console";
import type { ActionLog } from "@/types/action";
import type { LogViewerData } from "@/types/log-viewer";
import { buildHar } from "./buildHar";
import { buildConsoleLogJson } from "./buildConsoleLogJson";
import { buildActionLogJson } from "./buildActionLogJson";
import template from "../../../dist-log-viewer/index.html?raw";

export function buildLogsHtml(
  networkLog: NetworkLog | null,
  consoleLog: ConsoleLog | null,
  actionLog: ActionLog | null,
  video: LogViewerData["video"],
  pageUrl: string,
  issueUrl?: string,
): string {
  const data: LogViewerData = {
    networkLog,
    consoleLog,
    actionLog,
    har: networkLog ? buildHar(networkLog) : null,
    consoleLogJson: consoleLog ? buildConsoleLogJson(consoleLog) : null,
    actionLogJson: actionLog ? buildActionLogJson(actionLog) : null,
    video,
    meta: {
      version: chrome.runtime.getManifest().version,
      createdAt: new Date().toISOString(),
      pageUrl,
      // issueUrl은 항상 meta(=JSON)의 마지막 키로 빈 자리를 둔다. 제출 후 injectIssueUrl이
      // 이 빈 값을 치환하며, 마지막 위치 보장 덕에 pageUrl 등 앞선 값과의 marker 충돌이 없다.
      issueUrl: issueUrl ?? "",
    },
  };

  const json = JSON.stringify(data).replace(/</g, "\\u003c");

  return template.replace(
    /<script id="__BUGSHOT_DATA__" type="application\/json"><\/script>/,
    `<script id="__BUGSHOT_DATA__" type="application/json">${json}</script>`,
  );
}
