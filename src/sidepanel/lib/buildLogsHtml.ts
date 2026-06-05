import type { NetworkLog } from "@/types/network";
import type { ConsoleLog } from "@/types/console";
import type { ActionLog } from "@/types/action";
import type { LogViewerData, LogViewerReport } from "@/types/log-viewer";
import { gzipToBase64 } from "@/lib/gzip-base64";
import template from "../../../dist-log-viewer/index.html?raw";

export async function buildLogsHtml(
  networkLog: NetworkLog | null,
  consoleLog: ConsoleLog | null,
  actionLog: ActionLog | null,
  video: LogViewerData["video"],
  screenshot: LogViewerData["screenshot"],
  pageUrl: string,
  issueUrl?: string,
  issueTitle?: string,
  report: LogViewerReport | null = null,
): Promise<string> {
  // 무거운 로그·이미지·report는 gzip+base64로 압축(무손실). meta는 작고, 제출 후 injectIssueUrl이
  // issueUrl/issueKey 마커를 문자열 치환하므로 평문 별도 태그로 분리한다(압축 blob은 안 건드림).
  const heavy: Omit<LogViewerData, "meta"> = {
    networkLog,
    consoleLog,
    actionLog,
    video,
    screenshot,
    report,
  };
  const meta: LogViewerData["meta"] = {
    version: chrome.runtime.getManifest().version,
    createdAt: new Date().toISOString(),
    pageUrl,
    ...(issueTitle ? { issueTitle } : {}),
    // issueKey·issueUrl은 빈 자리를 둔다. 제출 후 injectIssueUrl이 이 평문 meta 태그에서 치환.
    issueKey: "",
    issueUrl: issueUrl ?? "",
  };

  // base64는 `<`를 포함하지 않아 스크립트 태그 안전(escape 불필요). meta JSON만 `<` escape.
  const dataB64 = await gzipToBase64(JSON.stringify(heavy));
  const metaJson = JSON.stringify(meta).replace(/</g, "\\u003c");

  // 함수형 replacement — metaJson의 user-controlled 값(issueTitle·pageUrl)에 `$&`·`$1` 등이 있어도
  // String.replace의 특수 치환 패턴으로 오해석되지 않도록 한다(injectIssueUrl과 동일 패턴).
  return template
    .replace(
      /<script id="__BUGSHOT_DATA__"[^>]*><\/script>/,
      () => `<script id="__BUGSHOT_DATA__" type="application/gzip-base64">${dataB64}</script>`,
    )
    .replace(
      /<script id="__BUGSHOT_META__"[^>]*><\/script>/,
      () => `<script id="__BUGSHOT_META__" type="application/json">${metaJson}</script>`,
    );
}
