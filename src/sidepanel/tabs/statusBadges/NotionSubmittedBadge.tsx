import { useEffect, useState } from "react";
import { useT } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { useIssuesStore, type IssueRecord } from "@/store/issues-store";
import { useSettingsStore } from "@/store/settings-store";
import type { NotionPageStatus } from "@/types/notion";
import { sendBg } from "@/types/messages";
import { classifyBadgeError, type BadgeErrorKind } from "./utils";
import { resolveNotionPageId } from "@/sidepanel/tabs/issueListUtils";
import { notionStatusCategory } from "@/sidepanel/tabs/notionStatusColors";
import { STATUS_CATEGORY_COLORS } from "./constants";
import { NotionStatusBadge } from "./NotionStatusBadge";

export function NotionSubmittedBadge({
  issueId,
  issueUrl,
  notionPageId,
  notionDatabaseId,
  refreshKey,
  onLoaded,
}: {
  issueId: string;
  issueUrl?: string;
  notionPageId?: string;
  notionDatabaseId?: string;
  refreshKey: number;
  onLoaded: () => void;
}) {
  const t = useT();
  const notionAccount = useSettingsStore((s) => s.accounts.notion);
  const patchIssue = useIssuesStore((s) => s.patchIssue);
  const [status, setStatus] = useState<NotionPageStatus | BadgeErrorKind | null>(null);

  useEffect(() => {
    const pageId = resolveNotionPageId({ notionPageId, url: issueUrl }) ?? null;
    if (!notionAccount?.auth || !pageId) {
      setStatus("error");
      onLoaded();
      return;
    }
    sendBg<NotionPageStatus>({ type: "notion.getPageStatus", pageId })
      .then((res) => {
        setStatus(res);
        const patch: Partial<IssueRecord> = {};
        if (res.title) patch.title = res.title;
        if (!notionPageId) patch.notionPageId = res.pageId;
        if (res.statusOption) patch.notionStatusOption = res.statusOption.name;
        if (Object.keys(patch).length) patchIssue(issueId, patch);
      })
      .catch((err) => setStatus(classifyBadgeError(err)))
      .finally(onLoaded);
  }, [notionAccount?.auth, notionPageId, issueUrl, refreshKey, onLoaded, issueId, patchIssue]);

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
  if (status.statusOption) {
    const resolvedPageId = resolveNotionPageId({ notionPageId, url: issueUrl }) ?? null;
    if (notionAccount?.auth && notionDatabaseId && resolvedPageId) {
      return (
        <NotionStatusBadge
          pageId={resolvedPageId}
          databaseId={notionDatabaseId}
          issueId={issueId}
          currentOption={status.statusOption}
          onStatusChanged={setStatus}
        />
      );
    }
    const category = notionStatusCategory(status.statusOption.color);
    const colors = STATUS_CATEGORY_COLORS[category];
    return (
      <Badge
        variant="outline"
        className={`w-fit shrink-0 border-transparent text-[11px] ${colors.bg} ${colors.text} ${colors.darkBg} ${colors.darkText}`}
      >
        {status.statusOption.name}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="w-fit shrink-0 text-[11px]">
      {t("issueList.notion.noStatus")}
    </Badge>
  );
}
