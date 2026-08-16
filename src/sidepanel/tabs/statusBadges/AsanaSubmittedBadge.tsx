import { useEffect, useMemo, useState } from "react";
import { useIssuesStore, type IssueRecord } from "@/store/issues-store";
import { useSettingsStore } from "@/store/settings-store";
import type { AsanaTaskStatus } from "@/types/asana";
import { sendBg } from "@/lib/bg-client";
import { classifyBadgeError, type BadgeErrorKind } from "./utils";
import { resolveAsanaCoords } from "@/sidepanel/tabs/issueListUtils";
import { BadgeFallback } from "./BadgeFallback";
import { AsanaStatusBadge, type AsanaBadgeStatus } from "./AsanaStatusBadge";

export function AsanaSubmittedBadge({
  issueId,
  asanaTaskGid,
  refreshKey,
  onLoaded,
}: {
  issueId: string;
  asanaTaskGid?: string;
  refreshKey: number;
  onLoaded: () => void;
}) {
  const asanaAccount = useSettingsStore((s) => s.accounts.asana);
  const patchIssue = useIssuesStore((s) => s.patchIssue);
  const [status, setStatus] = useState<AsanaBadgeStatus | BadgeErrorKind | null>(null);

  const coords = useMemo(
    () => resolveAsanaCoords({ asanaTaskGid }),
    [asanaTaskGid],
  );

  useEffect(() => {
    if (!asanaAccount || !coords) {
      setStatus("error");
      onLoaded();
      return;
    }
    sendBg<AsanaTaskStatus>({
      type: "asana.getTaskStatus",
      taskGid: coords.taskGid,
    })
      .then((res) => {
        setStatus({ completed: res.completed });
        const patch: Partial<IssueRecord> = {};
        if (res.name) patch.title = res.name;
        if (Object.keys(patch).length) patchIssue(issueId, patch);
      })
      .catch((err) => setStatus(classifyBadgeError(err)))
      .finally(onLoaded);
  }, [asanaAccount, coords, refreshKey, onLoaded, issueId, patchIssue]);

  if (status === "error" || status === "deleted") {
    return <BadgeFallback kind={status} />;
  }
  if (!status) return <BadgeFallback kind="loading" />;
  return (
    <AsanaStatusBadge
      asStatus={status}
      issueId={issueId}
      taskGid={coords!.taskGid}
      onStatusChanged={setStatus}
    />
  );
}
