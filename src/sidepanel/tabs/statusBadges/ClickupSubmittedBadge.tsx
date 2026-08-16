import { useEffect, useMemo, useState } from "react";
import { useIssuesStore, type IssueRecord } from "@/store/issues-store";
import { useSettingsStore } from "@/store/settings-store";
import type { ClickupTaskStatus } from "@/types/clickup";
import { sendBg } from "@/lib/bg-client";
import { classifyBadgeError, type BadgeErrorKind } from "./utils";
import { resolveClickupCoords } from "@/sidepanel/tabs/issueListUtils";
import { BadgeFallback } from "./BadgeFallback";
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
    return <BadgeFallback kind={status} />;
  }
  if (!status) return <BadgeFallback kind="loading" />;
  return (
    <ClickupStatusBadge
      cuStatus={status}
      issueId={issueId}
      taskId={coords!.taskId}
      onStatusChanged={setStatus}
    />
  );
}
