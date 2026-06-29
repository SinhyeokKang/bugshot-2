import { useEffect, useMemo, useState } from "react";
import { useT } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { useIssuesStore, type IssueRecord } from "@/store/issues-store";
import { useSettingsStore } from "@/store/settings-store";
import type { ClickupTaskStatus } from "@/types/clickup";
import { sendBg } from "@/types/messages";
import { classifyBadgeError, type BadgeErrorKind } from "./utils";
import { resolveClickupCoords } from "@/sidepanel/tabs/issueListUtils";
import { STATUS_CATEGORY_COLORS } from "./constants";
import { ClickupStatusBadge, type ClickupBadgeStatus } from "./ClickupStatusBadge";

export function ClickupSubmittedBadge({
  issueId,
  clickupTaskId,
  refreshKey,
  onLoaded,
}: {
  issueId: string;
  clickupTaskId?: string;
  refreshKey: number;
  onLoaded: () => void;
}) {
  const t = useT();
  const clickupAccount = useSettingsStore((s) => s.accounts.clickup);
  const patchIssue = useIssuesStore((s) => s.patchIssue);
  const [status, setStatus] = useState<ClickupBadgeStatus | BadgeErrorKind | null>(null);

  const coords = useMemo(
    () => resolveClickupCoords({ clickupTaskId }),
    [clickupTaskId],
  );

  useEffect(() => {
    if (!clickupAccount || !coords) {
      setStatus("error");
      onLoaded();
      return;
    }
    sendBg<ClickupTaskStatus>({
      type: "clickup.getTaskStatus",
      taskId: coords.taskId,
    })
      .then((res) => {
        setStatus({ completed: res.completed });
        const patch: Partial<IssueRecord> = {};
        if (res.name) patch.title = res.name;
        if (Object.keys(patch).length) patchIssue(issueId, patch);
      })
      .catch((err) => setStatus(classifyBadgeError(err)))
      .finally(onLoaded);
  }, [clickupAccount, coords, refreshKey, onLoaded, issueId, patchIssue]);

  if (status === "error" || status === "deleted") {
    const deleted = status === "deleted";
    const colors = deleted ? STATUS_CATEGORY_COLORS.deleted : undefined;
    return (
      <Badge
        variant="outline"
        className={`w-fit shrink-0 text-[11px] ${colors ? `border-transparent ${colors.bg} ${colors.text} ${colors.darkBg} ${colors.darkText}` : ""}`}
      >
        {t(deleted ? "issueList.deleted" : "issueList.unknown")}
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
  return (
    <ClickupStatusBadge
      cuStatus={status}
      issueId={issueId}
      taskId={coords!.taskId}
      onStatusChanged={setStatus}
    />
  );
}
