import { t } from "@/i18n";
import { sectionMdLabelKey, type IssueSection } from "@/store/settings-ui-store";
import {
  networkErrorCount,
  type ConsoleLogSummary,
  type NetworkLogSummary,
} from "./buildLogSummary";

// 링크 텍스트에 들어가는 사용자 입력(파일명 등)의 구조 문자 이스케이프.
// `]`/`[`가 링크를 조기 종료하거나 깨지 않게(md 계열 빌더 공용). buildIssueMarkdown에
// 두면 leaf가 그걸 부르는 순간 issueBodyShared ↔ buildIssueMarkdown 순환이라 여기가 정본.
export const escapeMdLinkText = (text: string): string =>
  text.replace(/[\\[\]]/g, "\\$&");

// 스타일 표의 before/after 이미지 셀. 동형 string 2개를 위치로 받으면 인자 순서 스왑이
// 컴파일을 통과한다 — 합치기 전 3벌은 각 빌더의 MediaInput을 받아 필드명이 게이트였다.
// clickup·markdown의 MediaInput은 이 모양의 부분집합이라 그대로 넘어가고, url을 assetUrl로
// 부르는 linear만 호출부에서 이름을 맞춘다. 부재는 빈 셀 — 호출부 6곳의 복제 가드를 되돌린다.
export function imageCell(media: { filename: string; url?: string } | undefined): string {
  if (!media?.url) return "";
  return `![${escapeMdLinkText(media.filename)}](${media.url})`;
}

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
