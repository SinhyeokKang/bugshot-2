import { useEffect, useMemo, useState } from "react";
import { useT } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { useIssuesStore, type IssueRecord } from "@/store/issues-store";
import { useSettingsStore } from "@/store/settings-store";
import type { AsanaTaskStatus } from "@/types/asana";
import { sendBg } from "@/types/messages";
import { classifyBadgeError, type BadgeErrorKind } from "./utils";
import { resolveAsanaCoords } from "@/sidepanel/tabs/issueListUtils";
import { STATUS_CATEGORY_COLORS } from "./constants";
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
  const t = useT();
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
    <AsanaStatusBadge
      asStatus={status}
      issueId={issueId}
      taskGid={coords!.taskGid}
      onStatusChanged={setStatus}
    />
  );
}
