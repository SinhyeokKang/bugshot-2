import type { NetworkLog } from "@/types/network";
import type { ConsoleLog } from "@/types/console";
import type { ActionLog } from "@/types/action";
import type { TranslationFn } from "@/i18n";
import { buildNetworkLogSummary, buildConsoleLogSummary } from "@/sidepanel/lib/buildLogSummary";

// 캡처된 타입만 console → network → action 순으로 세그먼트를 조립해 ` · `로 join.
// 에러 건수는 buildLogSummary 순수 헬퍼에서 파생(자체 계산 금지 — 단일 출처).
export function logCardTypeCounts(
  args: {
    networkLog: NetworkLog | null;
    consoleLog: ConsoleLog | null;
    actionLog: ActionLog | null;
  },
  t: TranslationFn,
): string {
  const { networkLog, consoleLog, actionLog } = args;
  const segments: string[] = [];

  if (consoleLog && consoleLog.captured > 0) {
    const errors = buildConsoleLogSummary(consoleLog).errorCount;
    segments.push(
      errors > 0
        ? t("logCard.consoleCount", { captured: consoleLog.captured, errors })
        : t("logCard.consoleCountNoError", { captured: consoleLog.captured }),
    );
  }
  if (networkLog && networkLog.captured > 0) {
    const errors = buildNetworkLogSummary(networkLog).errorCount ?? 0;
    segments.push(
      errors > 0
        ? t("logCard.networkCount", { captured: networkLog.captured, errors })
        : t("logCard.networkCountNoError", { captured: networkLog.captured }),
    );
  }
  if (actionLog && actionLog.captured > 0) {
    segments.push(t("logCard.actionCount", { captured: actionLog.captured }));
  }

  return segments.join(" · ");
}
