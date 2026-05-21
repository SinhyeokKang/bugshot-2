import { useEffect, useState } from "react";
import { useT } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { useIssuesStore, type IssueRecord } from "@/store/issues-store";
import { useSettingsStore } from "@/store/settings-store";
import type { LinearIssueStatus } from "@/types/linear";
import { sendBg } from "@/types/messages";
import {
  LINEAR_STATE_I18N,
  LINEAR_STATE_TYPE_COLORS,
  STATUS_CATEGORY_COLORS,
} from "./constants";
import { LinearStatusBadge } from "./LinearStatusBadge";

export function LinearSubmittedBadge({
  issueId,
  issueKey,
  linearIdentifier,
  refreshKey,
  onLoaded,
}: {
  issueId: string;
  issueKey: string;
  linearIdentifier?: string;
  refreshKey: number;
  onLoaded: () => void;
}) {
  const t = useT();
  const linearAccount = useSettingsStore((s) => s.accounts.linear);
  const patchIssue = useIssuesStore((s) => s.patchIssue);
  const [status, setStatus] = useState<LinearIssueStatus | "error" | null>(null);

  useEffect(() => {
    const identifier = linearIdentifier ?? issueKey;
    if (!linearAccount?.auth || !identifier) {
      setStatus("error");
      onLoaded();
      return;
    }
    sendBg<LinearIssueStatus>({ type: "linear.getIssueStatus", issueId: identifier })
      .then((res) => {
        setStatus(res);
        const patch: Partial<IssueRecord> = {};
        if (res.title) patch.title = res.title;
        if (res.identifier) patch.linearIdentifier = res.identifier;
        if (res.labels.length > 0) patch.linearLabelName = res.labels[0].name;
        if (Object.keys(patch).length) patchIssue(issueId, patch);
      })
      .catch(() => setStatus("error"))
      .finally(onLoaded);
  }, [linearAccount?.auth, linearIdentifier, issueKey, refreshKey, onLoaded, issueId, patchIssue]);

  if (status === "error") {
    return (
      <Badge variant="outline" className="w-fit shrink-0 text-[11px]">
        {t("issueList.unknown")}
      </Badge>
    );
  }
  if (!status) {
    return (
      <Badge variant="outline" className="w-fit shrink-0 text-[11px]">
        {t("issueList.submitted")}
      </Badge>
    );
  }
  if (linearAccount?.auth && status.id) {
    return (
      <LinearStatusBadge
        issueId={status.id}
        issueIdentifier={status.identifier}
        currentState={status.state}
        onStatusChanged={setStatus}
      />
    );
  }
  const stateType = status.state.type;
  const colors = LINEAR_STATE_TYPE_COLORS[stateType] ?? STATUS_CATEGORY_COLORS.new;
  const i18nKey = LINEAR_STATE_I18N[stateType] as Parameters<typeof t>[0] | undefined;
  const label = i18nKey ? t(i18nKey) : status.state.name;
  return (
    <Badge
      variant="outline"
      className={`w-fit shrink-0 border-transparent text-[11px] ${colors.bg} ${colors.text} ${colors.darkBg} ${colors.darkText}`}
    >
      {label}
    </Badge>
  );
}
