import { t } from "@/i18n";
import { sectionMdLabelKey, type IssueSection } from "@/store/settings-ui-store";
import {
  networkErrorCount,
  type ConsoleLogSummary,
  type NetworkLogSummary,
} from "./buildLogSummary";

// emitMarkdownLogSummary가 실제로 읽는 필드만(MarkdownContext의 구조적 부분집합).
// 빌더 타입을 통째로 끌어오면 leaf가 빌더를 되참조해 순환이 된다 — mergeStyleElements가
// MergeCurrentSelection으로 같은 걸 피한 선례를 따른다.
export interface LogSummaryContext {
  networkLogSummary?: NetworkLogSummary;
  consoleLogSummary?: ConsoleLogSummary;
  actionLogCaptured?: number;
}

export function sectionLabel(section: IssueSection): string {
  return section.labelOverride?.trim() || t(sectionMdLabelKey(section.id));
}

export function listItems(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

// mrkdwn 링크 문법을 쓰는 쪽(slack)은 자기 것을 유지한다.
export function footerMarkdown(): string {
  return `_Reported via [BugShot](https://bug-shot.com)_`;
}

// logsHref는 optional을 유지해야 한다 — 없으면 평문 `logs.html`, 있으면 링크다. 필수로 바꾸면
// href를 안 넘기는 호출부 본문에 `[logs.html](undefined)`가 찍힌다.
export function emitMarkdownLogSummary(
  lines: string[],
  ctx: LogSummaryContext,
  logsHref?: string,
): void {
  const { networkLogSummary: net, consoleLogSummary: con, actionLogCaptured: act } = ctx;
  if (!net && !con && !act) return;
  lines.push(`## ${t("logSummary.title")}`, "");
  const file = logsHref ? `[logs.html](${logsHref})` : "logs.html";
  lines.push(`**${t("logSummary.logs.lead")}** ${t("logSummary.logs.detail", { file })}`, "");
  if (net) {
    lines.push(
      networkErrorCount(net) > 0
        ? `- ${t("logSummary.network.line", { n: net.captured, errors: networkErrorCount(net) })}`
        : `- ${t("logSummary.network.lineNoError", { n: net.captured })}`,
    );
  }
  if (con) {
    lines.push(
      con.errorCount > 0 || con.warnCount > 0
        ? `- ${t("logSummary.console.line", { n: con.captured, errors: con.errorCount, warns: con.warnCount })}`
        : `- ${t("logSummary.console.lineNoError", { n: con.captured })}`,
    );
  }
  if (act) {
    lines.push(`- ${t("logSummary.action.line", { n: act })}`);
  }
  lines.push("");
}
